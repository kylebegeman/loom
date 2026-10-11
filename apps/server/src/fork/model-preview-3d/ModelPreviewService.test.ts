import { DEFAULT_MODEL_PREVIEW_SETTINGS } from "@t3tools/contracts/fork";
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
import * as DateTime from "effect/DateTime";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunnerModule from "../../processRunner.ts";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ThreadId,
  RunId,
  CheckpointId,
  CheckpointScopeId,
  NodeId,
  CheckpointRef,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import type { ModelEditorEvent, ModelMeasurement } from "@t3tools/contracts/fork";
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
  const liveRunner = yield* ProcessRunner;
  let gitCalls = 0;
  let refreshCalls = 0;
  let checkpointRecords: readonly OrchestrationV2Checkpoint[] = [];
  let events: Stream.Stream<OrchestrationV2DomainEvent> = Stream.empty;
  let entryPaths = ["models/part.scad", "models/part.stl", "models/part.step", "models/ignore.txt"];
  const threads = partial<ThreadManagementService["Service"]>({
    get streamDomainEvents() {
      return events;
    },
  });
  const runner = ProcessRunner.of({
    run: (input) =>
      Effect.gen(function* () {
        if (input.command === "git") {
          gitCalls++;
          return yield* liveRunner.run(input).pipe(Effect.orDie);
        }
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
        } else if (target.endsWith(".stl"))
          yield* fs.writeFile(target, binaryMesh([0, 0, 0, 10, 0, 0, 0, 10, 0]));
        else yield* fs.writeFileString(target, "mesh bytes");
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
    getThreadRecords: () =>
      Effect.succeed(partial<OrchestrationV2ThreadProjection>({ checkpoints: checkpointRecords })),
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
    refresh: () =>
      Effect.sync(() => {
        refreshCalls++;
      }),
    list: () =>
      Effect.succeed({
        entries: entryPaths.map((name) => ({
          path: name,
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
      Effect.provideService(ThreadManagementService, threads),
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
    initGit: () => liveRunner.run({ command: "git", args: ["init", "--quiet"], cwd: root }),
    getGitCalls: () => gitCalls,
    getRefreshCalls: () => refreshCalls,
    setEntries: (names: string[]) => {
      entryPaths = names;
    },
    setCheckpoints: (checkpoints: readonly OrchestrationV2Checkpoint[]) => {
      checkpointRecords = checkpoints;
    },
    setEvents: (value: Stream.Stream<OrchestrationV2DomainEvent>) => {
      events = value;
    },
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
const testLayer = Layer.mergeAll(NodeServices.layer, SqlitePersistenceMemory).pipe(
  Layer.provideMerge(ProcessRunnerModule.layer.pipe(Layer.provide(NodeServices.layer))),
);
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
      kind: "distance" as const,
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
      kind: "distance" as const,
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

const checkpoint = (
  threadId: ThreadId,
  turn: number,
  files: readonly string[],
  patch: Partial<OrchestrationV2Checkpoint> = {},
): OrchestrationV2Checkpoint => ({
  id: CheckpointId.make(`checkpoint-${turn}`),
  threadId,
  scopeId: CheckpointScopeId.make("root"),
  runId: RunId.make(`run-${turn}`),
  nodeId: NodeId.make(`node-${turn}`),
  parentCheckpointId: null,
  ordinalWithinScope: turn,
  appRunOrdinal: turn,
  ref: CheckpointRef.make(`refs/checkpoints/${turn}`),
  status: "ready",
  files: files.map((path) => ({ path, kind: "modified", additions: 0, deletions: 0 })),
  capturedAt: DateTime.makeUnsafe("2026-10-10T00:00:00Z"),
  ...patch,
});
const checkpointEvent = (value: OrchestrationV2Checkpoint): OrchestrationV2DomainEvent =>
  ({ type: "checkpoint.captured", payload: value }) as OrchestrationV2DomainEvent;

it.effect("maps current ready root checkpoints through a real Git workspace prefix", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    yield* t.initGit();
    t.setWorkspace(t.path.join(t.root, "models"));
    t.setEntries(["part.scad", "shape.scad", "part.stl", "part.step"]);
    t.setCheckpoints([
      checkpoint(t.file.threadId, 1, ["models/part.scad"], { runId: null, appRunOrdinal: null }),
      checkpoint(t.file.threadId, 2, ["models/part.stl"], { status: "stale" }),
      checkpoint(t.file.threadId, 3, [
        "outside.stl",
        "models/shape.scad",
        "models/part.step",
        "models/deleted.stl",
      ]),
    ]);
    const service = yield* t.create();
    const result = yield* service.turnModels(t.file.threadId, RunId.make("run-3"));
    expect(result).toMatchObject({ turn: 3, checkpointId: "checkpoint-3", truncated: false });
    expect(result.models).toEqual([
      { path: "shape.scad", format: "scad", reason: "written", via: null },
      { path: "part.scad", format: "scad", reason: "dependency", via: "shape.scad" },
    ]);
    expect((yield* service.turnModels(t.file.threadId, RunId.make("run-2"))).models).toEqual([]);
    expect((yield* service.turnModels(t.file.threadId, null)).runId).toBe("run-3");
    expect(t.getGitCalls()).toBe(1);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("looks back through code-only turns and returns no models outside Git", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const nonGit = yield* t.create();
    expect((yield* nonGit.turnModels(t.file.threadId, null)).models).toEqual([]);
    yield* t.initGit();
    t.setCheckpoints([
      checkpoint(t.file.threadId, 4, ["models/part.stl"]),
      checkpoint(t.file.threadId, 5, ["app.ts"]),
      checkpoint(t.file.threadId, 6, ["models/gone.stl"]),
    ]);
    const service = yield* t.create();
    expect((yield* service.turnModels(t.file.threadId, null)).runId).toBe("run-4");
    t.setCheckpoints(
      Array.from({ length: 21 }, (_, i) =>
        checkpoint(t.file.threadId, i + 1, i === 0 ? ["models/part.stl"] : ["app.ts"]),
      ),
    );
    expect((yield* service.turnModels(t.file.threadId, null)).runId).toBeNull();
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect(
  "emits only this thread's finished model checkpoints and skips empty and code turns",
  () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.initGit();
      t.setEvents(
        Stream.make(
          checkpointEvent(checkpoint(ThreadId.make("other"), 1, ["models/part.stl"])),
          checkpointEvent(checkpoint(t.file.threadId, 2, [])),
          checkpointEvent(checkpoint(t.file.threadId, 3, ["app.ts"])),
          checkpointEvent(checkpoint(t.file.threadId, 4, ["models/part.stl"], { status: "error" })),
          checkpointEvent(checkpoint(t.file.threadId, 5, ["models/part.stl"])),
        ),
      );
      const service = yield* t.create();
      const result = yield* Stream.runCollect(service.turnModelEvents(t.file.threadId));
      expect(result.map((turn) => turn.turn)).toEqual([5]);
      expect(result[0]?.models[0]?.path).toBe("models/part.stl");
      expect(t.getRefreshCalls()).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect(
  "finds transitive uncached includes, rejects escaped symlinks and bounds source reads",
  () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.initGit();
      const outside = yield* t.fs.makeTempDirectoryScoped();
      yield* t.fs.writeFileString(t.path.join(outside, "outside.scad"), "include <shape.scad>");
      yield* t.fs.symlink(
        t.path.join(outside, "outside.scad"),
        t.path.join(t.root, "models/escape.scad"),
      );
      yield* t.fs.writeFileString(t.path.join(t.root, "models/top.scad"), "include <part.scad>");
      yield* t.fs.writeFileString(
        t.path.join(t.root, "models/large.scad"),
        " ".repeat(256 * 1024 + 1),
      );
      t.setEntries([
        "models/part.scad",
        "models/top.scad",
        "models/shape.scad",
        "models/escape.scad",
        "models/large.scad",
      ]);
      t.setCheckpoints([checkpoint(t.file.threadId, 1, ["models/shape.scad"])]);
      const service = yield* t.create();
      const result = yield* service.turnModels(t.file.threadId, null);
      expect(result.models.map((model) => model.path)).toEqual([
        "models/shape.scad",
        "models/part.scad",
        "models/top.scad",
      ]);
      expect(result.truncated).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect(
  "returns a saved circle measurement to the editor action waiting for acknowledgement",
  () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const absolute = t.path.join(t.root, t.file.path);
      const info = yield* t.fs.stat(absolute);
      // Immediate external path lookups let startImmediately establish the listener without sleeps.
      const filesystem = {
        ...t.fs,
        realPath: (path: string) => Effect.succeed(path),
        stat: (path: string) => (path === absolute ? Effect.succeed(info) : t.fs.stat(path)),
      };
      const service = yield* t.create(filesystem);
      const received = yield* Deferred.make<typeof ModelEditorEvent.Type>();
      const reader = yield* service.editorEvents(t.file).pipe(
        Stream.tap((event) => Deferred.succeed(received, event)),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      );
      const job = yield* service
        .editorAction({
          ...t.file,
          command: { action: "pick", measure: "hole", points: [[1, 0, 0]] },
        })
        .pipe(Effect.forkChild({ startImmediately: true }));
      const event = yield* Deferred.await(received);
      const measurement: ModelMeasurement = {
        id: "hole-1",
        name: "Hole 1",
        sourceRevision: "mesh",
        kind: "circle",
        start: [-2, 0, 0],
        end: [2, 0, 0],
        visible: true,
        circle: { center: [0, 0, 0], normal: [0, 0, 1], diameter: 4, sides: 6 },
      };
      yield* service.completeEditorAction({
        ...t.file,
        requestId: event.requestId,
        message: "Measured hole",
        measurement,
      });
      expect((yield* Fiber.join(job)).measurement).toEqual(measurement);
      yield* Fiber.interrupt(reader);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
it.effect("caches SCAD reference parses by revision and updates reverse edges after edits", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    yield* t.initGit();
    t.setEntries(["models/part.scad", "models/shape.scad"]);
    t.setCheckpoints([checkpoint(t.file.threadId, 1, ["models/shape.scad"])]);
    let reads = 0;
    const filesystem = {
      ...t.fs,
      readFileString: (path: string, encoding?: string) => {
        if (path.endsWith(".scad")) reads++;
        return t.fs.readFileString(path, encoding);
      },
    };
    const service = yield* t.create(filesystem);
    expect((yield* service.turnModels(t.file.threadId, null)).models).toHaveLength(2);
    expect((yield* service.turnModels(t.file.threadId, null)).models).toHaveLength(2);
    expect(reads).toBe(2);
    yield* t.fs.writeFileString(t.path.join(t.root, t.file.path), "cube(4);");
    expect(
      (yield* service.turnModels(t.file.threadId, null)).models.map((item) => item.path),
    ).toEqual(["models/shape.scad"]);
    expect(reads).toBe(3);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect(
  "refreshes discovery only for candidate turns and preserves symlink heightmap reasons",
  () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.initGit();
      yield* t.fs.writeFileString(
        t.path.join(t.root, t.file.path),
        'surface(file="height.dat"); surface("height.txt");',
      );
      yield* t.fs.writeFileString(t.path.join(t.root, "models/height.dat"), "1 2\n3 4");
      yield* t.fs.writeFileString(t.path.join(t.root, "models/height.txt"), "4 3\n2 1");
      yield* t.fs.symlink(
        t.path.join(t.root, "models/height.dat"),
        t.path.join(t.root, "models/linked.dat"),
      );
      t.setEntries(["models/part.scad"]);
      t.setCheckpoints([
        checkpoint(t.file.threadId, 1, ["models/linked.dat", "models/height.txt"]),
        checkpoint(t.file.threadId, 2, ["source.ts"]),
      ]);
      const service = yield* t.create();
      expect((yield* service.turnModels(t.file.threadId, RunId.make("run-2"))).models).toEqual([]);
      expect(t.getRefreshCalls()).toBe(0);
      const result = yield* service.turnModels(t.file.threadId, null);
      expect(result.models).toEqual([
        {
          path: "models/part.scad",
          format: "scad",
          reason: "dependency",
          via: "models/linked.dat",
        },
      ]);
      expect(t.getRefreshCalls()).toBe(1);
      t.setCheckpoints([checkpoint(t.file.threadId, 3, ["models/height.txt"])]);
      expect((yield* service.turnModels(t.file.threadId, null)).models[0]?.via).toBe(
        "models/height.txt",
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("print checks render an isolated SCAD variant without saving last-used parameters", () =>
  Effect.gen(function* () {
    const t = yield* setup,
      service = yield* t.create();
    yield* service.updateSettings({ ...DEFAULT_MODEL_PREVIEW_SETTINGS, renderColors: false });
    const checked = yield* service.checkPrint({
      file: t.file,
      overrides: { width: "3" },
      requestId: "check",
    });
    expect(checked.status).toBe("ok");
    expect(checked.report?.summary.triangles).toBe(1);
    const rendered = yield* service.renderScad({
      file: t.file,
      overrides: { width: "3" },
      parameterSet: null,
      variantId: "inspect-cache",
    });
    expect(checked.report?.geometryRevision).toBe(rendered.mesh?.revision);
    expect((yield* service.parameters(t.file)).lastUsed).not.toEqual({ width: "3" });
    expect(
      (yield* service.checkPrint({ file: t.file, overrides: { width: "3" } })).report?.cached,
    ).toBe(true);
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("headless renders apply saved orientation through a SCAD mesh wrapper", () =>
  Effect.gen(function* () {
    const t = yield* setup,
      service = yield* t.create(),
      orientation = {
        quaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const,
        sourceRevision: "source",
      };
    yield* service.updateWorkspace(t.file, { kind: "orientation", item: orientation });
    const rendered = yield* service.renderImages(t.file, ["iso", "top"], { width: "3" });
    expect(rendered.orientation?.sourceRevision).toBe("source");
    expect(rendered.orientation?.quaternion[0]).toBeCloseTo(Math.SQRT1_2);
    const runs = t.getRuns(),
      exports = runs.filter((r) => r.args.some((a) => a.endsWith(".oriented.stl")));
    expect(exports).toHaveLength(1);
    expect(exports[0]?.args).toContain("width=3");
    const png = runs.filter((r) => r.args.some((a) => a.endsWith(".png")));
    expect(png).toHaveLength(2);
    expect(png.every((r) => !r.args.includes("width=3"))).toBe(true);
    expect(
      (yield* service.renderImages(t.file, ["iso"], {}, "orthographic", { orientation: "none" }))
        .orientation,
    ).toBeNull();
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("SCAD print checks do not interrupt a pending panel render", () =>
  Effect.gen(function* () {
    const t = yield* setup,
      service = yield* t.create(),
      started = yield* Deferred.make<void>(),
      cancelled = yield* Deferred.make<void>();
    t.block(started, cancelled);
    const panel = yield* service
      .renderScad({ file: t.file, overrides: { width: "2" }, parameterSet: null })
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    const result = yield* service.checkPrint({ file: t.file, overrides: { width: "3" } });
    expect(result.status).toBe("ok");
    expect(yield* Deferred.isDone(cancelled)).toBe(false);
    expect((yield* service.parameters(t.file)).lastUsed).toEqual({});
    yield* service.renderScad({ file: t.file, overrides: { width: "4" }, parameterSet: null });
    expect((yield* Fiber.join(panel)).status).toBe("cancelled");
    yield* Deferred.await(cancelled);
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("old settings updates retain named beds and later display and print settings", () =>
  Effect.gen(function* () {
    const t = yield* setup,
      service = yield* t.create();
    const initial = {
      ...DEFAULT_MODEL_PREVIEW_SETTINGS,
      displayUnits: "in" as const,
      scaleReference: "card" as const,
      agentModels: "off" as const,
      nozzleDiameterMm: 0.6,
      firstLayerHeightMm: 0.3,
      buildPlate: {
        ...DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate,
        preset: "custom" as const,
        customBedId: "custom-12345678",
        customBeds: [{ id: "custom-12345678", name: "Laser", volumeMm: [400, 300, null] as const }],
        hiddenPresets: ["prusa-mini"] as const,
        showZones: false,
      },
    };
    yield* service.updateSettings(initial);
    const legacy = {
      openscadPath: null,
      backend: "auto" as const,
      renderTimeoutSeconds: 120,
      renderColors: false,
      maxFileMegabytes: 150,
      agentToolEnabled: true,
      fabricationUrl: null,
      buildPlate: { preset: "custom" as const, customMm: [400, 300, 200] as const },
    };
    const updated = yield* service.updateSettings(legacy);
    expect(updated).toMatchObject({
      displayUnits: "in",
      scaleReference: "card",
      agentModels: "off",
      nozzleDiameterMm: 0.6,
      firstLayerHeightMm: 0.3,
      buildPlate: {
        customBedId: "custom-12345678",
        customBeds: initial.buildPlate.customBeds,
        hiddenPresets: ["prusa-mini"] as const,
        showZones: false,
      },
    });
    expect(yield* (yield* t.create()).getSettings()).toEqual(updated);
    expect(
      (yield* service.updateSettings({
        ...legacy,
        buildPlate: { ...legacy.buildPlate, customBeds: [], hiddenPresets: [] },
      })).buildPlate.customBeds,
    ).toEqual([]);
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);
