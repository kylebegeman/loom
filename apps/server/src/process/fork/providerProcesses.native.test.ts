// @effect-diagnostics nodeBuiltinImport:off -- this test only starts and signals its own fixture child.
import * as NodeChildProcess from "node:child_process";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderProcesses } from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../../config.ts";
import * as Processes from "./providerProcesses.ts";

it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "records and signals a real detached child without signalling its parent",
  () =>
    Effect.gen(function* () {
      const registry = yield* ProviderProcesses;
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const child = yield* Effect.acquireRelease(
        Effect.sync(() =>
          NodeChildProcess.spawn(process.execPath, ["-e", "process.stdin.resume()"], {
            detached: true,
            stdio: ["pipe", "ignore", "ignore"],
          }),
        ),
        (child) =>
          Effect.sync(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          }),
      );
      const forget = registry.register({
        pid: child.pid!,
        threadId: "fixture",
        cwd: config.stateDir,
      });
      const record = JSON.parse(
        yield* fs.readFileString(`${config.stateDir}/runtime/provider-processes.json`),
      ).processes[0];
      expect(record).toMatchObject({
        pid: child.pid,
        pgid: child.pid,
        owner: { pid: process.pid },
      });
      yield* Effect.callback<void>((resume) => {
        const onExit = () => resume(Effect.void);
        child.once("exit", onExit);
        registry.signalAll();
        return Effect.sync(() => {
          child.off("exit", onExit);
        });
      });
      forget();
      expect(
        JSON.parse(yield* fs.readFileString(`${config.stateDir}/runtime/provider-processes.json`))
          .processes,
      ).toEqual([]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Processes.layer.pipe(
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "provider-processes-" }),
          ),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
);
