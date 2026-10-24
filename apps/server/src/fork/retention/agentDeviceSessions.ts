import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/**
 * agent-device writes a folder per session (event log, app log, screenshots,
 * recordings) and never removes one.
 */
export const IDLE_AGENT_DEVICE_SESSION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A fresh agent-device daemon reads these records from session folders to stop
 * capture processes a dead daemon left running: the legacy `app-log.pid`, and a
 * `*.resource.json` manifest until its lifecycle reaches `completed`. A capture
 * can run silent for weeks, so its folder's age says nothing about it.
 */
const APP_LOG_PID_FILE = "app-log.pid";
const RESOURCE_RECORD_SUFFIX = ".resource.json";
const decodeCompletedResourceRecord = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ lifecycle: Schema.Literal("completed") })),
);

/**
 * Effect's `stat` follows links, so a path that does not resolve to itself under
 * the already resolved sessions directory is a link, or vanished, and is skipped.
 */
const isLinkOrGone = (fs: FileSystem.FileSystem, target: string) =>
  fs.realPath(target).pipe(
    Effect.map((resolved) => resolved !== target),
    Effect.orElseSucceed(() => true),
  );

// Untraced: one walk per session folder, and the prune already has a span.
const changedSince = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  folder: string,
  cutoffMs: number,
) {
  const pending = [folder];
  while (pending.length > 0) {
    const target = pending.pop()!;
    if (yield* isLinkOrGone(fs, target)) continue;
    const info = yield* fs.stat(target);
    if (!Option.exists(info.mtime, (mtime) => mtime.getTime() < cutoffMs)) return true;
    if (info.type === "Directory") {
      for (const name of yield* fs.readDirectory(target)) pending.push(path.join(target, name));
    }
  }
  return false;
});

// Untraced for the same reason as `changedSince`. A record that is a link or
// cannot be read is treated as live rather than followed.
const holdsProcessRecord = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  folder: string,
) {
  for (const name of yield* fs.readDirectory(folder)) {
    if (name === APP_LOG_PID_FILE) return true;
    if (!name.endsWith(RESOURCE_RECORD_SUFFIX)) continue;
    const record = path.join(folder, name);
    if (yield* isLinkOrGone(fs, record)) return true;
    const raw = yield* fs.readFileString(record).pipe(Effect.orElseSucceed(() => ""));
    if (Option.isNone(decodeCompletedResourceRecord(raw))) return true;
  }
  return false;
});

/**
 * Removes session folders under `stateDir/sessions` that nothing has written to
 * for 14 days. Call it only while no agent-device daemon runs on `stateDir`:
 * sessions, and the devices they hold, exist only inside a running daemon, so
 * none of these folders can belong to an open device then. Folders holding a
 * capture process record are kept for that daemon's recovery. Links, including
 * a linked `sessions` folder, are never followed, and failures are logged
 * without failing the caller.
 */
export const pruneIdleAgentDeviceSessions = Effect.fn("AgentDeviceSessions.pruneIdle")(
  function* (fs: FileSystem.FileSystem, path: Path.Path, stateDir: string) {
    const sessionsDir = path.join(stateDir, "sessions");
    if (!(yield* fs.exists(sessionsDir))) return;
    const root = yield* fs.realPath(sessionsDir);
    if (root !== path.join(yield* fs.realPath(stateDir), "sessions")) {
      yield* Effect.logInfo("Skipped pruning agent-device sessions behind a link", { root });
      return;
    }
    const cutoffMs = (yield* Clock.currentTimeMillis) - IDLE_AGENT_DEVICE_SESSION_MS;
    let removed = 0;
    const failures: Cause.Cause<unknown>[] = [];
    for (const name of yield* fs.readDirectory(root)) {
      const folder = path.join(root, name);
      yield* Effect.gen(function* () {
        if (yield* isLinkOrGone(fs, folder)) return;
        if ((yield* fs.stat(folder)).type !== "Directory") return;
        if (yield* changedSince(fs, path, folder, cutoffMs)) return;
        if (yield* holdsProcessRecord(fs, path, folder)) return;
        // Node's recursive remove unlinks links inside the folder without following them.
        yield* fs.remove(folder, { recursive: true });
        removed++;
      }).pipe(Effect.catchCause((cause) => Effect.sync(() => failures.push(cause))));
    }
    if (removed > 0) {
      yield* Effect.logInfo("Removed idle agent-device session folders", { removed });
    }
    if (failures.length > 0) {
      yield* Effect.logWarning("Could not prune some agent-device session folders", {
        failed: failures.length,
        cause: failures[0],
      });
    }
  },
  Effect.catchCause((cause) =>
    Effect.logWarning("Could not prune idle agent-device session folders", { cause }),
  ),
);
