// @effect-diagnostics nodeBuiltinImport:off - The free-space check needs statfs, which Effect's FileSystem does not expose.
import * as NodeFSP from "node:fs/promises";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../../app/DesktopObservability.ts";

// The in-app half of scripts/fork/loom.sh's rollback snapshots; keep the two in step.
/** loom.sh installs, snapshots and rolls back only this app. */
const INSTALLED_APP_PATH = "/Applications/Loom.app";
const BUILDS_DIRECTORY = "Loom Builds";
const INSTALLED_MARKER = "installed";
/** Each database with its WAL, which holds committed data not yet checkpointed. */
const DATABASE_FILES = ["state.sqlite", "statev2.sqlite"].flatMap((name) => [name, `${name}-wal`]);
const SETTINGS_FILES = ["settings.json", "client-settings.json"];
/** The data the previous build last ran with, and the outgoing data a rollback replaced. */
const KEEP_STATE_SNAPSHOTS = 2;
/** Head-room left beside a snapshot that has fully diverged from the live data. */
const SNAPSHOT_FREE_MARGIN_BYTES = 2 * 1024 ** 3;
/** Clones are instant; a disk without them copies, which must not hold up the update for long. */
const SNAPSHOT_TIMEOUT = Duration.seconds(30);

const { logInfo, logWarning } = makeComponentLogger("rollback-snapshot");

class RollbackSnapshotError extends Schema.TaggedError<RollbackSnapshotError>()(
  "RollbackSnapshotError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

export interface RollbackSnapshotPaths {
  readonly buildsDirectory: string;
  readonly buildEnvPath: string;
  readonly userdata: string;
}

/** Null unless this is the installed app whose data loom.sh restores. */
export function rollbackSnapshotPaths(
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
): RollbackSnapshotPaths | null {
  const path = environment.path;
  if (environment.platform !== "darwin" || !environment.isPackaged || environment.isDevelopment) {
    return null;
  }
  if (path.resolve(environment.resourcesPath, "..", "..") !== INSTALLED_APP_PATH) return null;
  const userdata = path.resolve(environment.stateDir);
  if (userdata !== path.join(environment.homeDirectory, ".t3", "userdata")) return null;
  return {
    buildsDirectory: path.join(environment.appDataDirectory, BUILDS_DIRECTORY),
    buildEnvPath: path.join(environment.resourcesPath, "loom-build.env"),
    userdata,
  };
}

/** The publisher names each build record `<version>-<first ten of commit>`. */
export function buildRecordName(buildEnv: string): string | null {
  const version = /^version=(.+)$/m.exec(buildEnv)?.[1] ?? /^upstream=(.+)$/m.exec(buildEnv)?.[1];
  const commit = /^commit=([0-9a-f]{40})$/m.exec(buildEnv)?.[1];
  return version && commit ? `${version}-${commit.slice(0, 10)}` : null;
}

const isPublishedRecord = Effect.fn("desktop.rollbackSnapshot.isPublishedRecord")(function* (
  record: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return (
    (yield* fs.exists(path.join(record, "build.env"))) &&
    (yield* fs.exists(path.join(record, "updates", "ready")))
  );
});

const installedRecord = Effect.fn("desktop.rollbackSnapshot.installedRecord")(function* (
  paths: RollbackSnapshotPaths,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const name = buildRecordName(yield* fs.readFileString(paths.buildEnvPath));
  if (name === null) return Option.none();
  const record = path.join(paths.buildsDirectory, name);
  return (yield* isPublishedRecord(record)) ? Option.some({ name, record }) : Option.none();
});

const freeDiskBytes = (directory: string) =>
  Effect.tryPromise({
    try: () => NodeFSP.statfs(directory),
    catch: () => new RollbackSnapshotError({ detail: "Could not check the free disk space." }),
  }).pipe(Effect.map((stats) => stats.bavail * stats.bsize));

const modifiedAt = (info: FileSystem.File.Info) =>
  Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() });

const stateFingerprint = Effect.fn("desktop.rollbackSnapshot.fingerprint")(function* (
  userdata: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* Effect.forEach(DATABASE_FILES, (name) =>
    fs.stat(path.join(userdata, name)).pipe(
      Effect.map((info) => ({
        name,
        bytes: Number(info.size),
        modified: modifiedAt(info),
      })),
      Effect.option,
    ),
  );
  return entries.flatMap((entry) => (Option.isSome(entry) ? [entry.value] : []));
});

const fingerprintKey = (
  entries: ReadonlyArray<{ name: string; bytes: number; modified: number }>,
) => entries.map(({ name, bytes, modified }) => `${name} ${bytes} ${modified}`).join("\n");

const clone = Effect.fn("desktop.rollbackSnapshot.clone")(function* (from: string, to: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // `cp -c` clones on APFS and copies elsewhere; Node cannot request a clone on macOS.
  // GNU cp (the Linux test runner) has no -c.
  const args = (yield* HostProcess.Platform) === "darwin" ? ["-c", from, to] : [from, to];
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make("/bin/cp", args, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }),
  );
  if (exitCode !== 0) {
    return yield* new RollbackSnapshotError({ detail: `Could not copy ${from}.` });
  }
});

/** Keeps the newest snapshots among published records; `before-loom` is left alone. */
const pruneSnapshots = Effect.fn("desktop.rollbackSnapshot.prune")(function* (
  buildsDirectory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const snapshots: Array<{ readonly state: string; readonly savedAt: number }> = [];
  for (const name of yield* fs.readDirectory(buildsDirectory)) {
    const record = path.join(buildsDirectory, name);
    const state = path.join(record, "state");
    if (!(yield* isPublishedRecord(record))) continue;
    const info = yield* fs.stat(state).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "Directory") continue;
    snapshots.push({ state, savedAt: modifiedAt(info.value) });
  }
  snapshots.sort((a, b) => b.savedAt - a.savedAt);
  for (const { state } of snapshots.slice(KEEP_STATE_SNAPSHOTS)) {
    yield* fs.remove(state, { recursive: true, force: true });
  }
});

/**
 * Saves the T3 data into the installed build's record, so `loom.sh rollback`
 * can return to that build with the data it last ran with. The database must
 * be closed; a change while saving discards the copy.
 */
export const saveRollbackSnapshot = Effect.fn("desktop.rollbackSnapshot.save")(function* (
  paths: RollbackSnapshotPaths,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const installed = yield* installedRecord(paths);
  if (Option.isNone(installed)) {
    yield* logInfo("rollback snapshot skipped: this build has no published record");
    return;
  }
  const { record } = installed.value;
  const before = yield* stateFingerprint(paths.userdata);
  const neededBytes =
    before.reduce((total, entry) => total + entry.bytes, 0) + SNAPSHOT_FREE_MARGIN_BYTES;
  const freeBytes = yield* freeDiskBytes(paths.userdata);
  if (freeBytes < neededBytes) {
    yield* logWarning("rollback snapshot skipped: not enough free disk space", {
      freeBytes,
      neededBytes,
    });
    return;
  }
  const stage = yield* fs.makeTempDirectory({ directory: record, prefix: ".state." });
  yield* Effect.gen(function* () {
    for (const name of [...before.map((entry) => entry.name), ...SETTINGS_FILES]) {
      const from = path.join(paths.userdata, name);
      if (yield* fs.exists(from)) yield* clone(from, path.join(stage, name));
    }
    const after = yield* stateFingerprint(paths.userdata);
    if (fingerprintKey(after) !== fingerprintKey(before)) {
      return yield* new RollbackSnapshotError({
        detail: "The database changed while it was being saved.",
      });
    }
    const state = path.join(record, "state");
    const old = path.join(record, "state.old");
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* fs.remove(old, { recursive: true, force: true });
        if (yield* fs.exists(state)) yield* fs.rename(state, old);
        yield* fs.rename(stage, state).pipe(
          Effect.tapError(() =>
            fs.exists(old).pipe(
              Effect.flatMap((exists) => (exists ? fs.rename(old, state) : Effect.void)),
              Effect.ignore,
            ),
          ),
        );
        yield* fs.remove(old, { recursive: true, force: true });
      }),
    );
  }).pipe(Effect.ensuring(fs.remove(stage, { recursive: true, force: true }).pipe(Effect.ignore)));
  yield* pruneSnapshots(paths.buildsDirectory);
  yield* logInfo("rollback snapshot saved", { record });
});

/** Keeps the legacy marker naming the running build, whichever path installed it. */
export const recordInstalledBuild = Effect.fn("desktop.rollbackSnapshot.recordInstalledBuild")(
  function* (paths: RollbackSnapshotPaths) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const installed = yield* installedRecord(paths);
    if (Option.isNone(installed)) return;
    const marker = path.join(paths.buildsDirectory, INSTALLED_MARKER);
    const recorded = yield* fs.readFileString(marker).pipe(
      Effect.map((text) => text.trim()),
      Effect.orElseSucceed(() => ""),
    );
    if (recorded !== installed.value.name) {
      yield* fs.writeFileString(marker, `${installed.value.name}\n`);
    }
  },
);

/**
 * Resolves to the snapshot DesktopUpdates runs once the backends have stopped
 * and before the updater quits. It never fails or holds up the install.
 */
export const makeSaveBeforeUpdate = Effect.gen(function* () {
  const paths = rollbackSnapshotPaths(yield* DesktopEnvironment.DesktopEnvironment);
  const context = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  >();
  if (paths === null) return Effect.void;
  return saveRollbackSnapshot(paths).pipe(
    Effect.timeoutOption(SNAPSHOT_TIMEOUT),
    Effect.flatMap(
      Option.match({
        onNone: () => logWarning("rollback snapshot stopped: it took too long"),
        onSome: () => Effect.void,
      }),
    ),
    Effect.catchCause((cause) => logWarning("rollback snapshot failed", { cause })),
    Effect.provide(context),
  );
});

export const recordInstalledBuildAtStartup = Effect.gen(function* () {
  const paths = rollbackSnapshotPaths(yield* DesktopEnvironment.DesktopEnvironment);
  if (paths !== null) yield* recordInstalledBuild(paths);
}).pipe(
  Effect.catchCause((cause) => logWarning("recording the installed build failed", { cause })),
  Effect.withSpan("desktop.rollbackSnapshot.recordAtStartup"),
);
