import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import {
  IDLE_AGENT_DEVICE_SESSION_MS,
  pruneIdleAgentDeviceSessions,
} from "./agentDeviceSessions.ts";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE = NOW - IDLE_AGENT_DEVICE_SESSION_MS - DAY_MS;
const RECENT = NOW - DAY_MS;

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agent-device-sessions-" });
  const stateDir = path.join(base, "agent-device");
  const sessions = path.join(stateDir, "sessions");
  yield* fs.makeDirectory(sessions, { recursive: true });
  yield* TestClock.setTime(NOW);

  // Numeric times are seconds, as in Node's `utimes`.
  const dated = (target: string, mtimeMs: number) =>
    fs.utimes(target, mtimeMs / 1000, mtimeMs / 1000);

  /** Writes dated files under `root`, then marks the folders the writes touched as idle. */
  const tree = Effect.fnUntraced(function* (
    root: string,
    files: ReadonlyArray<readonly [relative: string, mtimeMs: number, contents?: string]>,
  ) {
    const folders = new Set([root]);
    for (const [relative, mtimeMs, contents = "log"] of files) {
      const file = path.join(root, relative);
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(file, contents);
      yield* dated(file, mtimeMs);
      for (let folder = path.dirname(file); folder !== root; folder = path.dirname(folder)) {
        folders.add(folder);
      }
    }
    for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
      yield* dated(folder, IDLE);
    }
    return root;
  });

  const prune = pruneIdleAgentDeviceSessions(fs, path, stateDir);
  return { fs, path, base, sessions, dated, tree, prune };
});

describe("pruneIdleAgentDeviceSessions", () => {
  it.effect("removes session folders idle for 14 days and keeps ones written since", () =>
    Effect.gen(function* () {
      const { fs, path, sessions, dated, tree, prune } = yield* fixture;
      const idle = yield* tree(path.join(sessions, "t3-idle"), [
        ["app.log", IDLE],
        ["requests/req-1.ndjson", IDLE],
      ]);
      const recent = yield* tree(path.join(sessions, "t3-recent"), [
        ["app.log", IDLE],
        ["artifacts/screens/shot.png", RECENT],
      ]);
      const script = path.join(sessions, "t3-recent-2026-10-01.ad");
      yield* fs.writeFileString(script, "open");
      yield* dated(script, IDLE);

      yield* prune;

      assert.isFalse(yield* fs.exists(idle));
      assert.isTrue(yield* fs.exists(path.join(recent, "app.log")));
      assert.isTrue(yield* fs.exists(script));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("never follows links out of the sessions directory", () =>
    Effect.gen(function* () {
      const { fs, path, base, sessions, dated, tree, prune } = yield* fixture;
      const idleTarget = yield* tree(path.join(base, "idle-target"), [["keep.log", IDLE]]);
      const recentTarget = yield* tree(path.join(base, "recent-target"), [["fresh.log", RECENT]]);
      const linkedSession = path.join(sessions, "t3-linked");
      yield* fs.symlink(idleTarget, linkedSession);
      // Followed, the link would make this folder look recent, and removal would reach the target.
      const idle = yield* tree(path.join(sessions, "t3-idle"), [["app.log", IDLE]]);
      yield* fs.symlink(recentTarget, path.join(idle, "recordings"));
      yield* dated(idle, IDLE);

      yield* prune;

      assert.strictEqual(yield* fs.readLink(linkedSession), idleTarget);
      assert.isTrue(yield* fs.exists(path.join(idleTarget, "keep.log")));
      assert.isFalse(yield* fs.exists(idle));
      assert.isTrue(yield* fs.exists(path.join(recentTarget, "fresh.log")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps idle folders whose capture process a fresh daemon still has to stop", () =>
    Effect.gen(function* () {
      const { fs, path, sessions, tree, prune } = yield* fixture;
      const record = (lifecycle: string) => JSON.stringify({ envelopeVersion: 1, lifecycle });
      const legacyCapture = yield* tree(path.join(sessions, "t3-legacy-capture"), [
        ["app.log", IDLE],
        ["app-log.pid", IDLE, "{}"],
      ]);
      const openCapture = yield* tree(path.join(sessions, "t3-open-capture"), [
        ["screen-recording.resource.json", IDLE, record("open")],
      ]);
      const unreadableRecord = yield* tree(path.join(sessions, "t3-unreadable-record"), [
        ["app-log.resource.json", IDLE, "{"],
      ]);
      const finishedCapture = yield* tree(path.join(sessions, "t3-finished-capture"), [
        ["app.log", IDLE],
        ["app-log.resource.json", IDLE, record("completed")],
      ]);

      yield* prune;

      assert.isTrue(yield* fs.exists(path.join(legacyCapture, "app-log.pid")));
      assert.isTrue(yield* fs.exists(openCapture));
      assert.isTrue(yield* fs.exists(unreadableRecord));
      assert.isFalse(yield* fs.exists(finishedCapture));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves a linked sessions folder alone", () =>
    Effect.gen(function* () {
      const { fs, path, base, sessions, tree, prune } = yield* fixture;
      const elsewhere = path.join(base, "elsewhere");
      const unrelated = yield* tree(path.join(elsewhere, "unrelated"), [["data.bin", IDLE]]);
      yield* fs.remove(sessions, { recursive: true });
      yield* fs.symlink(elsewhere, sessions);

      yield* prune;

      assert.isTrue(yield* fs.exists(path.join(unrelated, "data.bin")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
