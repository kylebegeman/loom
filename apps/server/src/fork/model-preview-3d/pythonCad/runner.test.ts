// @effect-diagnostics nodeBuiltinImport:off
import * as NodeURL from "node:url";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ProcessRunner, layer } from "../../../processRunner.ts";
import { makePythonEnvironment, pythonEnvironment } from "./environment.ts";
import { RUNNER_SOURCE } from "./runnerSource.ts";
const testLayer = layer.pipe(Layer.provideMerge(NodeServices.layer));

it.live("embedded helper matches the reviewed Python source", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    expect(
      yield* fs.readFileString(NodeURL.fileURLToPath(new URL("./runner.py", import.meta.url))),
    ).toBe(RUNNER_SOURCE);
  }).pipe(Effect.provide(testLayer)),
);

it.live(
  "static inspection reads annotations and literals without executing workspace code",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path,
        runner = yield* ProcessRunner;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-python-static-" });
      const file = path.join(root, "model.b3d.py"),
        marker = path.join(root, "executed");
      yield* fs.writeFileString(
        file,
        `from typing import Annotated, Literal\nopen(${JSON.stringify(marker)}, 'w').write('BAD')\nraise RuntimeError('must never execute')\ndef model(width: Annotated[float, {"min": 1, "max": 30, "step": .5, "group": "Size"}] = 10., enabled: bool = True, color: Literal["red", "blue"] = "red", position: tuple[float, ...] = (0., 1., 2.), hidden: float = unavailable(), *, text: str = "hi"):\n    pass\n`,
      );
      const environment = yield* makePythonEnvironment({
        stateDir: root,
        getPythonPath: () => "python3",
        runner,
      });
      const result = yield* environment.run({
        command: "inspect",
        interpreter: "python3",
        request: { source: file },
      });
      expect(result.ok).toBe(true);
      expect(result.parameters?.map((p) => p.name)).toEqual([
        "width",
        "enabled",
        "color",
        "position",
        "text",
      ]);
      expect(result.parameters?.[0]?.range).toEqual({ min: 1, max: 30, step: 0.5 });
      expect(result.parameters?.[1]?.defaultValue).toBe("true");
      expect(result.parameters?.[2]?.options).toEqual([
        { value: '"red"', label: "red" },
        { value: '"blue"', label: "blue" },
      ]);
      expect(result.parameters?.[3]?.defaultValue).toBe("[0.0,1.0,2.0]");
      expect(result.log.some((row) => row.text.includes("Skipped hidden"))).toBe(true);
      expect(yield* fs.exists(marker)).toBe(false);
    }).pipe(Effect.provide(testLayer)),
  15000,
);

it.live(
  "static inspection reports missing model and syntax errors",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path,
        runner = yield* ProcessRunner;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-python-static-" });
      const file = path.join(root, "model.b3d.py");
      const environment = yield* makePythonEnvironment({
        stateDir: root,
        getPythonPath: () => "python3",
        runner,
      });
      yield* fs.writeFileString(file, "x = 1\n");
      expect(
        (yield* environment.run({
          command: "inspect",
          interpreter: "python3",
          request: { source: file },
        })).ok,
      ).toBe(false);
      yield* fs.writeFileString(file, "def model(:\n");
      const result = yield* environment.run({
        command: "inspect",
        interpreter: "python3",
        request: { source: file },
      });
      expect(result.ok).toBe(false);
      expect(result.log[0]?.text).toContain("SyntaxError");
    }).pipe(Effect.provide(testLayer)),
  15000,
);

it.live(
  "managed discovery and removal never install or mutate a custom interpreter",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        runner = yield* ProcessRunner;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-python-env-" });
      const environment = yield* makePythonEnvironment({
        stateDir: root,
        getPythonPath: () => null,
        runner,
      });
      const info = yield* environment.info();
      expect(info.state).toBe("not-set-up");
      expect(info.installCommands[0]).toContain("--python 3.13");
      expect(info.installCommands[1]).toContain("build123d==0.13.0");
      expect((yield* environment.setup({ action: "remove" })).state).toBe("not-set-up");
    }).pipe(Effect.provide(testLayer), Effect.provideService(HostProcess.Environment, {})),
  15000,
);

it("workspace Python environment excludes secrets and Python injection", () => {
  expect(
    pythonEnvironment({
      PATH: "/bin",
      HOME: "/test",
      OPENAI_API_KEY: "secret",
      PYTHONPATH: "/injected",
      PYTHONSTARTUP: "bad",
    }),
  ).toEqual({ PATH: "/bin", HOME: "/test" });
});
