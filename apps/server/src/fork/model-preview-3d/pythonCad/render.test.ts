import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_MODEL_PREVIEW_SETTINGS } from "@t3tools/contracts/fork";
import type { PythonEnvironment } from "./environment.ts";
import { makePythonRenderer } from "./render.ts";

function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected renderer dependency: ${String(key)}`);
    },
  });
}

it.effect("cache-only and historical renders preserve last-used parameter state", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-python-cache-" });
    const absolute = path.join(root, "part.b3d.py");
    const cacheDir = path.join(root, "renders");
    yield* fs.makeDirectory(cacheDir);
    yield* fs.writeFileString(absolute, "def model(): return None\n");
    let renders = 0;
    let saves = 0;
    let restores = 0;
    const renderer = yield* makePythonRenderer({
      environment: partial<PythonEnvironment>({
        requireReady: () =>
          Effect.succeed({
            state: "ready",
            managed: false,
            path: "fake-python",
            pythonVersion: "3.13",
            build123dVersion: "0.13.0",
            uv: null,
            installCommands: [],
            detail: null,
          }),
        run: (input) =>
          Effect.gen(function* () {
            renders++;
            yield* fs.writeFileString(String(input.request?.output), "mesh");
            return { ok: true, summary: null, log: [] };
          }).pipe(Effect.orDie),
      }),
      inspect: () => Effect.succeed({ ok: true, parameters: [], log: [] }),
      cacheDir,
      getSettings: () => DEFAULT_MODEL_PREVIEW_SETTINGS,
      metadata: () => ({ revision: "source-revision" }),
      readSidecar: () => Effect.succeed({ parameterSets: {} }),
      restoreDependencies: () =>
        Effect.sync(() => {
          restores++;
        }),
      dependencyMetadata: () => Effect.succeed([]),
      readDeps: () => Effect.void,
      persistDependencies: () => Effect.void,
      saveParams: () =>
        Effect.sync(() => {
          saves++;
        }),
      protectStem: () => Effect.void,
      sign: (_root, filename) =>
        Effect.succeed({
          relativeUrl: filename,
          expiresAt: 1000,
          sizeBytes: 4,
          modifiedAt: "2026-10-10T00:00:00Z",
          revision: "mesh-revision",
        }),
      prune: () => Effect.void,
    });
    const resolved = {
      root,
      absolute,
      projectId: ProjectId.make("project"),
      legacyParamsPath: null,
      info: yield* fs.stat(absolute),
    };
    const input = {
      file: { threadId: ThreadId.make("thread"), path: "part.b3d.py" },
      overrides: {},
      parameterSet: null,
    };
    expect((yield* renderer.run(input, resolved)).status).toBe("ok");
    expect(saves).toBe(1);
    expect((yield* renderer.run(input, resolved, { cachedOnly: true })).cached).toBe(true);
    expect((yield* renderer.run(input, resolved, { snapshot: true })).status).toBe("ok");
    expect(saves).toBe(1);
    expect(restores).toBe(2);
    yield* fs.writeFileString(absolute, "def model(): return 'changed'\n");
    const missing = yield* renderer.run(input, resolved, { cachedOnly: true });
    expect(missing).toMatchObject({ status: "error", cached: false, mesh: null });
    expect(renders).toBe(1);
    expect(saves).toBe(1);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
