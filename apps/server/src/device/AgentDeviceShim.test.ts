// @effect-diagnostics nodeBuiltinImport:off - Exercises the generated launcher with a fake Electron runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ensureAgentDeviceShim } from "./AgentDeviceShim.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const windowsHost = HostProcess.Platform.defaultValue() === "win32";
const argumentsToForward = [
  "snapshot",
  "--config",
  "config with spaces",
  "--session",
  "test-session",
];
const expectedOutput = JSON.stringify({
  args: argumentsToForward,
  nodeMode: "1",
  retained: "retained-value",
  daemonUrl: null,
  daemonToken: null,
  daemonConfig: null,
});

const electronFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agent-device-shim-" });
  const electron = path.join(directory, "Electron runtime ' quoted");
  const realNode = `'${process.execPath.replaceAll("'", `'"'"'`)}'`;
  yield* fs.writeFileString(
    electron,
    `#!/bin/sh
if [ "\${ELECTRON_RUN_AS_NODE-}" != 1 ]; then
  echo "Fake Electron launched desktop mode instead of Node mode." >&2
  exit 91
fi
exec ${realNode} "$@"
`,
    { mode: 0o755 },
  );
  const entryPath = path.join(directory, "cli.mjs");
  yield* fs.writeFileString(
    entryPath,
    `console.log(JSON.stringify({
  args: process.argv.slice(2),
  nodeMode: process.env.ELECTRON_RUN_AS_NODE,
  retained: process.env.DEVICE_SHIM_TEST_VALUE,
  daemonUrl: process.env.AGENT_DEVICE_DAEMON_BASE_URL ?? null,
  daemonToken: process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN ?? null,
  daemonConfig: process.env.AGENT_DEVICE_CONFIG ?? null,
}));
`,
  );
  const shimDir = yield* ensureAgentDeviceShim({ entryPath, stateDir: directory }).pipe(
    Effect.provideService(HostProcess.ExecutablePath, electron),
    Effect.provideService(HostProcess.IsExecutable, false),
  );
  return {
    shimPath: path.join(shimDir, "agent-device"),
    launcherPath: path.join(shimDir, "agent-device-launcher.mjs"),
  };
});

const invocationEnvironment = (nodeMode: string | undefined): NodeJS.ProcessEnv => ({
  ...process.env,
  ELECTRON_RUN_AS_NODE: nodeMode,
  DEVICE_SHIM_TEST_VALUE: "retained-value",
  AGENT_DEVICE_DAEMON_BASE_URL: "http://wrong-host",
  AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fake-wrong-token",
  AGENT_DEVICE_CONFIG: "wrong-config",
});

describe("agent-device runtime isolation", () => {
  it.effect.skipIf(windowsHost)(
    "runs the POSIX shim in Node mode without depending on the caller's Electron environment",
    () =>
      Effect.gen(function* () {
        const { shimPath } = yield* electronFixture;
        for (const mode of [undefined, "0"]) {
          const result = yield* Effect.promise(() =>
            exec(shimPath, argumentsToForward, { env: invocationEnvironment(mode) }),
          );
          expect(result.stdout.trim()).toBe(expectedOutput);
        }
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect.skipIf(windowsHost)(
    "keeps the child runtime in Node mode when the JavaScript launcher is invoked directly",
    () =>
      Effect.gen(function* () {
        const { launcherPath } = yield* electronFixture;
        for (const mode of [undefined, "0"]) {
          const result = yield* Effect.promise(() =>
            exec(process.execPath, [launcherPath, ...argumentsToForward], {
              env: invocationEnvironment(mode),
            }),
          );
          expect(result.stdout.trim()).toBe(expectedOutput);
        }
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
