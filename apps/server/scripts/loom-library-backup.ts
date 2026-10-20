#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { LibraryError } from "@t3tools/contracts/fork";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ServerConfig from "../src/config.ts";
import * as Maintenance from "../src/fork/project-library/LibraryMaintenance.ts";
import * as Assets from "../src/fork/project-library/assets/LibraryAssetService.ts";
import * as Recovery from "../src/fork/project-library/assets/LibraryRecoveryStore.ts";
import * as ProcessRunner from "../src/processRunner.ts";
import {
  availableBytes,
  fileFingerprint,
  settleSqliteReplica,
  sqliteSnapshot,
} from "../../../scripts/lib/loomLibrarySnapshot.ts";

const manifestCodec = Schema.fromJsonString(Maintenance.LibraryBackupManifest);
const encodeManifest = Schema.encodeEffect(manifestCodec);
const decodeManifest = Schema.decodeEffect(manifestCodec);
const isLibraryError = Schema.is(LibraryError);
const fingerprint = (file: string) =>
  Effect.tryPromise({
    try: () => fileFingerprint(file),
    catch: (cause) => new LibraryError({ reason: "io", cause }),
  });
const sqliteCopy = (source: string, destination: string) =>
  Effect.tryPromise({
    try: () => sqliteSnapshot(source, destination),
    catch: (cause) => new LibraryError({ reason: "io", cause }),
  });
const settleReplica = (database: string) =>
  Effect.tryPromise({
    try: () => settleSqliteReplica(database),
    catch: (cause) => new LibraryError({ reason: "io", cause }),
  });
const BACKUP_NAME = /^library-backup-(\d+)-[0-9a-f-]{36}(\.partial)?$/;
const PARTIAL_SUFFIX = ".partial";
// The live database keeps growing while the copy runs, and the backups volume is
// shared with the server and other apps, so a snapshot must never take the last byte.
const SNAPSHOT_FREE_SPACE_MARGIN_BYTES = 1024 ** 3;
// A snapshot copies at disk speed; one still unfinished after this long belongs to
// a process that died before it could clean up.
const STALE_SNAPSHOT_MS = 6 * 60 * 60 * 1000;
// Overridable so tests can simulate a full volume without filling a disk.
export const LibraryBackupFreeSpace = Context.Reference<
  (directory: string) => Effect.Effect<number, LibraryError>
>("loom/LibraryBackupFreeSpace", {
  defaultValue: () => (directory) =>
    Effect.tryPromise({
      try: () => availableBytes(directory),
      catch: (cause) => new LibraryError({ reason: "io", cause }),
    }),
});
const REPLICA_SYNCING = "syncing";
// A hung sync must end well before its marker counts as stale and a later run takes over.
const REPLICA_SYNC_TIMEOUT_MS = STALE_SNAPSHOT_MS / 2;
const SQLITE_RSYNC_FAILED = "Databases were not synced due to errors";
// sqlite3_rsync spawns its replica side as `argv[0] --replica` through /bin/sh, so the
// command must be on PATH or absolute. Its exit status is its error count modulo 256, so
// its own failure line is checked too.
export const sqliteRsync =
  (command = "sqlite3_rsync") =>
  (origin: string, replica: string) =>
    ProcessRunner.ProcessRunner.use((runner) =>
      runner.run({
        command,
        args: ["-v", origin, replica],
        timeout: REPLICA_SYNC_TIMEOUT_MS,
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      }),
    ).pipe(
      Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
      Effect.flatMap((result) =>
        result.code === 0 && !result.stdout.includes(SQLITE_RSYNC_FAILED)
          ? Effect.succeed(result.stdout.trim())
          : Effect.fail(
              new LibraryError({
                reason: "io",
                cause: `${command} exited with code ${result.code}: ${`${result.stderr}\n${result.stdout}`.trim()}`,
              }),
            ),
      ),
      Effect.provide(ProcessRunner.layer),
    );
// Overridable so tests can stand in for sqlite3_rsync.
export const LibraryReplicaSync = Context.Reference<
  (
    origin: string,
    replica: string,
  ) => Effect.Effect<string, LibraryError, ChildProcessSpawner.ChildProcessSpawner>
>("loom/LibraryReplicaSync", { defaultValue: () => sqliteRsync() });
// Printed as each stage ends, so a run killed at its timeout still shows how far it got.
const timed = <A, E, R>(stage: string, effect: Effect.Effect<A, E, R>) =>
  Effect.timed(effect).pipe(
    Effect.tap(([duration]) =>
      Console.log(`Library snapshot ${stage}: ${(Duration.toMillis(duration) / 1000).toFixed(1)}s`),
    ),
    Effect.map(([, result]) => result),
  );
const describeBytes = (bytes: number) => `${bytes} bytes (${(bytes / 1024 ** 3).toFixed(2)} GiB)`;
const fileBytes = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(file)) ? Number((yield* fs.stat(file)).size) : 0;
});
const ensureFreeSpace = Effect.fnUntraced(function* (directory: string, bytes: number) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // The first snapshot runs before its backups directory exists, and nothing may be
  // created until the volume is known to have room.
  let probe = path.resolve(directory);
  while (!(yield* fs.exists(probe)) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const available = yield* (yield* LibraryBackupFreeSpace)(probe);
  const needed = bytes + SNAPSHOT_FREE_SPACE_MARGIN_BYTES;
  // Written so an unreadable (NaN) measurement fails closed.
  if (!(available >= needed))
    return yield* new LibraryError({
      reason: "storage-limit",
      cause: `Library snapshot needs ${describeBytes(needed)} free in ${directory}, but only ${describeBytes(available)} are available.`,
    });
});
// The space check allows for one copy, so a second snapshot started meanwhile could fill the volume.
const ensureNoSnapshotRunning = Effect.fnUntraced(function* (backupsDir: string, now: number) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(backupsDir))) return;
  for (const name of yield* fs.readDirectory(backupsDir)) {
    const match = BACKUP_NAME.exec(name);
    if (match?.[2] !== undefined && now - Number(match[1]) < STALE_SNAPSHOT_MS)
      return yield* new LibraryError({
        reason: "request-conflict",
        cause: `Another Library snapshot is still copying into ${name} in ${backupsDir}. If it was interrupted, prune removes it six hours after it started.`,
      });
  }
});
const sourceLayer = (database: string, stateDir: string, readonly = true) => {
  const config = Layer.effect(
    ServerConfig.ServerConfig,
    ServerConfig.ServerConfig.pipe(Effect.map((initial) => ({ ...initial, stateDir }))),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "loom-library-backup-" })));
  return Maintenance.layer.pipe(
    Layer.provide(Layer.merge(Assets.layer, Recovery.layer)),
    Layer.provide(config),
    Layer.provide(NodeSqliteClient.layer({ filename: database, readonly })),
    Layer.provide(FetchHttpClient.layer),
  );
};
class LibrarySnapshotSkipped extends Data.TaggedError("LibrarySnapshotSkipped")<{
  readonly message: string;
}> {}
const syncFile = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.scoped(fs.open(file).pipe(Effect.flatMap((handle) => handle.sync)));
});
// Copies the local objects a manifest references that the snapshot does not hold intact. A
// replica keeps its objects between runs, so a damaged one is copied again and objects it no
// longer references are removed. Both kinds are named by their SHA-256.
const syncObjects = Effect.fnUntraced(function* (input: {
  directory: string;
  stateDir: string;
  spaceDir: string;
  manifest: Maintenance.LibraryBackupManifest;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const kinds = [
    {
      kind: "objects",
      wanted: new Map(input.manifest.assets.map((asset) => [asset.digest, asset.bytes])),
    },
    {
      kind: "recovery",
      wanted: new Map(
        input.manifest.recovery.map((archive) => [archive.digest, archive.byteLength]),
      ),
    },
  ];
  const missing: { source: string; target: string }[] = [];
  let missingBytes = 0;
  for (const { kind, wanted } of kinds)
    for (const [digest, bytes] of wanted) {
      const target = path.join(input.directory, "objects", "project-library", kind, digest);
      if (yield* fs.exists(target)) {
        const saved = yield* fingerprint(target);
        if (saved.digest === digest && saved.bytes === bytes) continue;
      }
      missing.push({ source: path.join(input.stateDir, "project-library", kind, digest), target });
      missingBytes += bytes;
    }
  yield* ensureFreeSpace(input.spaceDir, missingBytes);
  for (const { kind, wanted } of kinds) {
    const directory = path.join(input.directory, "objects", "project-library", kind);
    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
    for (const name of yield* fs.readDirectory(directory))
      if (!wanted.has(name)) yield* fs.remove(path.join(directory, name), { recursive: true });
  }
  // Each object takes its final name only once complete, so an interrupted copy is never reused.
  for (const { source, target } of missing) {
    const partial = `${target}${PARTIAL_SUFFIX}`;
    yield* fs.copyFile(source, partial);
    yield* fs.chmod(partial, 0o600);
    yield* syncFile(partial);
    yield* fs.rename(partial, target);
  }
  for (const { kind } of kinds)
    yield* syncFile(path.join(input.directory, "objects", "project-library", kind));
});
// Describes the database already in `directory`, then marks the directory complete.
const finishSnapshot = Effect.fnUntraced(function* (input: {
  directory: string;
  stateDir: string;
  spaceDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const database = path.join(input.directory, "statev2.sqlite");
  const checksum = yield* timed("fingerprint", fingerprint(database));
  const manifest = yield* timed(
    "manifest",
    Maintenance.LibraryMaintenance.use((service) =>
      service.manifest({ databaseDigest: checksum.digest, databaseBytes: checksum.bytes }),
    ).pipe(Effect.provide(sourceLayer(database, input.stateDir))),
  );
  // Not kept for diagnosis: a rerun reproduces this manifest without leaving a database copy.
  if (!manifest.assetBytesVerified || !manifest.recoveryBytesVerified)
    return yield* new LibraryError({
      reason: "blocked",
      cause: `Library assets or recovery archives failed verification (${manifest.missingReferences.length} missing references), so no backup was kept.`,
    });
  if (manifest.storageMode === "local")
    yield* timed("objects", syncObjects({ ...input, manifest }));
  const manifestFile = path.join(input.directory, "manifest.json");
  // Only a replica has a previous manifest. Its marker goes first, so a crash between the two
  // removals cannot leave a marker without the manifest it names.
  yield* fs.remove(path.join(input.directory, "complete"), { force: true });
  yield* fs.remove(manifestFile, { force: true });
  yield* fs.writeFileString(manifestFile, yield* encodeManifest(manifest), {
    flag: "wx",
    mode: 0o600,
  });
  yield* syncFile(manifestFile);
  yield* fs.writeFileString(
    path.join(input.directory, "complete"),
    (yield* fingerprint(manifestFile)).digest,
    { flag: "wx", mode: 0o600 },
  );
  yield* syncFile(path.join(input.directory, "complete"));
  yield* syncFile(input.directory);
  return manifest;
});
export const createLibraryBackup = Effect.fnUntraced(function* (input: {
  database: string;
  stateDir: string;
  backupsDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const time = DateTime.toEpochMillis(yield* DateTime.now);
  yield* ensureNoSnapshotRunning(input.backupsDir, time);
  yield* ensureFreeSpace(
    input.backupsDir,
    (yield* fileBytes(input.database)) + (yield* fileBytes(`${input.database}-wal`)),
  );
  const directory = path.join(input.backupsDir, `library-backup-${time}-${yield* randomUuidV4}`);
  const staging = `${directory}${PARTIAL_SUFFIX}`;
  const build = Effect.gen(function* () {
    yield* timed("copy", sqliteCopy(input.database, path.join(staging, "statev2.sqlite")));
    const manifest = yield* finishSnapshot({
      directory: staging,
      stateDir: input.stateDir,
      spaceDir: input.backupsDir,
    });
    yield* fs.rename(staging, directory);
    yield* syncFile(input.backupsDir);
    return { directory, manifest };
  });
  return yield* Effect.acquireUseRelease(
    fs
      .makeDirectory(input.backupsDir, { recursive: true, mode: 0o700 })
      .pipe(Effect.andThen(fs.makeDirectory(staging, { mode: 0o700 }))),
    () => build,
    // Prune removes anything a hard kill leaves behind once it is stale.
    (_, exit) =>
      Exit.isSuccess(exit)
        ? Effect.void
        : fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore),
  );
});
// Milliseconds since the epoch when the running sync started, or null when none is marked.
// An unreadable marker reads as NaN, which counts as stale.
const replicaSyncStarted = (replicaDir: string) =>
  Effect.flatMap(Effect.all([FileSystem.FileSystem, Path.Path]), ([fs, path]) =>
    fs.readFileString(path.join(replicaDir, REPLICA_SYNCING)).pipe(
      Effect.map((text) => Number.parseInt(text, 10)),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
    ),
  );
// Brings one standing copy up to date in place. sqlite3_rsync sends only changed pages and
// commits them in one replica transaction, so an interrupted sync leaves the previous state,
// which the next run repairs.
export const createLibraryReplica = Effect.fnUntraced(function* (input: {
  database: string;
  stateDir: string;
  replicaDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  const marker = path.join(input.replicaDir, REPLICA_SYNCING);
  const replica = path.join(input.replicaDir, "statev2.sqlite");
  const started = yield* replicaSyncStarted(input.replicaDir);
  if (started !== null && now - started < STALE_SNAPSHOT_MS)
    return yield* new LibraryError({
      reason: "request-conflict",
      cause: `Another Library replica sync started at ${DateTime.formatIso(DateTime.makeUnsafe(started))} in ${input.replicaDir}. If it was interrupted, a run six hours after it started takes over.`,
    });
  if (started !== null) yield* fs.remove(marker, { force: true });
  // The rollback journal can hold every page a sync replaces, so allow for a full copy.
  yield* ensureFreeSpace(
    input.replicaDir,
    Math.max(
      (yield* fileBytes(input.database)) + (yield* fileBytes(`${input.database}-wal`)),
      yield* fileBytes(replica),
    ),
  );
  const build = Effect.gen(function* () {
    // The previous manifest stays until a new one replaces it. A sync that fails rolls the
    // replica back, so it still verifies; one that commits changes the database digest, so it
    // stops verifying until the new manifest lands.
    const sync = yield* LibraryReplicaSync;
    const report = yield* timed("sync", sync(input.database, replica));
    for (const line of report.split("\n"))
      if (line.trim()) yield* Console.log(`sqlite3_rsync: ${line}`);
    yield* timed("settle", settleReplica(replica));
    const manifest = yield* finishSnapshot({
      directory: input.replicaDir,
      stateDir: input.stateDir,
      spaceDir: input.replicaDir,
    });
    return { directory: input.replicaDir, manifest };
  });
  return yield* Effect.acquireUseRelease(
    fs.makeDirectory(input.replicaDir, { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(fs.writeFileString(marker, String(now), { flag: "wx", mode: 0o600 })),
      Effect.catchReason("PlatformError", "AlreadyExists", () =>
        Effect.fail(
          new LibraryError({
            reason: "request-conflict",
            cause: `Another Library replica sync started in ${input.replicaDir} at the same moment.`,
          }),
        ),
      ),
    ),
    () => build,
    () => fs.remove(marker, { force: true }).pipe(Effect.ignore),
  );
});
export const verifyLibraryBackup = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(path.join(directory, "complete"))))
    return yield* new LibraryError({
      reason: "invalid",
      cause: `${directory} has no complete marker, so its snapshot never finished.`,
    });
  // A killed sync can leave a hot journal, which a read-only restore cannot roll back. The
  // next snapshot run rolls it back.
  for (const suffix of ["-journal", "-wal"])
    if (yield* fs.exists(path.join(directory, `statev2.sqlite${suffix}`)))
      return yield* new LibraryError({
        reason: "invalid",
        cause: `${directory} holds statev2.sqlite${suffix} from an interrupted sync; the next snapshot run repairs it.`,
      });
  const manifest = yield* decodeManifest(
    yield* fs.readFileString(path.join(directory, "manifest.json")),
  );
  const manifestChecksum = yield* fingerprint(path.join(directory, "manifest.json"));
  const complete = yield* fs.readFileString(path.join(directory, "complete"));
  if (complete !== manifestChecksum.digest) return yield* new LibraryError({ reason: "invalid" });
  const checksum = yield* fingerprint(path.join(directory, "statev2.sqlite"));
  if (checksum.digest !== manifest.database.digest || checksum.bytes !== manifest.database.bytes)
    return yield* new LibraryError({ reason: "invalid" });
  const environment = yield* HostProcess.Environment;
  const verification = yield* Maintenance.LibraryMaintenance.use((service) =>
    service.verifyAssets(manifest),
  ).pipe(
    Effect.provide(
      sourceLayer(path.join(directory, "statev2.sqlite"), path.join(directory, "objects")),
    ),
    Effect.provideService(HostProcess.Environment, {
      ...environment,
      LOOM_ASSETS_BACKEND: manifest.storageMode,
    }),
  );
  if (!verification.verified) return yield* new LibraryError({ reason: "blocked" });
  return {
    manifest,
    database: path.join(directory, "statev2.sqlite"),
    nextAuthorityEpoch: manifest.authority.epoch + 1,
  };
});
export const restoreLibraryBackup = Effect.fnUntraced(function* (input: {
  directory: string;
  destination: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const destination = path.resolve(input.destination);
  const parent = yield* fs.realPath(path.dirname(destination));
  const live = path.join(home, ".t3", "userdata");
  if (parent === live || parent.startsWith(`${live}${path.sep}`))
    return yield* new LibraryError({ reason: "blocked" });
  const backup = yield* verifyLibraryBackup(input.directory);
  yield* sqliteCopy(backup.database, destination);
  const requestId = `restore-${yield* randomUuidV4}`;
  const next = yield* Maintenance.LibraryMaintenance.use((service) =>
    service.rotateAuthorityEpoch({
      requestId,
      expectedAuthorityId: backup.manifest.authority.id,
      expectedEpoch: backup.manifest.authority.epoch,
    }),
  ).pipe(Effect.provide(sourceLayer(destination, path.join(input.directory, "objects"), false)));
  return {
    destination,
    authority: next,
    objectsDir:
      backup.manifest.storageMode === "local" ? path.join(input.directory, "objects") : null,
  };
});
const inspectReplica = Effect.fnUntraced(function* (replicaDir: string, now: number) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const started = yield* replicaSyncStarted(replicaDir);
  if (started !== null && now - started < STALE_SNAPSHOT_MS) return { state: "syncing" as const };
  if (!(yield* fs.exists(path.join(replicaDir, "statev2.sqlite"))))
    return { state: "absent" as const };
  const verified = yield* verifyLibraryBackup(replicaDir).pipe(Effect.option);
  return Option.isSome(verified)
    ? { state: "verified" as const, createdAt: Date.parse(verified.value.manifest.createdAt) }
    : { state: "unverified" as const };
});
// With a replica given, a dated backup older than a verified replica stops counting toward
// `keep`: the replica and the volume backups' own history stand in for it. Without one, or
// while it does not verify, `keep` holds as before. Prune never changes the replica.
export const pruneLibraryBackups = Effect.fnUntraced(function* (input: {
  backupsDir: string;
  keep: number;
  days: number;
  replicaDir?: string | undefined;
}) {
  if (
    !Number.isInteger(input.keep) ||
    input.keep < 1 ||
    !Number.isInteger(input.days) ||
    input.days < 1
  )
    return yield* new LibraryError({ reason: "invalid" });
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(input.backupsDir);
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  const eligible: { directory: string; createdAt: number }[] = [];
  const unverified: string[] = [];
  const inProgress: string[] = [];
  const stalePartial: string[] = [];
  const staleIncomplete: string[] = [];
  for (const name of yield* fs.readDirectory(root)) {
    const match = BACKUP_NAME.exec(name);
    if (!match) continue;
    const directory = path.join(root, name);
    // A snapshot renames or removes its staging directory as it ends, perhaps after this listing.
    const entry = yield* Effect.all([fs.stat(directory), fs.realPath(directory)]).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
    );
    if (entry === null || entry[0].type !== "Directory" || entry[1] !== directory) continue;
    const partial = match[2] !== undefined;
    if (!partial && (yield* fs.exists(path.join(directory, "complete")))) {
      const verified = yield* verifyLibraryBackup(directory).pipe(Effect.option);
      // A finished backup that no longer verifies is evidence to investigate, not garbage.
      if (verified._tag === "None") unverified.push(directory);
      else eligible.push({ directory, createdAt: Date.parse(verified.value.manifest.createdAt) });
      continue;
    }
    // Final-named directories without a complete marker predate staging. They were interrupted, or
    // an asset check failed, and neither kind can be restored.
    if (now - Number(match[1]) < STALE_SNAPSHOT_MS) {
      inProgress.push(directory);
      continue;
    }
    yield* fs.remove(directory, { recursive: true, force: true });
    (partial ? stalePartial : staleIncomplete).push(directory);
  }
  const replica =
    input.replicaDir === undefined ? null : yield* inspectReplica(input.replicaDir, now);
  eligible.sort((a, b) => b.createdAt - a.createdAt);
  const removed: string[] = [];
  for (const [index, backup] of eligible.entries())
    if (
      (index >= input.keep ||
        (replica?.state === "verified" && backup.createdAt < replica.createdAt)) &&
      backup.createdAt < now - input.days * 86400000
    ) {
      yield* fs.remove(backup.directory, { recursive: true });
      removed.push(backup.directory);
    }
  return {
    retained: eligible.length - removed.length,
    removed,
    stalePartial,
    staleIncomplete,
    unverified,
    inProgress,
    replica,
  };
});
const snapshot = Command.make(
  "snapshot",
  {
    database: Flag.String("database"),
    stateDir: Flag.String("state-dir"),
    backupsDir: Flag.String("backups-dir").pipe(Flag.optional),
    replicaDir: Flag.String("replica-dir").pipe(Flag.optional),
  },
  ({ database, stateDir, backupsDir, replicaDir }) => {
    const [target, run] =
      Option.isSome(replicaDir) && Option.isNone(backupsDir)
        ? ([
            "replica",
            createLibraryReplica({ database, stateDir, replicaDir: replicaDir.value }),
          ] as const)
        : Option.isSome(backupsDir) && Option.isNone(replicaDir)
          ? ([
              "backup",
              createLibraryBackup({ database, stateDir, backupsDir: backupsDir.value }),
            ] as const)
          : ([
              "backup",
              Effect.fail(
                new LibraryError({
                  reason: "invalid",
                  cause: "Pass exactly one of --backups-dir or --replica-dir.",
                }),
              ),
            ] as const);
    const flag = target === "replica" ? "--replica-dir" : "--backups-dir";
    return run.pipe(
      Effect.catchIf(
        (error): error is LibraryError =>
          isLibraryError(error) &&
          (error.reason === "storage-limit" || error.reason === "request-conflict"),
        (error) =>
          Effect.fail(
            new LibrarySnapshotSkipped({
              message: `${String(error.cause)} No ${target} was written.${error.reason === "storage-limit" ? ` Free space on that volume or pass a ${flag} on a larger one.` : ""}`,
            }),
          ),
      ),
      Effect.flatMap((result) => Console.log(`Verified Library ${target}: ${result.directory}`)),
    );
  },
);
const verify = Command.make("verify", { directory: Flag.String("directory") }, ({ directory }) =>
  verifyLibraryBackup(directory).pipe(
    Effect.flatMap((result) =>
      Console.log(
        `Verified backup: ${result.manifest.projects} projects, ${result.manifest.threads} conversations, ${result.manifest.assets.length} assets, ${result.manifest.recovery.length} recovery archives.`,
      ),
    ),
  ),
);
const restorePreview = Command.make(
  "restore-preview",
  { directory: Flag.String("directory") },
  ({ directory }) =>
    verifyLibraryBackup(directory).pipe(
      Effect.flatMap((result) =>
        Console.log(
          `Restore will preserve authority ${result.manifest.authority.id} and fence prior hosts with epoch ${result.nextAuthorityEpoch}.`,
        ),
      ),
    ),
);
const restore = Command.make(
  "restore",
  { directory: Flag.String("directory"), destination: Flag.String("destination") },
  (input) =>
    restoreLibraryBackup(input).pipe(
      Effect.flatMap((result) =>
        Console.log(
          `Restored isolated database: ${result.destination}. Authority epoch ${result.authority.epoch}.`,
        ),
      ),
    ),
);
const prune = Command.make(
  "prune",
  {
    backupsDir: Flag.String("backups-dir"),
    keep: Flag.Int("keep").pipe(Flag.withDefault(7)),
    days: Flag.Int("days").pipe(Flag.withDefault(30)),
    replicaDir: Flag.String("replica-dir").pipe(Flag.optional),
  },
  ({ replicaDir, ...input }) =>
    pruneLibraryBackups({ ...input, replicaDir: Option.getOrUndefined(replicaDir) }).pipe(
      Effect.flatMap((result) =>
        Effect.gen(function* () {
          yield* Console.log(
            `Retained ${result.retained} verified backups and ${result.unverified.length} that failed verification; removed ${result.removed.length} past retention, ${result.stalePartial.length} interrupted snapshots and ${result.staleIncomplete.length} incomplete legacy backups; left ${result.inProgress.length} snapshots that may still be running.`,
          );
          for (const directory of result.unverified)
            yield* Console.warn(`Investigate this backup; it failed verification: ${directory}`);
          const replica = result.replica;
          if (replica === null || Option.isNone(replicaDir)) return;
          if (replica.state === "verified")
            yield* Console.log(
              `Verified Library replica from ${DateTime.formatIso(DateTime.makeUnsafe(replica.createdAt))}: ${replicaDir.value}`,
            );
          else if (replica.state === "unverified")
            yield* Console.warn(
              `Investigate the Library replica; it failed verification, so --keep still applies: ${replicaDir.value}`,
            );
          else
            yield* Console.log(
              `The Library replica is ${replica.state === "syncing" ? "syncing" : "not written yet"}, so --keep still applies: ${replicaDir.value}`,
            );
        }),
      ),
    ),
);
export const loomLibraryBackupCommand = Command.make("library-backup").pipe(
  Command.withSubcommands([snapshot, verify, restorePreview, restore, prune]),
);
// Bundled executables can expose import.meta.main for imported scripts as well as bin.ts.
if (import.meta.main && process.argv[1]?.replaceAll("\\", "/").endsWith("/loom-library-backup.ts"))
  Command.run(loomLibraryBackupCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
