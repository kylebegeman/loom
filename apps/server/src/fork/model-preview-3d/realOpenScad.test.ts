import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { RunId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import { HttpRouter } from "effect/http";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import * as Config from "../../config.ts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import type { OrchestrationV2AppThread } from "@t3tools/contracts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { make, ModelPreviewService } from "./ModelPreviewService.ts";
import { ModelPreviewHttpRoutes } from "./http.ts";
import { ModelPreview3dToolkit, modelPreview3dHandlers } from "./mcp.ts";
import { ModelPreviewMigrations } from "./migrations.ts";

// Opt in with a locally installed executable. Unit tests do not download tools or
// pretend that a fake process proves compatibility with the OpenSCAD CLI.
const executable = process.env.LOOM_TEST_OPENSCAD;
const realTest = executable ? it.live : it.live.skip;
const fixtures = NodeURL.fileURLToPath(new URL("./__fixtures__/", import.meta.url));
const meshes = NodePath.resolve(
  fixtures,
  "../../../../../web/src/fork/model-preview-3d/__fixtures__",
);
function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected integration service call: ${String(key)}`);
    },
  });
}
const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-real-scad-" }),
    threadId = ThreadId.make("real-scad-thread"),
    projectId = ProjectId.make("real-scad-project");
  for (const name of ["bracket.scad", "bracket.json", "profile.scad"])
    yield* fs.copyFile(path.join(fixtures, name), path.join(root, name));
  for (const name of ["cuboid.stl", "cuboid.obj", "inch-cube.3mf"])
    yield* fs.copyFile(path.join(meshes, name), path.join(root, name));
  yield* runForkMigrationSet(ModelPreviewMigrations);
  const queries = partial<ProjectionStore.ProjectionStoreV2["Service"]>({
    getThread: () =>
      Effect.succeed(partial<OrchestrationV2AppThread>({ projectId, worktreePath: null })),
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
      fs.readDirectory(root).pipe(
        Effect.orDie,
        Effect.map((names) => ({
          entries: names
            .filter((name) => /\.(scad|stl|obj|3mf)$/.test(name))
            .map((name) => ({ path: name, kind: "file" as const })),
          truncated: false,
        })),
      ),
  });
  const secret = partial<ServerSecretStore["Service"]>({
    getOrCreateRandom: () => Effect.succeed(new Uint8Array(32).fill(9)),
  });
  const service = yield* make.pipe(
    Effect.provide(Config.layerTest(root, path.join(root, "state"))),
    Effect.provideService(ProjectionStore.ProjectionStoreV2, queries),
    Effect.provideService(ProjectStore.ProjectStoreV2, projectStore),
    Effect.provideService(WorkspaceEntries, entries),
    Effect.provideService(ServerSecretStore, secret),
  );
  yield* service.updateSettings({ ...(yield* service.getSettings()), openscadPath: executable! });
  return { fs, path, root, threadId, service, file: { threadId, path: "bracket.scad" } };
});
const callerLayer = Layer.succeed(
  ThreadManagement.ThreadManagementService,
  partial<ThreadManagement.ThreadManagementService["Service"]>({
    getThreadShell: (threadId) =>
      Effect.succeed(
        partial<OrchestrationV2ThreadShell>({
          id: threadId,
          deletedAt: null,
          archivedAt: null,
          activeRunId: RunId.make("model-run"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "full-access",
          interactionMode: "default",
        }),
      ),
  }),
);
const testLayer = Layer.mergeAll(NodeServices.layer, SqlitePersistenceMemory).pipe(
  Layer.provideMerge(ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer))),
);
realTest(
  "renders real STL and colored 3MF with customizer sets, cache, summaries and signed HTTP transport",
  () =>
    Effect.gen(function* () {
      const t = yield* setup,
        info = (yield* t.service.status(true)).openscad;
      expect(info.path).toBe(executable);
      expect(info.supportsSummary).toBe(true);
      expect(info.supportsColors).toBe(true);
      const input = { file: t.file, overrides: {}, parameterSet: null };
      const first = yield* t.service.renderScad(input);
      expect(first.status).toBe("ok");
      expect(first.meshFormat).toBe("stl");
      expect(first.summary?.manifold).toBe(true);
      expect(first.summary?.boundingBox).toMatchObject({ min: [0, 0, 0], max: [40, 20, 20] });
      expect(first.summary?.facets).toBeGreaterThan(0);
      expect(first.log.some((line) => line.level === "echo")).toBe(true);
      expect((yield* t.service.renderScad(input)).cached).toBe(true);
      const wide = yield* t.service.renderScad({
        ...input,
        parameterSet: "wide",
        overrides: { width: "90" },
      });
      expect(wide.summary?.boundingBox?.max[0]).toBe(90);
      expect((yield* t.service.parameters(t.file)).lastUsed).toEqual({ width: "90" });
      yield* t.service.updateSettings({ ...(yield* t.service.getSettings()), renderColors: true });
      const colored = yield* t.service.renderScad(input);
      expect(colored.status).toBe("ok");
      expect(colored.meshFormat).toBe("3mf");
      const app = ModelPreviewHttpRoutes.pipe(
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(
              ModelPreviewService,
              t.service,
            ) as unknown as Context.Context<ForkServices>,
          ),
        ),
        HttpRouter.provideRequest(NodeHttpPlatform.layer),
        Layer.provide(NodeServices.layer),
      );
      const web = HttpRouter.toWebHandler(app, { disableLogger: true });
      yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
      for (const result of [first, colored]) {
        expect(result.mesh).not.toBeNull();
        const response = yield* Effect.promise(() =>
          web.handler(new Request(`http://remote.loom.test${result.mesh!.relativeUrl}`)),
        );
        expect(response.status).toBe(200);
        const bytes = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
        expect(bytes.byteLength).toBe(result.mesh!.sizeBytes);
        if (result.meshFormat === "3mf")
          expect(Array.from(bytes.subarray(0, 2))).toEqual([0x50, 0x4b]);
        else expect(new DataView(bytes.buffer).getUint32(80, true)).toBeGreaterThan(0);
      }
      yield* t.service.saveParameterSet(t.file, "saved", { width: "64", position: "[1,2,3]" });
      const saved = yield* t.service.renderScad({ ...input, parameterSet: "saved" });
      expect(saved.summary?.boundingBox?.min).toEqual([1, 2, 3]);
      expect(saved.summary?.boundingBox?.max[0]).toBe(65);
      expect((yield* t.service.parameters(t.file)).sets).toEqual(["wide", "saved"]);
      yield* t.fs.writeFileString(t.path.join(t.root, "bracket.scad"), "cube(;");
      const failed = yield* t.service.renderScad(input);
      expect(failed.status).toBe("error");
      expect(failed.mesh).toBeNull();
      expect(failed.log.some((line) => line.level === "error")).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  { timeout: 30_000 },
);
realTest(
  "renders every advertised MCP format to PNG views with the real CLI and honors its gate",
  () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const layer = McpToolAccess.HandlersLayer.layer(modelPreview3dHandlers).pipe(
        Layer.provide(callerLayer),
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(
              ModelPreviewService,
              t.service,
            ) as unknown as Context.Context<ForkServices>,
          ),
        ),
      );
      const toolkit = yield* ModelPreview3dToolkit.pipe(Effect.provide(layer));
      const invocation = {
        environmentId: EnvironmentId.make("real-scad-environment"),
        thread: {
          threadId: t.threadId,
          providerSessionId: "integration-session",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },

        client: undefined,

        requestNamespace: "model-test",
        capabilities: new Set<never>(),
        issuedAt: 0,
      };
      for (const name of ["bracket.scad", "cuboid.stl", "cuboid.obj", "inch-cube.3mf"]) {
        const results = yield* toolkit
          .handle("loom_model_preview_3d_render", { path: name, views: ["iso", "top"] })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, invocation),
          );
        const result = results[0];
        expect(result?.isFailure).toBe(false);
        if (!result || result.isFailure || !("images" in result.result))
          throw new Error("MCP render failed");
        expect(result.result.images).toHaveLength(2);
        expect(result.result.summary?.facets).toBeGreaterThan(0);
        if (name === "bracket.scad") expect(result.result.summary?.manifold).toBe(true);
        if (name === "inch-cube.3mf")
          expect(result.result.summary?.boundingBox?.max).toEqual([25.4, 25.4, 25.4]);
        for (const image of result.result.images) {
          const bytes = yield* t.fs.readFile(image.path);
          expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
          const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          expect(header.getUint32(16)).toBe(1024);
          expect(header.getUint32(20)).toBe(768);
        }
      }
      yield* t.service.updateSettings({
        ...(yield* t.service.getSettings()),
        agentToolEnabled: false,
      });
      const disabled = yield* toolkit
        .handle("loom_model_preview_3d_render", { path: "bracket.scad" })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.flip,
          Effect.provideService(McpInvocationContext, invocation),
        );
      expect(disabled.message).toContain("disabled");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  { timeout: 30_000 },
);
