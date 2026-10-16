import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { describe, expect, it } from "@effect/vitest";
import { ChatAttachmentId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
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
import {
  createLibraryBackup,
  verifyLibraryBackup,
  restoreLibraryBackup,
  pruneLibraryBackups,
} from "./loom-library-backup.ts";

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
});
