import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import type * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import {
  buildRecordName,
  recordInstalledBuild,
  rollbackSnapshotPaths,
  saveRollbackSnapshot,
} from "./RollbackSnapshot.ts";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("rollbackSnapshotPaths", () => {
  const environment = (overrides: Record<string, unknown>) =>
    ({
      platform: "darwin",
      isPackaged: true,
      isDevelopment: false,
      resourcesPath: "/Applications/Loom.app/Contents/Resources",
      homeDirectory: "/Users/k",
      appDataDirectory: "/Users/k/Library/Application Support",
      stateDir: "/Users/k/.t3/userdata",
      ...overrides,
    }) as unknown as DesktopEnvironment.DesktopEnvironment["Service"];

  it.effect("covers only the installed app running on the data loom.sh restores", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const at = (overrides: Record<string, unknown>) =>
        rollbackSnapshotPaths(environment({ path, ...overrides }));
      assert.deepEqual(at({}), {
        buildsDirectory: "/Users/k/Library/Application Support/Loom Builds",
        buildEnvPath: "/Applications/Loom.app/Contents/Resources/loom-build.env",
        userdata: "/Users/k/.t3/userdata",
      });
      assert.isNull(at({ isPackaged: false }));
      assert.isNull(at({ isDevelopment: true }));
      assert.isNull(at({ platform: "win32" }));
      assert.isNull(at({ resourcesPath: "/Users/k/Downloads/Loom.app/Contents/Resources" }));
      assert.isNull(at({ stateDir: "/Users/k/.t3/dev" }));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("buildRecordName", () => {
  it("names the record as the publisher does", () => {
    assert.strictEqual(
      buildRecordName(`version=0.0.133-nightly.1\nupstream=v0.1.3\ncommit=${COMMIT}\n`),
      "0.0.133-nightly.1-0123456789",
    );
    assert.strictEqual(buildRecordName(`upstream=0.0.46\ncommit=${COMMIT}\n`), "0.0.46-0123456789");
    assert.isNull(buildRecordName("version=0.0.133\ncommit=main\n"));
  });
});

const harness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "rollback-snapshot-" });
  const buildsDirectory = path.join(root, "Loom Builds");
  const userdata = path.join(root, "userdata");
  const resources = path.join(root, "Resources");
  yield* fs.makeDirectory(userdata, { recursive: true });
  yield* fs.makeDirectory(resources, { recursive: true });
  const record = (name: string) =>
    Effect.gen(function* () {
      const dir = path.join(buildsDirectory, name);
      yield* fs.makeDirectory(path.join(dir, "updates"), { recursive: true });
      yield* fs.writeFileString(path.join(dir, "updates", "ready"), "");
      yield* fs.writeFileString(path.join(dir, "build.env"), `commit=${COMMIT}\n`);
      return dir;
    });
  const saveState = (dir: string, savedAt: number) =>
    Effect.gen(function* () {
      yield* fs.makeDirectory(path.join(dir, "state"), { recursive: true });
      yield* fs.writeFileString(path.join(dir, "state", "statev2.sqlite"), `saved at ${savedAt}`);
      yield* fs.utimes(path.join(dir, "state"), savedAt, savedAt);
    });
  const running = yield* record(`0.0.132-0123456789`);
  yield* fs.writeFileString(
    path.join(resources, "loom-build.env"),
    `version=0.0.132\ncommit=${COMMIT}\n`,
  );
  const live: ReadonlyArray<readonly [string, string]> = [
    ["statev2.sqlite", "database"],
    ["statev2.sqlite-wal", "uncheckpointed"],
    ["statev2.sqlite-shm", "index"],
    ["settings.json", "{}"],
  ];
  for (const [name, contents] of live) {
    yield* fs.writeFileString(path.join(userdata, name), contents);
  }
  const paths = {
    buildsDirectory,
    buildEnvPath: path.join(resources, "loom-build.env"),
    userdata,
  };
  const read = (file: string) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));
  return { fs, path, buildsDirectory, userdata, running, record, saveState, paths, read };
});

it.layer(NodeServices.layer)("saveRollbackSnapshot", (it) => {
  it.effect("saves each database with its WAL and the settings into the running build", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.saveState(h.running, 1);
        yield* saveRollbackSnapshot(h.paths);
        const state = h.path.join(h.running, "state");
        assert.strictEqual(yield* h.read(h.path.join(state, "statev2.sqlite")), "database");
        assert.strictEqual(
          yield* h.read(h.path.join(state, "statev2.sqlite-wal")),
          "uncheckpointed",
        );
        assert.strictEqual(yield* h.read(h.path.join(state, "settings.json")), "{}");
        assert.deepEqual((yield* h.fs.readDirectory(state)).sort(), [
          "settings.json",
          "statev2.sqlite",
          "statev2.sqlite-wal",
        ]);
        assert.deepEqual((yield* h.fs.readDirectory(h.running)).sort(), [
          "build.env",
          "state",
          "updates",
        ]);
      }),
    ),
  );

  it.effect("keeps the two newest snapshots", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        const oldest = yield* h.record("0.0.130-aaaaaaaaaa");
        const previous = yield* h.record("0.0.131-bbbbbbbbbb");
        yield* h.saveState(oldest, 1_000);
        yield* h.saveState(previous, 2_000);
        const beforeLoom = h.path.join(h.buildsDirectory, "before-loom");
        yield* h.saveState(beforeLoom, 500);
        yield* saveRollbackSnapshot(h.paths);
        assert.isFalse(yield* h.fs.exists(h.path.join(oldest, "state")));
        assert.isTrue(yield* h.fs.exists(h.path.join(previous, "state")));
        assert.isTrue(yield* h.fs.exists(h.path.join(h.running, "state")));
        assert.isTrue(yield* h.fs.exists(h.path.join(beforeLoom, "state")));
      }),
    ),
  );

  it.effect("discards the copy and keeps the last snapshot when the database changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.saveState(h.running, 1);
        const copyWhileWriting = ChildProcessSpawner.make((command) =>
          Effect.gen(function* () {
            const [, from, to] = (command as unknown as { readonly args: ReadonlyArray<string> })
              .args;
            yield* h.fs.copyFile(from!, to!);
            yield* h.fs.writeFileString(
              h.path.join(h.userdata, "statev2.sqlite-wal"),
              "a later write",
            );
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              unref: Effect.succeed(Effect.void),
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
            });
          }).pipe(Effect.orDie),
        );
        const exit = yield* saveRollbackSnapshot(h.paths).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, copyWhileWriting),
          Effect.exit,
        );
        assert.isTrue(exit._tag === "Failure");
        const state = h.path.join(h.running, "state");
        assert.deepEqual(yield* h.fs.readDirectory(state), ["statev2.sqlite"]);
        assert.strictEqual(yield* h.read(h.path.join(state, "statev2.sqlite")), "saved at 1");
        assert.deepEqual((yield* h.fs.readDirectory(h.running)).sort(), [
          "build.env",
          "state",
          "updates",
        ]);
      }),
    ),
  );

  it.effect("skips a build the publisher never recorded", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.fs.writeFileString(h.paths.buildEnvPath, `version=9.9.9\ncommit=${COMMIT}\n`);
        yield* saveRollbackSnapshot(h.paths);
        assert.isFalse(yield* h.fs.exists(h.path.join(h.running, "state")));
      }),
    ),
  );
});

it.layer(NodeServices.layer)("recordInstalledBuild", (it) => {
  it.effect("points the legacy marker at the running build", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        const marker = h.path.join(h.buildsDirectory, "installed");
        yield* h.fs.writeFileString(marker, "0.0.46-nightly.20261013.3044-0d1e2f3a4b\n");
        yield* recordInstalledBuild(h.paths);
        assert.strictEqual(yield* h.read(marker), "0.0.132-0123456789\n");
      }),
    ),
  );
});
