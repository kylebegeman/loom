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
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as Config from "../../config.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ProcessRunner, type ProcessRunOutput } from "../../processRunner.ts";
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
  let duringRender: Effect.Effect<void, PlatformError> | null = null;
  let block: { started: Deferred.Deferred<void>; cancelled: Deferred.Deferred<void> } | null = null;
  const runner = ProcessRunner.of({
    run: (input) =>
      Effect.gen(function* () {
        if (input.args.includes("--version")) return output("OpenSCAD version 2026.10.05");
        if (input.args.includes("--help"))
          return output("--backend Manifold --summary-file --help-export");
        if (input.args.includes("--help-export")) return output("color-mode model");
        renders++;
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
        yield* fs.writeFileString(target, "mesh bytes");
        const deps = input.args.indexOf("-d");
        if (deps >= 0)
          yield* fs.writeFileString(
            input.args[deps + 1]!,
            `${target}: ${path.join(root, file.path)} ${path.join(root, "models/shape.scad")}\n`,
          );
        const summary = input.args.indexOf("--summary-file");
        if (summary >= 0)
          yield* fs.writeFileString(
            input.args[summary + 1]!,
            json({ geometry: { simple: true, facets: 12 } }),
          );
        return output('ECHO: "done"');
      }).pipe(Effect.orDie),
  });
  const queries = partial<ProjectionSnapshotQuery["Service"]>({
    getThreadCheckpointContext: () =>
      Effect.succeedSome({
        threadId,
        projectId,
        workspaceRoot: root,
        worktreePath,
        checkpoints: [],
      }),
    getProjectShells: () =>
      Effect.succeed([
        {
          id: projectId,
          title: "Fixture",
          workspaceRoot: root,
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-10-07T00:00:00.000Z",
          updatedAt: "2026-10-07T00:00:00.000Z",
        },
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
      Effect.provideService(ProjectionSnapshotQuery, queries),
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
        expect(result.log.some((line) => line.level === "echo")).toBe(true);
      }
      yield* service.updateSettings({ ...(yield* service.getSettings()), agentToolEnabled: false });
      expect((yield* Effect.flip(service.renderImages(t.file, ["iso"], {}))).message).toContain(
        "disabled",
      );
      expect(
        (yield* service.fileUrl({ ...t.file, path: "models/part.stl" })).sizeBytes,
      ).toBeGreaterThan(0);
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
