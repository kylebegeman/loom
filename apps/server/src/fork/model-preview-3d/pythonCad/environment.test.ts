import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type { ProcessRunInput, ProcessRunOutput } from "../../../processRunner.ts";
import { makePythonEnvironment } from "./environment.ts";
const decode = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const output = (code = 0): ProcessRunOutput => ({
  stdout: "",
  stderr: code ? "installation failed" : "",
  code: code as ProcessRunOutput["code"],
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-python-setup-" });
  const bin = path.join(root, "bin");
  yield* fs.makeDirectory(bin);
  yield* fs.writeFileString(path.join(bin, "uv"), "fake uv");
  const calls: ProcessRunInput[] = [];
  let failInstall = false,
    block: { started: Deferred.Deferred<void>; stopped: Deferred.Deferred<void> } | null = null;
  const runner = {
    run: (input: ProcessRunInput) =>
      Effect.gen(function* () {
        calls.push(input);
        if (input.args[0] === "venv") {
          const pending = input.args.at(-1)!;
          yield* fs.makeDirectory(path.join(pending, "bin"), { recursive: true });
          yield* fs.writeFileString(path.join(pending, "bin", "python"), "new interpreter");
          return output();
        }
        if (input.args[0] === "pip") {
          if (block) {
            const current = block;
            block = null;
            yield* Deferred.succeed(current.started, undefined);
            return yield* Effect.never.pipe(
              Effect.onInterrupt(() => Deferred.succeed(current.stopped, undefined)),
            );
          }
          return output(failInstall ? 1 : 0);
        }
        const request = yield* decode(input.stdin ?? "{}");
        yield* fs.writeFileString(
          String(request.resultPath),
          json({ ok: true, python: "3.13.7", build123d: "0.13.0", log: [] }),
        );
        return output();
      }).pipe(Effect.orDie),
  };
  const environment = yield* makePythonEnvironment({
    stateDir: root,
    getPythonPath: () => null,
    runner,
  }).pipe(
    Effect.provideService(HostProcess.Environment, { PATH: bin }),
    Effect.provideService(HostProcess.Platform, "darwin"),
  );
  return {
    root,
    fs,
    path,
    calls,
    environment,
    pythonDirectory: path.join(root, "fork/model-preview-3d/python"),
    fail: () => {
      failInstall = true;
    },
    block: (started: Deferred.Deferred<void>, stopped: Deferred.Deferred<void>) => {
      block = { started, stopped };
    },
  };
});
it.effect("explicit setup publishes a probed environment and removal retains cached renders", () =>
  Effect.gen(function* () {
    const t = yield* fixture;
    const result = yield* t.environment.setup({ action: "install" });
    expect(result.state).toBe("ready");
    expect(result.path).toBe(t.path.join(t.pythonDirectory, "venv/bin/python"));
    expect(yield* t.fs.readFileString(result.path!)).toBe("new interpreter");
    expect(t.calls.filter((call) => call.args[0] === "pip")).toHaveLength(1);
    expect(t.calls[1]?.args).toContain("--only-binary");
    const renders = t.path.join(t.root, "fork/model-preview-3d/renders");
    yield* t.fs.makeDirectory(renders);
    yield* t.fs.writeFileString(t.path.join(renders, "cached.stl"), "mesh");
    expect((yield* t.environment.setup({ action: "remove" })).state).toBe("not-set-up");
    expect(yield* t.fs.exists(t.path.join(renders, "cached.stl"))).toBe(true);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("failed setup preserves the prior environment and removes pending files", () =>
  Effect.gen(function* () {
    const t = yield* fixture;
    const interpreter = t.path.join(t.pythonDirectory, "venv/bin/python");
    yield* t.fs.makeDirectory(t.path.dirname(interpreter), { recursive: true });
    yield* t.fs.writeFileString(interpreter, "old interpreter");
    t.fail();
    expect((yield* Effect.flip(t.environment.setup({ action: "install" }))).message).toContain(
      "installation failed",
    );
    expect(yield* t.fs.readFileString(interpreter)).toBe("old interpreter");
    expect(
      (yield* t.fs.readDirectory(t.pythonDirectory)).some((name) =>
        name.startsWith("venv-pending-"),
      ),
    ).toBe(false);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("cancelling setup stops the installer and clears pending state", () =>
  Effect.gen(function* () {
    const t = yield* fixture,
      started = yield* Deferred.make<void>(),
      stopped = yield* Deferred.make<void>();
    t.block(started, stopped);
    const fiber = yield* t.environment.setup({ action: "install" }).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    expect((yield* t.environment.info()).state).toBe("setting-up");
    yield* Fiber.interrupt(fiber);
    yield* Deferred.await(stopped);
    expect((yield* t.environment.info()).state).toBe("not-set-up");
    expect(
      (yield* t.fs.readDirectory(t.pythonDirectory)).some((name) =>
        name.startsWith("venv-pending-"),
      ),
    ).toBe(false);
  }).pipe(Effect.provide(NodeServices.layer)),
);
