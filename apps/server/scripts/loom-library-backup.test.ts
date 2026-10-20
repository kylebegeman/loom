import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { describe, expect, it } from "@effect/vitest";
import { ChatAttachmentId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Store from "../src/fork/project-library/LibraryStore.ts";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";
import * as ServerConfig from "../src/config.ts";
import { ServerEnvironmentIdentity } from "../src/environment/ServerEnvironment.ts";
import { runForkMigrationSet } from "../src/fork/persistence/migrations.ts";
import * as Library from "../src/fork/project-library/LibraryService.ts";
import * as Assets from "../src/fork/project-library/assets/LibraryAssetService.ts";
import * as Recovery from "../src/fork/project-library/assets/LibraryRecoveryStore.ts";
import { ProjectLibraryMigrations } from "../src/fork/project-library/migrations.ts";
import { LibraryAssetMigrations } from "../src/fork/project-library/assets/migrations.ts";
import {
  source,
  resource,
  copyFor,
  archiveFor,
} from "../src/fork/project-library/Library.testkit.ts";
import { LibraryError } from "@t3tools/contracts/fork";
import {
  createLibraryBackup,
  createLibraryReplica,
  verifyLibraryBackup,
  restoreLibraryBackup,
  pruneLibraryBackups,
  sqliteRsync,
  LibraryBackupFreeSpace,
  LibraryReplicaSync,
} from "./loom-library-backup.ts";
import { sqliteSnapshot } from "../../../scripts/lib/loomLibrarySnapshot.ts";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = yield* fs.makeTempDirectoryScoped({ prefix: "loom-library-backup-test-" });
  const stateDir = path.join(base, "userdata");
  yield* fs.makeDirectory(stateDir, { recursive: true });
  const database = path.join(stateDir, "statev2.sqlite");
  const services = Layer.mergeAll(
    Library.layer.pipe(Layer.provide(Assets.layer)),
    Assets.layer,
    Recovery.layer,
  ).pipe(
    Layer.provideMerge(NodeSqliteClient.layer({ filename: database })),
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
    ),
    Layer.provide(ServerConfig.layerTest(process.cwd(), base)),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
    ),
  );
  const info = yield* Effect.gen(function* () {
    yield* runForkMigrationSet(ProjectLibraryMigrations);
    yield* runForkMigrationSet(LibraryAssetMigrations);
    const library = yield* Library.LibraryService;
    const assets = yield* Assets.LibraryAssetService;
    const recovery = yield* Recovery.LibraryRecoveryStore;
    const project = yield* library.createProject({
      requestId: "create",
      title: "AspectAvy",
      resources: [resource],
    });
    yield* library.registerCopy({ requestId: "copy", copy: copyFor(project) });
    const baseArchive = yield* archiveFor(project);
    const attachment = {
      type: "file" as const,
      id: ChatAttachmentId.make("attachment"),
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 3,
    };
    yield* assets.put({
      sourceEnvironmentId: source,
      attachmentId: attachment.id,
      filename: attachment.name,
      contentType: attachment.mimeType,
      bytes: new Uint8Array([1, 2, 3]),
    });
    yield* library.registerThread({
      requestId: "thread",
      thread: {
        ...baseArchive,
        projection: {
          ...baseArchive.projection,
          messages: [{ ...baseArchive.projection.messages[0]!, attachments: [attachment] }],
        },
      },
    });
    const bytes = new TextEncoder().encode("recoverable repository and checkpoint bundle");
    const sha256 = Hex.encode(yield* (yield* Crypto.Crypto).digest("SHA-256", bytes));
    yield* recovery.put({
      sourceEnvironmentId: source,
      copyId: "copy",
      sha256,
      byteLength: bytes.length,
      manifest: {
        version: 1,
        projectId: project.id,
        projectRevision: 1,
        copyId: "copy",
        environmentId: source,
        title: project.title,
        rootBasename: "aspectavy",
        manifestFile: "loom-working-copy.json",
      },
      body: Stream.make(bytes),
    });
    return yield* library.info;
  }).pipe(Effect.provide(services));
  return { fs, path, base, stateDir, database, info, backupsDir: path.join(base, "backups") };
});
const run = <A, E, R>(use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.provideService(HostProcess.Environment, {}),
    Effect.scoped,
  );
type Fixture = Effect.Success<typeof fixture>;
// Stands in for sqlite3_rsync: the replica takes the origin's committed state and, as
// sqlite3_rsync does with a WAL origin, WAL mode and the umask's file mode.
const copySync = (f: Fixture) => (origin: string, replica: string) =>
  Effect.gen(function* () {
    const staged = `${replica}.sync`;
    yield* f.fs.remove(staged, { force: true });
    yield* Effect.promise(() => sqliteSnapshot(origin, staged));
    yield* SqlClient.SqlClient.use((sql) => sql`PRAGMA journal_mode=WAL`).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: staged })),
    );
    yield* f.fs.chmod(staged, 0o644);
    yield* f.fs.rename(staged, replica);
    return "sent 4,114 bytes, received 53,248 bytes";
  }).pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
const changeOrigin = (f: Fixture) =>
  SqlClient.SqlClient.use((sql) =>
    sql`CREATE TABLE IF NOT EXISTS replica_test(value INTEGER)`.pipe(
      Effect.andThen(sql`INSERT INTO replica_test VALUES (1)`),
    ),
  ).pipe(Effect.provide(NodeSqliteClient.layer({ filename: f.database })));
const replicaInput = (f: Fixture) => ({ ...f, replicaDir: f.path.join(f.backupsDir, "replica") });

describe("cold Library backup and recovery commands", () => {
  it.effect(
    "recovers full conversation data, attachments, and recovery archives after source files disappear",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const backup = yield* createLibraryBackup(f);
          expect(backup.manifest).toMatchObject({
            projects: 1,
            threads: 1,
            assetBytesVerified: true,
            recoveryBytesVerified: true,
            storageMode: "local",
          });
          expect(backup.manifest.recovery).toHaveLength(1);
          yield* f.fs.remove(f.stateDir, { recursive: true });
          const verified = yield* verifyLibraryBackup(backup.directory);
          expect(verified.manifest.database.bytes).toBeGreaterThan(0);
          const destination = f.path.join(f.base, "restored.sqlite");
          const restored = yield* restoreLibraryBackup({
            directory: backup.directory,
            destination,
          });
          expect(restored.authority).toEqual({ id: f.info.authorityId, epoch: 2 });
          const rows = yield* SqlClient.SqlClient.use(
            (sql) => sql<{ library_id: string }>`SELECT library_id FROM fork_library_threads`,
          ).pipe(Effect.provide(NodeSqliteClient.layer({ filename: destination, readonly: true })));
          const history = yield* Store.LibraryStore.use((store) =>
            store.history(rows[0]!.library_id),
          ).pipe(
            Effect.provide(
              Store.layer.pipe(
                Layer.provide(NodeSqliteClient.layer({ filename: destination, readonly: true })),
              ),
            ),
          );
          expect(history).toContain("Preserve this complete conversation");
          expect((yield* f.fs.stat(destination)).mode & 0o777).toBe(0o600);
        }),
      ),
  );
  it.effect("rejects corrupt backups and refuses to overwrite an existing destination", () =>
    run((f) =>
      Effect.gen(function* () {
        const backup = yield* createLibraryBackup(f);
        const destination = f.path.join(f.base, "existing.sqlite");
        yield* f.fs.writeFileString(destination, "preserve", { mode: 0o600 });
        expect(
          yield* restoreLibraryBackup({ directory: backup.directory, destination }).pipe(
            Effect.flip,
          ),
        ).toMatchObject({ reason: "io" });
        expect(yield* f.fs.readFileString(destination)).toBe("preserve");
        yield* f.fs.writeFileString(f.path.join(backup.directory, "statev2.sqlite"), "corrupt");
        expect(yield* verifyLibraryBackup(backup.directory).pipe(Effect.flip)).toMatchObject({
          reason: "invalid",
        });
      }),
    ),
  );
  it.effect("verifies, restores, and prunes dated backups of a live WAL-mode database", () =>
    run((f) =>
      Effect.gen(function* () {
        const [older, newer] = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`PRAGMA journal_mode=WAL`;
          yield* sql`CREATE TABLE replica_test(value INTEGER)`;
          yield* sql`INSERT INTO replica_test VALUES (1)`;
          const first = yield* createLibraryBackup(f);
          yield* TestClock.adjust("1 minute");
          return [first, yield* createLibraryBackup(f)] as const;
        }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: f.database })));
        // Reading each WAL-mode copy left an empty -wal beside it, as in production.
        const wal = f.path.join(newer.directory, "statev2.sqlite-wal");
        expect(Number((yield* f.fs.stat(wal)).size)).toBe(0);
        const destination = f.path.join(f.base, "restored.sqlite");
        yield* restoreLibraryBackup({ directory: newer.directory, destination });
        const rows = yield* SqlClient.SqlClient.use(
          (sql) => sql<{ value: number }>`SELECT value FROM replica_test`,
        ).pipe(Effect.provide(NodeSqliteClient.layer({ filename: destination, readonly: true })));
        expect(rows).toEqual([{ value: 1 }]);
        yield* TestClock.adjust("3 days");
        expect(
          yield* pruneLibraryBackups({ backupsDir: f.backupsDir, keep: 1, days: 1 }),
        ).toMatchObject({ removed: [older.directory], retained: 1, unverified: [] });
        yield* f.fs.writeFileString(wal, "frames");
        expect(yield* verifyLibraryBackup(newer.directory).pipe(Effect.flip)).toMatchObject({
          reason: "invalid",
        });
      }),
    ),
  );
  it.effect(
    "retains verified backups and ignores symlinks and unverified directories during pruning",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const one = yield* createLibraryBackup(f);
          const two = yield* createLibraryBackup(f);
          const unrelated = f.path.join(f.backupsDir, "unrelated");
          yield* f.fs.makeDirectory(unrelated);
          yield* f.fs.writeFileString(f.path.join(unrelated, "keep"), "keep");
          const link = f.path.join(
            f.backupsDir,
            "library-backup-1000000000-00000000-0000-4000-8000-000000000000",
          );
          yield* f.fs.symlink(one.directory, link);
          const result = yield* pruneLibraryBackups({
            backupsDir: f.backupsDir,
            keep: 1,
            days: 30,
          });
          expect(result.removed).toEqual([]);
          expect(result.retained).toBe(2);
          expect(yield* f.fs.exists(one.directory)).toBe(true);
          expect(yield* f.fs.exists(two.directory)).toBe(true);
          expect(yield* f.fs.exists(unrelated)).toBe(true);
          yield* TestClock.adjust("31 days");
          const pruned = yield* pruneLibraryBackups({
            backupsDir: f.backupsDir,
            keep: 1,
            days: 30,
          });
          expect(pruned.removed).toHaveLength(1);
          expect(pruned.retained).toBe(1);
          expect(yield* f.fs.readLink(link)).toBe(one.directory);
        }),
      ),
  );
  it.effect("refuses to start a snapshot when the backups volume lacks room", () =>
    run((f) =>
      Effect.gen(function* () {
        const error = yield* createLibraryBackup(f).pipe(
          Effect.provideService(LibraryBackupFreeSpace, () => Effect.succeed(4096)),
          Effect.flip,
        );
        expect(error).toMatchObject({
          reason: "storage-limit",
          cause: expect.stringContaining("only 4096 bytes"),
        });
        expect(yield* f.fs.exists(f.backupsDir)).toBe(false);
      }),
    ),
  );
  it.effect("refuses to start a snapshot while another is still copying", () =>
    run((f) =>
      Effect.gen(function* () {
        const running = f.path.join(
          f.backupsDir,
          "library-backup-0-00000000-0000-4000-8000-000000000001.partial",
        );
        yield* f.fs.makeDirectory(running, { recursive: true });
        expect(yield* createLibraryBackup(f).pipe(Effect.flip)).toMatchObject({
          reason: "request-conflict",
          cause: expect.stringContaining(f.path.basename(running)),
        });
        expect(yield* f.fs.readDirectory(f.backupsDir)).toEqual([f.path.basename(running)]);
        // One that is still unfinished after six hours died without cleaning up.
        yield* TestClock.adjust("7 hours");
        expect((yield* createLibraryBackup(f)).manifest).toBeDefined();
      }),
    ),
  );
  it.effect("skips a listed snapshot that finishes or is cleaned up before prune reaches it", () =>
    run((f) =>
      Effect.gen(function* () {
        const kept = yield* createLibraryBackup(f);
        const vanished = "library-backup-0-00000000-0000-4000-8000-000000000001.partial";
        const pruned = yield* pruneLibraryBackups({
          backupsDir: f.backupsDir,
          keep: 1,
          days: 1,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...f.fs,
            readDirectory: (directory, options) =>
              f.fs
                .readDirectory(directory, options)
                .pipe(Effect.map((entries) => [vanished, ...entries])),
          }),
        );
        expect(pruned).toMatchObject({ retained: 1, stalePartial: [], inProgress: [] });
        expect(yield* verifyLibraryBackup(kept.directory)).toBeDefined();
      }),
    ),
  );
  it.effect("leaves no staging or backup directory when the copy or manifest fails", () =>
    run((f) =>
      Effect.gen(function* () {
        const notDatabase = f.path.join(f.base, "not-a-database.sqlite");
        yield* f.fs.writeFileString(notDatabase, "not a database");
        expect(
          yield* createLibraryBackup({ ...f, database: notDatabase }).pipe(Effect.flip),
        ).toMatchObject({ reason: "io", cause: expect.anything() });
        const unrelated = f.path.join(f.base, "unrelated.sqlite");
        yield* SqlClient.SqlClient.use((sql) => sql`CREATE TABLE unrelated(value INTEGER)`).pipe(
          Effect.provide(NodeSqliteClient.layer({ filename: unrelated })),
        );
        yield* createLibraryBackup({ ...f, database: unrelated }).pipe(Effect.flip);
        expect(yield* f.fs.readDirectory(f.backupsDir)).toEqual([]);
      }),
    ),
  );
  it.effect("removes the staging directory when a snapshot is interrupted after its copy", () =>
    run((f) =>
      Effect.gen(function* () {
        const paused = yield* Deferred.make<void>();
        let checks = 0;
        const fiber = yield* createLibraryBackup(f).pipe(
          Effect.provideService(LibraryBackupFreeSpace, () =>
            checks++ === 0
              ? Effect.succeed(Number.MAX_SAFE_INTEGER)
              : Deferred.succeed(paused, undefined).pipe(Effect.andThen(Effect.never)),
          ),
          Effect.forkChild,
        );
        yield* Deferred.await(paused);
        const staged = yield* f.fs.readDirectory(f.backupsDir);
        expect(staged).toHaveLength(1);
        expect(yield* f.fs.exists(f.path.join(f.backupsDir, staged[0]!, "statev2.sqlite"))).toBe(
          true,
        );
        yield* Fiber.interrupt(fiber);
        expect(yield* f.fs.readDirectory(f.backupsDir)).toEqual([]);
      }),
    ),
  );
  it.effect(
    "prunes dead snapshots but keeps running ones, unverifiable finished backups, and the newest verified backup",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const names = (directories: ReadonlyArray<string>) =>
            directories.map((directory) => f.path.basename(directory)).toSorted();
          const leftover = Effect.fnUntraced(function* (time: number, id: number, suffix: string) {
            const directory = f.path.join(
              f.backupsDir,
              `library-backup-${time}-00000000-0000-4000-8000-${String(id).padStart(12, "0")}${suffix}`,
            );
            yield* f.fs.makeDirectory(directory);
            yield* f.fs.writeFileString(f.path.join(directory, "statev2.sqlite"), "half copied");
            return directory;
          });
          const old = yield* createLibraryBackup(f);
          const corrupt = yield* createLibraryBackup(f);
          yield* f.fs.writeFileString(f.path.join(corrupt.directory, "statev2.sqlite"), "corrupt");
          const deadPartial = yield* leftover(0, 1, ".partial");
          const deadLegacy = yield* leftover(0, 2, "");
          const precious = f.path.join(f.base, "precious");
          yield* f.fs.makeDirectory(precious);
          const linkedPartial = f.path.join(
            f.backupsDir,
            "library-backup-0-00000000-0000-4000-8000-000000000005.partial",
          );
          yield* f.fs.symlink(precious, linkedPartial);
          yield* TestClock.adjust("7 hours");
          const newest = yield* createLibraryBackup(f);
          const runningPartial = yield* leftover(7 * 3_600_000, 3, ".partial");
          const runningLegacy = yield* leftover(7 * 3_600_000, 4, "");

          const first = yield* pruneLibraryBackups({ backupsDir: f.backupsDir, keep: 1, days: 1 });
          expect(first.retained).toBe(2);
          expect(first.removed).toEqual([]);
          expect(names(first.stalePartial)).toEqual(names([deadPartial]));
          expect(names(first.staleIncomplete)).toEqual(names([deadLegacy]));
          expect(names(first.unverified)).toEqual(names([corrupt.directory]));
          expect(names(first.inProgress)).toEqual(names([runningPartial, runningLegacy]));
          expect(yield* f.fs.exists(deadPartial)).toBe(false);
          expect(yield* f.fs.exists(deadLegacy)).toBe(false);
          expect(yield* f.fs.exists(runningPartial)).toBe(true);
          expect(yield* f.fs.exists(runningLegacy)).toBe(true);
          expect(yield* f.fs.readLink(linkedPartial)).toBe(precious);
          expect(yield* f.fs.exists(precious)).toBe(true);

          yield* TestClock.adjust("2 days");
          const later = yield* pruneLibraryBackups({ backupsDir: f.backupsDir, keep: 1, days: 1 });
          expect(later.retained).toBe(1);
          expect(names(later.removed)).toEqual(names([old.directory]));
          expect(names(later.stalePartial)).toEqual(names([runningPartial]));
          expect(names(later.staleIncomplete)).toEqual(names([runningLegacy]));
          expect(names(later.unverified)).toEqual(names([corrupt.directory]));
          expect(yield* verifyLibraryBackup(newest.directory)).toBeDefined();
          expect(yield* f.fs.exists(corrupt.directory)).toBe(true);
        }),
      ),
  );
});

describe("Library replica", () => {
  const journalMode = (database: string) =>
    SqlClient.SqlClient.use((sql) => sql<{ journal_mode: string }>`PRAGMA journal_mode`).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: database, readonly: true })),
      Effect.map((rows) => rows[0]?.journal_mode),
    );
  it.effect("updates one replica in place, repairs its objects, and restores from it", () =>
    run((f) =>
      Effect.gen(function* () {
        const input = replicaInput(f);
        const first = yield* createLibraryReplica(input).pipe(
          Effect.provideService(LibraryReplicaSync, copySync(f)),
        );
        const objects = f.path.join(input.replicaDir, "objects", "project-library");
        const asset = f.path.join(objects, "objects", first.manifest.assets[0]!.digest);
        const stray = f.path.join(objects, "objects", "stray");
        const archive = f.path.join(objects, "recovery", first.manifest.recovery[0]!.digest);
        const partial = `${archive}.partial`;
        yield* f.fs.writeFileString(stray, "stray");
        yield* f.fs.writeFileString(partial, "half");
        yield* f.fs.writeFile(asset, new Uint8Array([9, 9, 9]));
        // Unreadable as a file, like an object on a failing disk.
        yield* f.fs.remove(archive);
        yield* f.fs.makeDirectory(f.path.join(archive, "left-behind"), { recursive: true });
        yield* changeOrigin(f);
        const second = yield* createLibraryReplica(input).pipe(
          Effect.provideService(LibraryReplicaSync, copySync(f)),
        );
        expect(second.directory).toBe(input.replicaDir);
        expect(second.manifest.database.digest).not.toBe(first.manifest.database.digest);
        expect((yield* f.fs.readDirectory(input.replicaDir)).toSorted()).toEqual([
          "complete",
          "manifest.json",
          "objects",
          "statev2.sqlite",
        ]);
        expect(yield* f.fs.exists(stray)).toBe(false);
        expect(yield* f.fs.exists(partial)).toBe(false);
        expect([...(yield* f.fs.readFile(asset))]).toEqual([1, 2, 3]);
        expect((yield* f.fs.stat(archive)).type).toBe("File");
        expect(yield* journalMode(f.path.join(input.replicaDir, "statev2.sqlite"))).toBe("delete");
        const database = yield* f.fs.stat(f.path.join(input.replicaDir, "statev2.sqlite"));
        expect(database.mode & 0o777).toBe(0o600);
        yield* verifyLibraryBackup(input.replicaDir);
        const destination = f.path.join(f.base, "restored.sqlite");
        yield* restoreLibraryBackup({ directory: input.replicaDir, destination });
        const rows = yield* SqlClient.SqlClient.use(
          (sql) => sql<{ value: number }>`SELECT value FROM replica_test`,
        ).pipe(Effect.provide(NodeSqliteClient.layer({ filename: destination, readonly: true })));
        expect(rows).toEqual([{ value: 1 }]);
      }),
    ),
  );
  it.effect("refuses to start a replica sync when its volume lacks room", () =>
    run((f) =>
      Effect.gen(function* () {
        const error = yield* createLibraryReplica(replicaInput(f)).pipe(
          Effect.provideService(LibraryReplicaSync, copySync(f)),
          Effect.provideService(LibraryBackupFreeSpace, () => Effect.succeed(4096)),
          Effect.flip,
        );
        expect(error).toMatchObject({ reason: "storage-limit" });
        expect(yield* f.fs.exists(f.backupsDir)).toBe(false);
      }),
    ),
  );
  it.effect("refuses a replica directory that holds the live database", () =>
    run((f) =>
      Effect.gen(function* () {
        const synced: string[] = [];
        expect(
          yield* createLibraryReplica({ ...f, replicaDir: f.stateDir }).pipe(
            Effect.provideService(LibraryReplicaSync, (origin) =>
              Effect.sync(() => synced.push(origin)).pipe(Effect.as("")),
            ),
            Effect.flip,
          ),
        ).toMatchObject({ reason: "invalid" });
        expect(synced).toEqual([]);
        expect(yield* f.fs.exists(f.path.join(f.stateDir, "syncing"))).toBe(false);
      }),
    ),
  );
  it.effect("refuses a second sync while one runs and takes over one that died", () =>
    run((f) =>
      Effect.gen(function* () {
        const input = replicaInput(f);
        const marker = f.path.join(input.replicaDir, "syncing");
        yield* f.fs.makeDirectory(input.replicaDir, { recursive: true });
        yield* f.fs.writeFileString(marker, "0");
        expect(
          yield* createLibraryReplica(input).pipe(
            Effect.provideService(LibraryReplicaSync, copySync(f)),
            Effect.flip,
          ),
        ).toMatchObject({ reason: "request-conflict" });
        expect(yield* f.fs.exists(marker)).toBe(true);
        yield* TestClock.adjust("7 hours");
        yield* createLibraryReplica(input).pipe(
          Effect.provideService(LibraryReplicaSync, copySync(f)),
        );
        expect(yield* f.fs.exists(marker)).toBe(false);
        yield* verifyLibraryBackup(input.replicaDir);
        // A run that outlives its marker leaves the marker of the run that took over.
        yield* createLibraryReplica(input).pipe(
          Effect.provideService(LibraryReplicaSync, (origin, replica) =>
            f.fs
              .writeFileString(marker, "999")
              .pipe(Effect.orDie, Effect.andThen(copySync(f)(origin, replica))),
          ),
        );
        expect(yield* f.fs.readFileString(marker)).toBe("999");
      }),
    ),
  );
  it.effect(
    "keeps the last verified replica when a sync fails and repairs one interrupted mid-sync",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const input = replicaInput(f);
          const marker = f.path.join(input.replicaDir, "syncing");
          const first = yield* createLibraryReplica(input).pipe(
            Effect.provideService(LibraryReplicaSync, copySync(f)),
          );
          yield* changeOrigin(f);
          expect(
            yield* createLibraryReplica(input).pipe(
              Effect.provideService(LibraryReplicaSync, () =>
                Effect.fail(new LibraryError({ reason: "io", cause: "database is locked" })),
              ),
              Effect.flip,
            ),
          ).toMatchObject({ reason: "io" });
          expect(yield* f.fs.exists(marker)).toBe(false);
          expect((yield* verifyLibraryBackup(input.replicaDir)).manifest).toEqual(first.manifest);

          const changed = yield* Deferred.make<void>();
          const fiber = yield* createLibraryReplica(input).pipe(
            Effect.provideService(LibraryReplicaSync, (origin, replica) =>
              copySync(f)(origin, replica).pipe(
                Effect.andThen(Deferred.succeed(changed, undefined)),
                Effect.andThen(Effect.never),
              ),
            ),
            Effect.forkChild,
          );
          yield* Deferred.await(changed);
          yield* Fiber.interrupt(fiber);
          expect(yield* f.fs.exists(marker)).toBe(false);
          expect(yield* verifyLibraryBackup(input.replicaDir).pipe(Effect.flip)).toMatchObject({
            reason: "invalid",
          });
          yield* createLibraryReplica(input).pipe(
            Effect.provideService(LibraryReplicaSync, copySync(f)),
          );
          const repaired = yield* verifyLibraryBackup(input.replicaDir);
          expect(repaired.manifest.database.digest).not.toBe(first.manifest.database.digest);
        }),
      ),
  );
  it.effect(
    "lets a verified newer replica stand in for dated backups past the age limit, and only then",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const input = replicaInput(f);
          const prune = pruneLibraryBackups({
            backupsDir: f.backupsDir,
            keep: 2,
            days: 1,
            replicaDir: input.replicaDir,
          });
          const one = yield* createLibraryBackup(f);
          const two = yield* createLibraryBackup(f);
          yield* TestClock.adjust("2 days");
          expect(yield* prune).toMatchObject({ removed: [], replica: { state: "absent" } });
          yield* TestClock.adjust("1 hour");
          yield* createLibraryReplica(input).pipe(
            Effect.provideService(LibraryReplicaSync, copySync(f)),
          );
          const journal = f.path.join(input.replicaDir, "statev2.sqlite-journal");
          yield* f.fs.writeFileString(journal, "hot");
          expect(yield* prune).toMatchObject({ removed: [], replica: { state: "unverified" } });
          yield* f.fs.remove(journal);
          const marker = f.path.join(input.replicaDir, "syncing");
          yield* f.fs.writeFileString(marker, String(2 * 86_400_000 + 3_600_000));
          expect(yield* prune).toMatchObject({ removed: [], replica: { state: "syncing" } });
          expect(yield* verifyLibraryBackup(input.replicaDir).pipe(Effect.flip)).toMatchObject({
            reason: "request-conflict",
          });
          yield* f.fs.remove(marker);
          yield* TestClock.adjust("1 minute");
          const newer = yield* createLibraryBackup(f);
          yield* TestClock.adjust("2 days");

          const pruned = yield* prune;
          expect(pruned.replica).toMatchObject({ state: "verified" });
          expect(pruned.removed.toSorted()).toEqual([one.directory, two.directory].toSorted());
          expect(pruned.retained).toBe(1);
          yield* verifyLibraryBackup(newer.directory);
          yield* verifyLibraryBackup(input.replicaDir);
        }),
      ),
  );
  it.effect("keeps dated backups within the age limit even behind a verified replica", () =>
    run((f) =>
      Effect.gen(function* () {
        const input = replicaInput(f);
        const backup = yield* createLibraryBackup(f);
        yield* TestClock.adjust("1 hour");
        yield* createLibraryReplica(input).pipe(
          Effect.provideService(LibraryReplicaSync, copySync(f)),
        );
        const pruned = yield* pruneLibraryBackups({
          backupsDir: f.backupsDir,
          keep: 2,
          days: 1,
          replicaDir: input.replicaDir,
        });
        expect(pruned).toMatchObject({ removed: [], retained: 1, replica: { state: "verified" } });
        yield* verifyLibraryBackup(backup.directory);
      }),
    ),
  );
  it.effect(
    "runs sqlite3_rsync origin first and fails on a non-zero exit or its failure line",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const fake = Effect.fnUntraced(function* (name: string, body: string) {
            const script = f.path.join(f.base, name);
            yield* f.fs.writeFileString(script, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
            return yield* sqliteRsync(script)("origin.sqlite", "replica.sqlite").pipe(
              Effect.result,
            );
          });
          const args = f.path.join(f.base, "args");
          expect(
            yield* fake("records", `printf '%s\\n' "$@" > '${args}'\necho 'sent 1 bytes'`),
          ).toMatchObject({ success: "sent 1 bytes" });
          expect(yield* f.fs.readFileString(args)).toBe("-v\norigin.sqlite\nreplica.sqlite\n");
          expect(
            yield* fake(
              "reports",
              "echo 'database is locked'\necho 'Databases were not synced due to errors'",
            ),
          ).toMatchObject({
            failure: { reason: "io", cause: expect.stringContaining("database is locked") },
          });
          expect(yield* fake("exits", "echo 'missing REPLICA' >&2\nexit 1")).toMatchObject({
            failure: { reason: "io", cause: expect.stringContaining("missing REPLICA") },
          });
        }),
      ),
  );
  // Set LOOM_TEST_SQLITE3_RSYNC to a sqlite3_rsync binary to run the replica against it.
  const realRsync = process.env.LOOM_TEST_SQLITE3_RSYNC;
  it.effect.skipIf(!realRsync)(
    "syncs a live WAL-mode database into a replica with sqlite3_rsync",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const input = replicaInput(f);
          const replica = f.path.join(input.replicaDir, "statev2.sqlite");
          const sync = Effect.provideService(LibraryReplicaSync, sqliteRsync(realRsync));
          // The writer stays open with uncheckpointed frames, as the live server does.
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`PRAGMA journal_mode=WAL`;
            const first = yield* createLibraryReplica(input).pipe(sync);
            yield* sql`CREATE TABLE replica_test(value INTEGER)`;
            yield* sql`INSERT INTO replica_test VALUES (1)`;
            const second = yield* createLibraryReplica(input).pipe(sync);
            expect(second.manifest.database.digest).not.toBe(first.manifest.database.digest);
          }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: f.database })));
          expect(yield* journalMode(replica)).toBe("delete");
          expect((yield* f.fs.stat(replica)).mode & 0o777).toBe(0o600);
          const destination = f.path.join(f.base, "restored.sqlite");
          yield* restoreLibraryBackup({ directory: input.replicaDir, destination });
          const rows = yield* SqlClient.SqlClient.use(
            (sql) => sql<{ value: number }>`SELECT value FROM replica_test`,
          ).pipe(Effect.provide(NodeSqliteClient.layer({ filename: destination, readonly: true })));
          expect(rows).toEqual([{ value: 1 }]);
        }),
      ),
  );
});
