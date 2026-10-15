#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { LibraryError } from "@t3tools/contracts/fork";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as ServerConfig from "../src/config.ts";
import * as Maintenance from "../src/fork/project-library/LibraryMaintenance.ts";
import * as Assets from "../src/fork/project-library/assets/LibraryAssetService.ts";
import * as Recovery from "../src/fork/project-library/assets/LibraryRecoveryStore.ts";
import { sqliteSnapshot, fileFingerprint } from "../../../scripts/lib/loomLibrarySnapshot.ts";

const manifestCodec = Schema.fromJsonString(Maintenance.LibraryBackupManifest);
const encodeManifest = Schema.encodeEffect(manifestCodec);
const decodeManifest = Schema.decodeEffect(manifestCodec);
const fingerprint = (file: string) =>
  Effect.tryPromise({
    try: () => fileFingerprint(file),
    catch: () => new LibraryError({ reason: "io" }),
  });
const sqliteCopy = (source: string, destination: string) =>
  Effect.tryPromise({
    try: () => sqliteSnapshot(source, destination),
    catch: () => new LibraryError({ reason: "io" }),
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
const syncFile = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.scoped(fs.open(file).pipe(Effect.flatMap((handle) => handle.sync)));
});
export const createLibraryBackup = Effect.fnUntraced(function* (input: {
  database: string;
  stateDir: string;
  backupsDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const time = DateTime.toEpochMillis(yield* DateTime.now);
  const directory = path.join(input.backupsDir, `library-backup-${time}-${yield* randomUuidV4}`);
  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
  const database = path.join(directory, "statev2.sqlite");
  yield* sqliteCopy(input.database, database);
  const checksum = yield* fingerprint(database);
  const manifest = yield* Maintenance.LibraryMaintenance.use((service) =>
    service.manifest({ databaseDigest: checksum.digest, databaseBytes: checksum.bytes }),
  ).pipe(Effect.provide(sourceLayer(database, input.stateDir)));
  if (
    manifest.storageMode === "local" &&
    manifest.assetBytesVerified &&
    manifest.recoveryBytesVerified
  ) {
    const objects = path.join(directory, "objects", "project-library", "objects");
    const recovery = path.join(directory, "objects", "project-library", "recovery");
    yield* fs.makeDirectory(objects, { recursive: true, mode: 0o700 });
    yield* fs.makeDirectory(recovery, { recursive: true, mode: 0o700 });
    for (const asset of manifest.assets) {
      const target = path.join(objects, asset.digest);
      if (!(yield* fs.exists(target))) {
        yield* fs.copyFile(
          path.join(input.stateDir, "project-library", "objects", asset.digest),
          target,
        );
        yield* fs.chmod(target, 0o600);
        yield* syncFile(target);
      }
    }
    for (const archive of manifest.recovery) {
      const target = path.join(recovery, archive.digest);
      if (!(yield* fs.exists(target))) {
        yield* fs.copyFile(
          path.join(input.stateDir, "project-library", "recovery", archive.digest),
          target,
        );
        yield* fs.chmod(target, 0o600);
        yield* syncFile(target);
      }
    }
  }
  const manifestFile = path.join(directory, "manifest.json");
  yield* fs.writeFileString(manifestFile, yield* encodeManifest(manifest), {
    flag: "wx",
    mode: 0o600,
  });
  yield* syncFile(manifestFile);
  if (!manifest.assetBytesVerified || !manifest.recoveryBytesVerified)
    return yield* new LibraryError({ reason: "blocked" });
  yield* fs.writeFileString(
    path.join(directory, "complete"),
    (yield* fingerprint(manifestFile)).digest,
    { flag: "wx", mode: 0o600 },
  );
  yield* syncFile(path.join(directory, "complete"));
  yield* syncFile(directory);
  return { directory, manifest };
});
export const verifyLibraryBackup = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
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
export const pruneLibraryBackups = Effect.fnUntraced(function* (input: {
  backupsDir: string;
  keep: number;
  days: number;
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
  for (const name of yield* fs.readDirectory(root)) {
    if (!/^library-backup-\d+-[0-9a-f-]{36}$/.test(name)) continue;
    const directory = path.join(root, name);
    const stat = yield* fs.stat(directory);
    if (stat.type !== "Directory" || (yield* fs.realPath(directory)) !== directory) continue;
    const verified = yield* verifyLibraryBackup(directory).pipe(Effect.option);
    if (verified._tag === "Some")
      eligible.push({ directory, createdAt: Date.parse(verified.value.manifest.createdAt) });
  }
  eligible.sort((a, b) => b.createdAt - a.createdAt);
  const removed: string[] = [];
  for (const [index, backup] of eligible.entries())
    if (index >= input.keep && backup.createdAt < now - input.days * 86400000) {
      yield* fs.remove(backup.directory, { recursive: true });
      removed.push(backup.directory);
    }
  return { retained: eligible.length - removed.length, removed };
});
const snapshot = Command.make(
  "snapshot",
  {
    database: Flag.String("database"),
    stateDir: Flag.String("state-dir"),
    backupsDir: Flag.String("backups-dir"),
  },
  (input) =>
    createLibraryBackup(input).pipe(
      Effect.flatMap((result) => Console.log(`Verified Library backup: ${result.directory}`)),
    ),
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
  },
  (input) =>
    pruneLibraryBackups(input).pipe(
      Effect.flatMap((result) =>
        Console.log(
          `Retained ${result.retained} verified backups; removed ${result.removed.length}.`,
        ),
      ),
    ),
);
export const loomLibraryBackupCommand = Command.make("library-backup").pipe(
  Command.withSubcommands([snapshot, verify, restorePreview, restore, prune]),
);
if (import.meta.main)
  Command.run(loomLibraryBackupCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
