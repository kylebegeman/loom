// @effect-diagnostics nodeBuiltinImport:off
import * as NodeURL from "node:url";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import * as Path from "effect/Path";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { make } from "./ModelPreviewService.ts";
import { ModelPreviewMigrations } from "./migrations.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import * as Config from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import type { OrchestrationV2AppThread } from "@t3tools/contracts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ProcessRunner, type ProcessRunOutput, type ProcessRunInput } from "../../processRunner.ts";
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const output = (stderr = "", timedOut = false): ProcessRunOutput => ({
  stdout: "",
  stderr,
  code: 0 as ProcessRunOutput["code"],
  timedOut,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});
/** Unused service methods fail immediately instead of silently returning a fake value. */
function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}
const binaryMesh = (positions: readonly number[]) => {
  const count = positions.length / 9;
  const bytes = new Uint8Array(84 + count * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, count, true);
  for (let triangle = 0; triangle < count; triangle++)
    for (let coordinate = 0; coordinate < 9; coordinate++)
      view.setFloat32(
        84 + triangle * 50 + 12 + coordinate * 4,
        positions[triangle * 9 + coordinate]!,
        true,
      );
  return bytes;
};
const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-model-test-" });
  yield* fs.makeDirectory(path.join(root, "models"));
  yield* fs.writeFileString(
    path.join(root, "models", "part.scad"),
    "width=2; // [1:10]\nposition=[0,0,0];\ninclude <shape.scad>\ncube(width);",
  );
  yield* fs.writeFileString(path.join(root, "models", "shape.scad"), 'echo("include");');
  yield* fs.writeFileString(path.join(root, "models", "part.stl"), "stl");
  yield* fs.writeFileString(path.join(root, "models", "part.step"), "step");
  yield* fs.writeFileString(path.join(root, "models", "part.obj"), "obj");
  yield* fs.copyFile(
    NodeURL.fileURLToPath(
      new URL(
        "../../../../web/src/fork/model-preview-3d/__fixtures__/inch-cube.3mf",
        import.meta.url,
      ),
    ),
    path.join(root, "models", "part.3mf"),
  );
  const threadId = ThreadId.make("thread"),
    projectId = ProjectId.make("project"),
    file = { threadId, path: "models/part.scad" };
  const context = yield* Layer.build(Config.layerTest(root, path.join(root, "state")));
  const serverConfig = yield* Config.ServerConfig.pipe(Effect.provide(context));
  yield* runForkMigrationSet(ModelPreviewMigrations);
  let worktreePath: string | null = null;
  let renders = 0,
    timeout = false;
  let summaryJson = json({ geometry: { simple: true, facets: 12 } });
  let supportsSummary = true;
  const projections: string[] = [];
  const runs: ProcessRunInput[] = [];
  let overhangMesh: Uint8Array = binaryMesh([
    0, 0, 1, 0, 2, 1, 2, 0, 1, 2, 0, 1, 0, 2, 1, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  let exportFailure: "timeout" | "error" | "missing" | null = null;
  let duringRender: Effect.Effect<void, PlatformError> | null = null;
  let block: { started: Deferred.Deferred<void>; cancelled: Deferred.Deferred<void> } | null = null;
  const runner = ProcessRunner.of({
    run: (input) =>
      Effect.gen(function* () {
        if (input.args.includes("--version")) return output("OpenSCAD version 2026.10.05");
        if (input.args.includes("--help"))
          return output(
            `--backend Manifold ${supportsSummary ? "--summary-file" : ""} --help-export`,
          );
        if (input.args.includes("--help-export")) return output("color-mode model");
        renders++;
        runs.push(input);
        const projection = input.args.find((arg) => arg.startsWith("--projection="));
        if (projection) projections.push(projection);
        if (duringRender) yield* duringRender;
        if (block) {
          yield* fs.writeFileString(input.args[input.args.indexOf("-o") + 1]!, "incomplete mesh");
          const current = block;
          block = null;
          return yield* Deferred.succeed(current.started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(current.cancelled, undefined)),
          );
        }
        if (timeout) return output("", true);
        const target = input.args[input.args.indexOf("-o") + 1]!;
        if (target.endsWith(".overhangs.stl")) {
          if (exportFailure === "timeout") return output("", true);
          if (exportFailure === "missing") return output();
          yield* fs.writeFile(target, overhangMesh);
          if (exportFailure === "error") return output("ERROR: Could not evaluate model");
        } else yield* fs.writeFileString(target, "mesh bytes");
        const deps = input.args.indexOf("-d");
        if (deps >= 0)
          yield* fs.writeFileString(
            input.args[deps + 1]!,
            `${target}: ${path.join(root, file.path)} ${path.join(root, "models/shape.scad")}\n`,
          );
        const summary = input.args.indexOf("--summary-file");
        if (summary >= 0) yield* fs.writeFileString(input.args[summary + 1]!, summaryJson);
        return output('ECHO: "done"');
      }).pipe(Effect.orDie),
  });
  const queries = partial<ProjectionStore.ProjectionStoreV2["Service"]>({
    getThread: () =>
      Effect.succeed(partial<OrchestrationV2AppThread>({ projectId, worktreePath: worktreePath })),
  });
  const project = partial<ProjectStore.ProjectRow>({ projectId, workspaceRoot: root });
  const projectStore = partial<ProjectStore.ProjectStoreV2["Service"]>({
    get: () => Effect.succeedSome(project),
    listShells: () =>
      Effect.succeed([
        partial<import("@t3tools/contracts").OrchestrationProjectShell>({
          id: projectId,
          workspaceRoot: root,
        }),
      ]),
  });
  const entries = partial<WorkspaceEntries["Service"]>({
    list: () =>
      Effect.succeed({
        entries: ["part.scad", "part.stl", "part.step", "ignore.txt"].map((name) => ({
          path: `models/${name}`,
          kind: "file" as const,
        })),
        truncated: false,
      }),
  });
  const secret = partial<ServerSecretStore["Service"]>({
    getOrCreateRandom: () => Effect.succeed(new Uint8Array(32).fill(7)),
  });
  const create = (filesystem = fs) =>
    make.pipe(
      Effect.provide(context),
      Effect.provideService(ProjectionStore.ProjectionStoreV2, queries),
      Effect.provideService(ProjectStore.ProjectStoreV2, projectStore),
      Effect.provideService(WorkspaceEntries, entries),
      Effect.provideService(ServerSecretStore, secret),
      Effect.provideService(ProcessRunner, runner),
      Effect.provideService(FileSystem.FileSystem, filesystem),
    );
  return {
    fs,
    path,
    root,
    stateDir: serverConfig.stateDir,
    file,
    create,
    getRenders: () => renders,
    getProjections: () => projections,
    getRuns: () => runs,
    setOverhangMesh: (bytes: Uint8Array) => {
      overhangMesh = bytes;
    },
    failOverhangExport: (failure: typeof exportFailure) => {
      exportFailure = failure;
    },
    setSummary: (text: string) => {
      summaryJson = text;
    },
    disableSummary: () => {
      supportsSummary = false;
    },
    setDuringRender: (effect: Effect.Effect<void, PlatformError>) => {
      duringRender = effect;
    },
    setWorkspace: (value: string | null) => {
      worktreePath = value;
    },
    setTimeout: () => {
      timeout = true;
    },
    block: (started: Deferred.Deferred<void>, cancelled: Deferred.Deferred<void>) => {
      block = { started, cancelled };
    },
  };
});
const testLayer = Layer.mergeAll(NodeServices.layer, SqlitePersistenceMemory);
it.effect(
  "discovers formats and refuses STEP, missing files, symlinks and oversized signed resources",
  () =>
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      expect((yield* service.listModels(t.file.threadId)).models.map((m) => m.format)).toEqual([
        "scad",
        "step",
        "stl",
      ]);
      expect(
        (yield* Effect.flip(service.fileUrl({ ...t.file, path: "models/part.step" }))).reason,
      ).toBe("unsupported-format");
      expect(
        (yield* Effect.flip(service.fileUrl({ ...t.file, path: "models/missing.stl" }))).reason,
      ).toBe("not-found");
      const outside = yield* t.fs.makeTempDirectoryScoped({ prefix: "loom-outside-" });
      yield* t.fs.writeFileString(t.path.join(outside, "secret.bin"), "secret");
      yield* t.fs.symlink(
        t.path.join(outside, "secret.bin"),
        t.path.join(t.root, "models", "escape.bin"),
      );
      const signed = yield* service.fileUrl({ ...t.file, path: "models/part.stl" });
      const token = signed.relativeUrl.split("/").at(-2)!;
      expect((yield* Effect.flip(service.resolveSignedRequest(token, "escape.bin"))).reason).toBe(
        "invalid-path",
      );
      yield* service.updateSettings({ ...(yield* service.getSettings()), maxFileMegabytes: 1 });
      yield* t.fs.writeFile(
        t.path.join(t.root, "models", "large.stl"),
        new Uint8Array(1024 * 1024 + 1),
      );
      expect(
        (yield* Effect.flip(service.fileUrl({ ...t.file, path: "models/large.stl" }))).reason,
      ).toBe("too-large");
      expect((yield* Effect.flip(service.resolveSignedRequest(token, "large.stl"))).reason).toBe(
        "too-large",
      );
      const large = yield* service.fileUrl({ ...t.file, path: "models/large.stl" }, true);
      expect(
        (yield* service.resolveSignedRequest(large.relativeUrl.split("/").at(-2)!, "large.stl"))
          .path,
      ).toContain("large.stl");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("reuses cache immediately and invalidates includes after a service restart", () =>
  Effect.gen(function* () {
    const t = yield* setup,
      service = yield* t.create(),
      input = { file: t.file, overrides: {}, parameterSet: null };
    const first = yield* service.renderScad(input);
    expect(first.cached).toBe(false);
    const signed = first.mesh!;
    const token = signed.relativeUrl.split("/").at(-2)!;
    expect(
      (yield* service.resolveSignedRequest(token, signed.relativeUrl.split("/").at(-1)!)).path,
    ).toContain(".stl");
    const cached = yield* service.renderScad(input);
    expect(cached.cached).toBe(true);
    expect(cached.mesh!.revision).toBe(first.mesh!.revision);
    expect(t.getRenders()).toBe(1);
    yield* t.fs.writeFileString(
      t.path.join(t.root, "models", "shape.scad"),
      'echo("include changed and longer");',
    );
    const restarted = yield* t.create();
    expect((yield* restarted.renderScad(input)).cached).toBe(false);
    expect(t.getRenders()).toBe(2);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("a newer render cancels the older render for the same file", () =>
  Effect.gen(function* () {
    const t = yield* setup,
      service = yield* t.create(),
      started = yield* Deferred.make<void>(),
      cancelled = yield* Deferred.make<void>();
    t.block(started, cancelled);
    const first = yield* service
      .renderScad({ file: t.file, overrides: { width: "3" }, parameterSet: null })
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    const second = yield* service.renderScad({
      file: t.file,
      overrides: { width: "4" },
      parameterSet: null,
    });
    yield* Deferred.await(cancelled);
    expect(second.status).toBe("ok");
    expect((yield* Fiber.join(first)).status).toBe("cancelled");
    expect(
      (yield* service.renderScad({ file: t.file, overrides: { width: "3" }, parameterSet: null }))
        .cached,
    ).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("timeouts retain explicit errors and parameter sets preserve vectors and metadata", () =>
  Effect.gen(function* () {
    const t = yield* setup,
      service = yield* t.create();
    t.setTimeout();
    expect(
      (yield* service.renderScad({ file: t.file, overrides: {}, parameterSet: null })).log,
    ).toContainEqual({ level: "error", text: "Render timed out after 120 s." });
    yield* t.fs.writeFileString(
      t.path.join(t.root, "models", "part.json"),
      json({
        fileFormatVersion: "1",
        metadata: { owner: "fixture" },
        parameterSets: { original: { width: "2" } },
      }),
    );
    const data = yield* service.saveParameterSet(t.file, "wide", {
      width: "8",
      position: "[1,2,3]",
    });
    expect(data.setValues.wide).toEqual({ width: "8", position: "[1,2,3]" });
    const sidecar = yield* decodeJson(
      yield* t.fs.readFileString(t.path.join(t.root, "models", "part.json")),
    );
    expect(sidecar).toMatchObject({
      metadata: { owner: "fixture" },
      parameterSets: { original: { width: "2" }, wide: { position: "[1,2,3]" } },
    });
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("watches recorded dependencies and releases every watcher when interrupted", () =>
  Effect.gen(function* () {
    const t = yield* setup,
      events = yield* PubSub.unbounded<FileSystem.WatchEvent>(),
      ready = yield* Deferred.make<void>(),
      observed = yield* Deferred.make<void>(),
      received = yield* Deferred.make<{ dependencyChanged: boolean }>();
    let active = 0;
    const fs = {
      ...t.fs,
      watch: () =>
        Stream.unwrap(
          Effect.gen(function* () {
            active++;
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                active--;
              }),
            );
            const queue = yield* PubSub.subscribe(events);
            yield* Deferred.succeed(ready, undefined);
            return Stream.fromSubscription(queue).pipe(
              Stream.tap(() => Deferred.succeed(observed, undefined)),
            );
          }),
        ),
    };
    const service = yield* t.create(fs);
    yield* service.renderScad({ file: t.file, overrides: {}, parameterSet: null });
    const restarted = yield* t.create(fs);
    const watching = yield* Stream.runForEach(restarted.watch(t.file), (event) =>
      Deferred.succeed(received, event),
    ).pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    yield* PubSub.publish(events, {
      _tag: "Update" as const,
      path: yield* t.fs.realPath(t.path.join(t.root, "models", "shape.scad")),
    });
    yield* Deferred.await(observed);
    // One advance lets the pull hand off the event; the second completes its debounce window.
    yield* TestClock.adjust("200 millis");
    yield* TestClock.adjust("200 millis");
    expect((yield* Deferred.await(received)).dependencyChanged).toBe(true);
    yield* Fiber.interrupt(watching);
    expect(active).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect(
  "agent rendering covers SCAD/STL/3MF/OBJ and is gated independently of mesh viewing",
  () =>
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      for (const extension of ["scad", "stl", "3mf", "obj"]) {
        const result = yield* service.renderImages(
          { ...t.file, path: `models/part.${extension}` },
          ["iso", "front", "top", "right"],
          {},
        );
        expect(result.images.map((image) => image.view)).toEqual(["iso", "front", "top", "right"]);
        expect(result.summary?.facets).toBe(12);
        expect(result.fit).toBeNull();
        expect(result.log.some((line) => line.level === "echo")).toBe(true);
      }
      expect(t.getProjections()).toEqual(Array.from({ length: 16 }, () => "--projection=o"));
      yield* service.renderImages(t.file, ["iso"], {}, "perspective");
      expect(t.getProjections().at(-1)).toBe("--projection=p");
      const renders = t.path.join(t.stateDir, "fork", "model-preview-3d", "renders");
      expect((yield* t.fs.readDirectory(renders)).filter((name) => !name.endsWith(".png"))).toEqual(
        [],
      );
      t.setTimeout();
      expect((yield* Effect.flip(service.renderImages(t.file, ["iso"], {}))).reason).toBe(
        "timeout",
      );
      yield* service.updateSettings({ ...(yield* service.getSettings()), agentToolEnabled: false });
      expect((yield* Effect.flip(service.renderImages(t.file, ["iso"], {}))).message).toContain(
        "disabled",
      );
      expect(
        (yield* service.fileUrl({ ...t.file, path: "models/part.stl" })).sizeBytes,
      ).toBeGreaterThan(0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("agent rendering checks summary extents against the environment's saved beds", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    yield* service.updateSettings({
      ...(yield* service.getSettings()),
      buildPlate: {
        preset: "custom",
        customMm: [100, 150, 75],
        pattern: "grid-mm",
        showZones: true,
      },
    });
    t.setSummary(
      json({
        geometry: {
          facets: 12,
          bounding_box: { min: [-50, -50, 20], max: [90, 40, 80] },
        },
      }),
    );
    const restarted = yield* t.create();
    const result = yield* restarted.renderImages(t.file, ["iso"], {});
    expect(result.fit).toMatchObject({ sizeMm: [140, 90, 60], activeBedId: "custom" });
    expect(result.fit?.beds.find((bed) => bed.id === "custom")).toMatchObject({
      volumeMm: [100, 150, 75],
      fit: "fits-rotated",
      overMm: null,
    });
    expect(result.fit?.beds.find((bed) => bed.id === "bambu-h2d")?.fit).toBe("fits");
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("agent rendering reports H2D nozzle reach alongside fit", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    t.setSummary(json({ geometry: { bounding_box: { min: [0, 0, 0], max: [340, 200, 100] } } }));
    const result = yield* service.renderImages(t.file, ["iso"], {});
    expect(result.fit?.beds.find((bed) => bed.id === "bambu-h2d")).toMatchObject({
      fit: "fits",
      zone: { reach: "whole-bed" },
    });
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("agent overhang statistics add exactly one matching binary export and remove it", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    yield* service.updateSettings({
      ...(yield* service.getSettings()),
      overhangAngleDegrees: 55,
      backend: "cgal",
      renderColors: true,
    });
    const plain = yield* service.renderImages(t.file, ["iso", "front"], { width: "3" });
    expect(plain).not.toHaveProperty("overhangs");
    expect(t.getRuns()).toHaveLength(2);
    const result = yield* service.renderImages(
      t.file,
      ["iso", "front"],
      { width: "3" },
      "perspective",
      { overhangs: {} },
    );
    expect(t.getRuns()).toHaveLength(5);
    const meshRun = t.getRuns()[2]!;
    expect(meshRun.args).toContain("binstl");
    expect(meshRun.args).toContain("--backend=cgal");
    expect(meshRun.args).toContain("width=3");
    expect(meshRun.timeout).toBe("120 seconds");
    expect(meshRun.cwd).toContain("models");
    expect(result.overhangs).toMatchObject({
      thresholdDegrees: 55,
      totalAreaMm2: 4,
      overhangAreaMm2: 4,
      overhangPercent: 100,
      facets: 3,
      oriented: false,
      regions: [{ areaMm2: 4, centre: [1, 1, 1], heightMm: [1, 1] }],
    });
    expect(
      (yield* t.fs.readDirectory(t.path.join(t.stateDir, "fork/model-preview-3d/renders"))).every(
        (name) => name.endsWith(".png"),
      ),
    ).toBe(true);
    const explicit = yield* service.renderImages(t.file, ["iso"], {}, "orthographic", {
      overhangs: { angle: 40 },
    });
    expect(explicit.overhangs?.thresholdDegrees).toBe(40);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("overhang export normalizes each import wrapper and returns actionable failures", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    for (const format of ["stl", "obj", "3mf"]) {
      const result = yield* service.renderImages(
        { ...t.file, path: `models/part.${format}` },
        ["iso"],
        {},
        "orthographic",
        { overhangs: { angle: 45 } },
      );
      expect(result.overhangs?.overhangAreaMm2).toBe(4);
      const mesh = t.getRuns().at(-2)!;
      expect(mesh.args).toContain("binstl");
      expect(mesh.args.at(-1)).toMatch(/\.scad$/);
      expect(yield* t.fs.exists(mesh.args.at(-1)!)).toBe(false);
    }
    expect(
      (yield* Effect.flip(
        service.renderImages(t.file, ["iso"], {}, "orthographic", { overhangs: { angle: 25 } }),
      )).reason,
    ).toBe("invalid-parameter");
    for (const failure of ["timeout", "error", "missing"] as const) {
      t.failOverhangExport(failure);
      const result = yield* Effect.flip(
        service.renderImages(t.file, ["iso"], {}, "orthographic", { overhangs: {} }),
      );
      expect(result.reason).toBe(failure === "timeout" ? "timeout" : "command-failed");
    }
    t.failOverhangExport(null);
    t.setOverhangMesh(new Uint8Array(12));
    expect(
      (yield* Effect.flip(
        service.renderImages(t.file, ["iso"], {}, "orthographic", { overhangs: {} }),
      )).message,
    ).toContain("STL");
    expect(
      (yield* t.fs.readDirectory(t.path.join(t.stateDir, "fork/model-preview-3d/renders"))).every(
        (name) => name.endsWith(".png"),
      ),
    ).toBe(true);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("interrupting an overhang export removes partial geometry and the import wrapper", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    const started = yield* Deferred.make<void>();
    const cancelled = yield* Deferred.make<void>();
    t.block(started, cancelled);
    const running = yield* service
      .renderImages({ ...t.file, path: "models/part.stl" }, ["iso"], {}, "orthographic", {
        overhangs: {},
      })
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* Fiber.interrupt(running);
    yield* Deferred.await(cancelled);
    expect(
      yield* t.fs.readDirectory(t.path.join(t.stateDir, "fork/model-preview-3d/renders")),
    ).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("agent rendering omits fit for unsupported or invalid geometry summaries", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    for (const summary of [
      "not json",
      "{}",
      '{"geometry":{"bounding_box":{"min":[0,0],"max":[10,10,10]}}}',
      '{"geometry":{"bounding_box":{"min":[0,0,0],"max":[-1,10,10]}}}',
      '{"geometry":{"bounding_box":{"min":[0,0,0],"max":[1e400,10,10]}}}',
      '{"geometry":{"bounding_box":{"min":[-1e308,0,0],"max":[1e308,10,10]}}}',
    ]) {
      t.setSummary(summary);
      expect((yield* service.renderImages(t.file, ["iso"], {})).fit).toBeNull();
    }
    t.disableSummary();
    const unsupported = yield* t.create();
    const result = yield* unsupported.renderImages(t.file, ["iso"], {});
    expect(result.summary).toBeNull();
    expect(result.fit).toBeNull();
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("interrupting an agent image render removes its wrapper and partial PNG", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    const started = yield* Deferred.make<void>();
    const cancelled = yield* Deferred.make<void>();
    t.block(started, cancelled);
    const running = yield* service
      .renderImages({ ...t.file, path: "models/part.stl" }, ["iso"], {}, "perspective")
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* Fiber.interrupt(running);
    yield* Deferred.await(cancelled);
    expect(
      yield* t.fs.readDirectory(t.path.join(t.stateDir, "fork/model-preview-3d/renders")),
    ).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("clearing cache cancels renders and leaves no partial output", () =>
  Effect.gen(function* () {
    const t = yield* setup,
      service = yield* t.create(),
      started = yield* Deferred.make<void>(),
      cancelled = yield* Deferred.make<void>();
    t.block(started, cancelled);
    const running = yield* service
      .renderScad({ file: t.file, overrides: {}, parameterSet: null })
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* service.clearCache();
    yield* Deferred.await(cancelled);
    expect((yield* Fiber.join(running)).status).toBe("cancelled");
    expect(
      (yield* service.renderScad({ file: t.file, overrides: {}, parameterSet: null })).cached,
    ).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("interrupting the client request cancels its render and removes incomplete output", () =>
  Effect.gen(function* () {
    const t = yield* setup,
      service = yield* t.create(),
      started = yield* Deferred.make<void>(),
      cancelled = yield* Deferred.make<void>();
    t.block(started, cancelled);
    const running = yield* service
      .renderScad({ file: t.file, overrides: {}, parameterSet: null })
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* Fiber.interrupt(running);
    yield* Deferred.await(cancelled);
    expect(
      (yield* service.renderScad({ file: t.file, overrides: {}, parameterSet: null })).cached,
    ).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("isolates variant jobs, persists workspace identities and gates agent proposals", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    yield* service.renderScad({ file: t.file, overrides: { width: "3" }, parameterSet: null });
    yield* service.renderScad({
      file: t.file,
      overrides: { width: "7" },
      parameterSet: null,
      variantId: "candidate",
    });
    expect((yield* service.parameters(t.file)).lastUsed).toEqual({ width: "3" });
    const measurement = {
      id: "distance",
      name: "Width",
      sourceRevision: "mesh1",
      start: [0, 0, 0] as const,
      end: [3, 0, 0] as const,
      visible: true,
    };
    yield* service.updateWorkspace(t.file, { kind: "measurement", item: measurement });
    const recreated = yield* t.create();
    expect((yield* recreated.getWorkspace(t.file)).measurements).toEqual([measurement]);
    yield* service.updateSettings({ ...(yield* service.getSettings()), agentToolEnabled: false });
    expect(
      (yield* Effect.flip(
        service.proposeVariants(t.file, [{ name: "Agent candidate", values: { width: "5" } }]),
      )).reason,
    ).toBe("command-failed");
    yield* service.updateSettings({ ...(yield* service.getSettings()), agentToolEnabled: true });
    const workspace = yield* service.proposeVariants(t.file, [
      { name: "Agent candidate", values: { width: "5" } },
    ]);
    expect(workspace.variants[0]).toMatchObject({
      name: "Agent candidate",
      origin: "agent",
      values: { width: "5" },
    });
    const started = yield* Deferred.make<void>();
    const cancelled = yield* Deferred.make<void>();
    t.block(started, cancelled);
    const job = yield* Effect.forkChild(
      service.renderScad({
        file: t.file,
        overrides: { width: "9" },
        parameterSet: null,
        variantId: "cancel-me",
      }),
    );
    yield* Deferred.await(started);
    yield* service.cancelVariant(t.file, "cancel-me");
    yield* Deferred.await(cancelled);
    expect((yield* Fiber.join(job)).status).toBe("cancelled");
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("streams workspace mutations and applies an oversized proposal batch atomically", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    const ready = yield* Deferred.make<void>();
    const listener = yield* service.watchWorkspace(t.file).pipe(
      Stream.tap(() => Deferred.succeed(ready, undefined)),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Deferred.await(ready);
    const item = {
      id: "v0",
      name: "Variant",
      sourceRevision: "source1",
      values: { width: "4" },
      thumbnail: null,
      dimensions: null,
      triangles: null,
      renderedRevision: null,
      origin: "user" as const,
    };
    yield* service.updateWorkspace(t.file, { kind: "variant", item });
    const events = yield* Fiber.join(listener);
    expect(events[1]!.variants[0]!.id).toBe("v0");
    for (let i = 1; i < 23; i++)
      yield* service.updateWorkspace(t.file, { kind: "variant", item: { ...item, id: `v${i}` } });
    yield* service.updateSettings({ ...(yield* service.getSettings()), agentToolEnabled: true });
    yield* Effect.flip(
      service.proposeVariants(t.file, [
        { name: "A", values: { width: "5" } },
        { name: "B", values: { width: "6" } },
      ]),
    );
    expect((yield* service.getWorkspace(t.file)).variants).toHaveLength(23);
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect(
  "keeps review image bytes out of workspace subscriptions and retains images across cache clearing",
  () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const service = yield* t.create();
      const item = {
        id: "image-candidate",
        name: "Image candidate",
        sourceRevision: "source",
        values: { width: "3" },
        thumbnail: "data:image/jpeg;base64,/9j/2Q==",
        dimensions: null,
        triangles: null,
        renderedRevision: null,
        origin: "user" as const,
      };
      const result = yield* service.updateWorkspace(t.file, { kind: "variant", item });
      expect(result.variants[0]!.thumbnail).toMatch(/^\/api\/loom\/model-preview-3d\/f\//);
      const url = result.variants[0]!.thumbnail!;
      const token = url.split("/").at(-2)!;
      const name = url.split("/").at(-1)!;
      const image = yield* service.resolveSignedRequest(token, name);
      expect(image.path).toContain("review-images");
      yield* service.clearCache();
      expect(yield* t.fs.exists(image.path)).toBe(true);
      const restarted = yield* t.create();
      const state = yield* restarted.getWorkspace(t.file);
      expect(state.variants[0]!.thumbnail).not.toContain("base64");
      yield* restarted.updateWorkspace(t.file, {
        kind: "variant",
        item: { ...state.variants[0]!, name: "Renamed" },
      });
      expect((yield* restarted.getWorkspace(t.file)).variants[0]!.name).toBe("Renamed");
      const other = { ...t.file, path: "models/other.scad" };
      yield* restarted.updateWorkspace(other, { kind: "variant", item });
      yield* restarted.updateWorkspace(t.file, {
        kind: "remove",
        collection: "variants",
        id: item.id,
      });
      expect(yield* t.fs.exists(image.path)).toBe(true);
      yield* restarted.updateWorkspace(other, {
        kind: "remove",
        collection: "variants",
        id: item.id,
      });
      expect(yield* t.fs.exists(image.path)).toBe(false);
    }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("isolates remembered parameters between worktrees and drops obsolete overrides", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    yield* service.renderScad({ file: t.file, overrides: { width: "8" }, parameterSet: null });
    const other = yield* t.fs.makeTempDirectoryScoped({ prefix: "loom-model-worktree-" });
    yield* t.fs.makeDirectory(t.path.join(other, "models"));
    yield* t.fs.copyFile(t.path.join(t.root, t.file.path), t.path.join(other, t.file.path));
    t.setWorkspace(other);
    expect((yield* service.parameters(t.file)).lastUsed).toEqual({});
    yield* service.renderScad({ file: t.file, overrides: { width: "4" }, parameterSet: null });
    t.setWorkspace(null);
    expect((yield* service.parameters(t.file)).lastUsed).toEqual({ width: "8" });
    yield* t.fs.writeFileString(
      t.path.join(t.root, t.file.path),
      "width=true;\nsize=4;\ncube(size);",
    );
    expect((yield* service.parameters(t.file)).lastUsed).toEqual({});
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("recovers removed remembered parameter sets without corrupting the sidecar", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    yield* service.saveParameterSet(t.file, "wide", { width: "7" });
    yield* service.renderScad({ file: t.file, overrides: {}, parameterSet: "wide" });
    yield* t.fs.writeFileString(t.path.join(t.root, "models", "part.json"), '{"parameterSets":{}}');
    expect((yield* service.parameters(t.file)).lastUsedSet).toBeNull();
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("slow workspace subscribers retain their latest change despite unrelated mutations", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    const ready = yield* Deferred.make<void>(),
      resume = yield* Deferred.make<void>();
    let first = true;
    const listener = yield* service.watchWorkspace(t.file).pipe(
      Stream.tap(() => {
        if (!first) return Effect.void;
        first = false;
        return Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(resume)));
      }),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Deferred.await(ready);
    const item = {
      id: "distance",
      name: "Width",
      sourceRevision: "mesh",
      start: [0, 0, 0] as const,
      end: [3, 0, 0] as const,
      visible: true,
    };
    yield* service.updateWorkspace(t.file, { kind: "measurement", item });
    for (let i = 0; i < 40; i++)
      yield* service.updateWorkspace(
        { ...t.file, path: "models/other.scad" },
        { kind: "measurement", item: { ...item, name: `Other ${i}` } },
      );
    yield* Deferred.succeed(resume, undefined);
    const events = yield* Fiber.join(listener);
    expect(events[1]!.measurements).toEqual([item]);
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("keeps parameter definitions and source revision from the same file snapshot", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    const before = yield* service.parameters(t.file);
    const source = yield* t.fs.realPath(t.path.join(t.root, t.file.path));
    let changed = false;
    const filesystem = FileSystem.FileSystem.of({
      ...t.fs,
      readFileString: (target, ...options) =>
        t.fs.readFileString(target, ...options).pipe(
          Effect.tap(() => {
            if (target !== source || changed) return Effect.void;
            changed = true;
            return t.fs.writeFileString(source, "width=9;\ncube(width);");
          }),
        ),
    });
    const racing = yield* t.create(filesystem);
    const snapshot = yield* racing.parameters(t.file);
    expect(snapshot.parameters[0]!.defaultValue).toBe("2");
    expect(snapshot.sourceRevision).toBe(before.sourceRevision);
    const after = yield* service.parameters(t.file);
    expect(after.parameters[0]!.defaultValue).toBe("9");
    expect(after.sourceRevision).not.toBe(snapshot.sourceRevision);
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("discards renders whose source changed while OpenSCAD was running", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const source = yield* t.fs.realPath(t.path.join(t.root, t.file.path));
    const service = yield* t.create();
    t.setDuringRender(t.fs.writeFileString(source, "width=9;\ncube(width);"));
    const result = yield* service.renderScad({
      file: t.file,
      overrides: { width: "4" },
      parameterSet: null,
    });
    expect(result.status).toBe("error");
    expect(result.mesh).toBeNull();
    expect(result.log.some((line) => line.text.includes("changed during rendering"))).toBe(true);
    expect((yield* service.parameters(t.file)).lastUsed).toEqual({});
    expect(
      yield* t.fs.readDirectory(t.path.join(t.stateDir, "fork/model-preview-3d/renders")),
    ).toEqual([]);
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("discards renders after edits to saved sets or known dependencies", () =>
  Effect.gen(function* () {
    for (const targetName of ["part.json", "shape.scad"]) {
      const t = yield* setup;
      const previous = yield* t.create();
      yield* previous.saveParameterSet(t.file, "wide", { width: "3" });
      yield* previous.renderScad({ file: t.file, overrides: { width: "3" }, parameterSet: "wide" });
      const target = t.path.join(t.root, "models", targetName);
      const contents =
        targetName === "part.json"
          ? '{"parameterSets":{"wide":{"width":"8"}}}'
          : 'echo("updated include");';
      const service = yield* t.create();
      t.setDuringRender(t.fs.writeFileString(target, contents));
      const result = yield* service.renderScad({
        file: t.file,
        overrides: { width: "4" },
        parameterSet: "wide",
      });
      expect(result.status).toBe("error");
      expect(result.mesh).toBeNull();
      expect((yield* service.parameters(t.file)).lastUsed).toEqual({ width: "3" });
      t.setDuringRender(Effect.void);
      const next = yield* service.renderScad({
        file: t.file,
        overrides: { width: "4" },
        parameterSet: "wide",
      });
      expect(next.status).toBe("ok");
      expect(next.cached).toBe(false);
    }
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);
