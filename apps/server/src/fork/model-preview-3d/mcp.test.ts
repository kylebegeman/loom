import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { CheckpointId, RunId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import type { McpCapability } from "../../mcp/McpInvocationContext.ts";
import * as Layer from "effect/Layer";
import { EnvironmentId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import {
  ModelPreviewError,
  EMPTY_MODEL_WORKSPACE,
  DEFAULT_MODEL_PREVIEW_SETTINGS,
  bedFitSummary,
  type ModelProjection,
  type OverhangStats,
  type AssemblyOperation,
  type AssemblyReadResult,
  type ModelHistoryRestoreInput,
  type ScadRenderInput,
} from "@t3tools/contracts/fork";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { ModelPreviewService } from "./ModelPreviewService.ts";
import { ModelPreview3dToolkit, modelPreview3dHandlers, renderModelTool } from "./mcp.ts";
const decodeRenderResult = Schema.decodeEffect(
  ModelPreview3dToolkit.tools.loom_model_preview_3d_render.successSchema,
);

function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected service call: ${String(key)}`);
    },
  });
}
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
const modelToolkit = (service: ModelPreviewService["Service"]) =>
  ModelPreview3dToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(modelPreview3dHandlers).pipe(
        Layer.provide(callerLayer),
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(ModelPreviewService, service) as unknown as Context.Context<ForkServices>,
          ),
        ),
      ),
    ),
  );
const invocationFor = (threadId: ThreadId) => ({
  environmentId: EnvironmentId.make("test"),
  thread: {
    threadId,
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  requestNamespace: "model-test",
  capabilities: new Set<McpCapability>(["orchestration"]),
  issuedAt: 0,
});
const inThread = <A, E, R>(effect: Effect.Effect<A, E, R>, threadId: ThreadId) =>
  effect.pipe(
    Effect.provideService(McpInvocationContext, invocationFor(threadId)),
    Effect.provide(callerLayer),
  );

it("uses a unique Loom-prefixed shared tool name", () => {
  const names = Object.keys(ModelPreview3dToolkit.tools);
  expect(new Set(names).size).toBe(names.length);
  expect(names.every((name) => name.startsWith("loom_model_preview_3d_"))).toBe(true);
  expect(names).toEqual(
    expect.arrayContaining([
      "loom_model_preview_3d_render",
      "loom_model_preview_3d_propose_variants",
      "loom_model_preview_3d_save_workspace",
      "loom_model_preview_3d_save_parameter_set",
      "loom_model_preview_3d_render_mesh",
    ]),
  );
});
it.effect(
  "retains the fork service for invocations and returns its disabled/missing-tool errors",
  () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("model-thread");
      let reason: ModelPreviewError["reason"] = "openscad-missing";
      const service = {
        getSettings: () => Effect.succeed(DEFAULT_MODEL_PREVIEW_SETTINGS),
        renderImages: (file: { threadId: ThreadId }) => {
          expect(file.threadId).toBe(threadId);
          return Effect.fail(
            new ModelPreviewError({
              reason,
              message:
                reason === "openscad-missing" ? "OpenSCAD missing" : "Agent rendering disabled",
            }),
          );
        },
      } as unknown as ModelPreviewService["Service"];
      const layer = McpToolAccess.HandlersLayer.layer(modelPreview3dHandlers).pipe(
        Layer.provide(callerLayer),
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(ModelPreviewService, service) as unknown as Context.Context<ForkServices>,
          ),
        ),
      );
      const toolkit = yield* ModelPreview3dToolkit.pipe(Effect.provide(layer));
      for (const state of ["openscad-missing", "command-failed"] as const) {
        reason = state;
        const results = yield* toolkit
          .handle("loom_model_preview_3d_render", { path: "part.scad" })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.flip,
            Effect.provideService(McpInvocationContext, {
              environmentId: EnvironmentId.make("test"),
              thread: {
                threadId: threadId,
                providerSessionId: "session",
                providerInstanceId: ProviderInstanceId.make("codex"),
              },

              client: undefined,

              requestNamespace: "model-test",
              capabilities: new Set<McpCapability>(),
              issuedAt: 0,
            }),
          );
        expect(results).toMatchObject({ reason: state });
      }
    }).pipe(Effect.scoped, Effect.provide(callerLayer)),
);

it.effect("renders with default or explicit projection and passes bed fit through", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("render-thread");
    const fit = bedFitSummary([10, 20, 30], DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate);
    expect(fit.beds.find((bed) => bed.id === "bambu-h2d")?.zone).toEqual({
      reach: "all-zones",
      zoneIds: [],
    });
    const projections: Array<ModelProjection | undefined> = [];
    const service = partial<ModelPreviewService["Service"]>({
      getSettings: () => Effect.succeed(DEFAULT_MODEL_PREVIEW_SETTINGS),
      renderImages: (file, views, overrides, projection) => {
        expect(file).toEqual({ threadId, path: "part.scad" });
        expect(views).toEqual(["iso"]);
        expect(overrides).toEqual({ width: "3" });
        projections.push(projection);
        return Effect.succeed({ images: [], summary: null, log: [], fit, orientation: null });
      },
    });
    const toolkit = yield* ModelPreview3dToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(modelPreview3dHandlers).pipe(
          Layer.provide(callerLayer),
          Layer.provide(
            Layer.succeed(
              ForkRuntime,
              Context.make(
                ModelPreviewService,
                service,
              ) as unknown as Context.Context<ForkServices>,
            ),
          ),
        ),
      ),
    );
    for (const projection of [undefined, "orthographic", "perspective"] as const) {
      const results = yield* toolkit
        .handle("loom_model_preview_3d_render", {
          path: "part.scad",
          views: ["iso"],
          overrides: { width: "3" },
          ...(projection ? { projection } : {}),
        })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, {
            environmentId: EnvironmentId.make("test"),
            thread: {
              threadId,
              providerSessionId: "session",
              providerInstanceId: ProviderInstanceId.make("codex"),
            },
            client: undefined,
            requestNamespace: "model-test",
            capabilities: new Set<McpCapability>(),
            issuedAt: 0,
          }),
        );
      expect(results[0]).toMatchObject({ isFailure: false, result: { fit } });
    }
    expect(projections).toEqual(["orthographic", "orthographic", "perspective"]);
    expect(
      (yield* decodeRenderResult({ images: [], summary: null, log: [], fit: null })).fit,
    ).toBeNull();
    expect((yield* decodeRenderResult({ images: [], summary: null, log: [], fit })).fit).toEqual(
      fit,
    );
  }).pipe(Effect.scoped, Effect.provide(callerLayer)),
);

it.effect("forwards overhang requests and returns statistics through the tool schema", () =>
  Effect.gen(function* () {
    const stats: OverhangStats = {
      thresholdDegrees: 50,
      totalAreaMm2: 20,
      overhangAreaMm2: 4,
      overhangPercent: 20,
      facets: 12,
      oriented: false,
      regions: [{ areaMm2: 4, centre: [1, 1, 3], heightMm: [3, 3] }],
    };
    const service = partial<ModelPreviewService["Service"]>({
      getSettings: () => Effect.succeed(DEFAULT_MODEL_PREVIEW_SETTINGS),
      renderImages: (_file, _views, _overrides, _projection, options) => {
        expect(options).toEqual({ overhangs: { angle: 50 } });
        return Effect.succeed({
          images: [],
          summary: null,
          log: [],
          fit: null,
          orientation: null,
          overhangs: stats,
        });
      },
    });
    const invocation = {
      environmentId: EnvironmentId.make("test"),
      thread: {
        threadId: ThreadId.make("overhang-thread"),
        providerSessionId: "session",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      requestNamespace: "model-test",
      capabilities: new Set<McpCapability>(),
      issuedAt: 0,
    };
    const result = yield* renderModelTool({
      path: "part.scad",
      overhangs: true,
      overhangAngle: 50,
    }).pipe(
      Effect.provide(callerLayer),
      Effect.provideService(McpInvocationContext, invocation),
      Effect.provideService(
        ForkRuntime,
        Context.make(ModelPreviewService, service) as unknown as Context.Context<ForkServices>,
      ),
    );
    expect(result.overhangs).toEqual(stats);
    expect((yield* decodeRenderResult(result)).overhangs).toEqual(stats);
    const decodeParams = Schema.decodeEffect(
      ModelPreview3dToolkit.tools.loom_model_preview_3d_render.parametersSchema,
    );
    yield* Effect.flip(decodeParams({ path: "part.scad", overhangs: true, overhangAngle: 25 }));
    yield* Effect.flip(decodeParams({ path: "part.scad", overhangAngle: 45.5 }));
  }),
);

it.effect(
  "routes variant proposals through the retained fork service with the invoking thread",
  () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("proposal-thread");
      let enabled = false;
      let calls = 0;
      const service = {
        getSettings: () => Effect.succeed(DEFAULT_MODEL_PREVIEW_SETTINGS),
        proposeVariants: (
          file: { threadId: ThreadId; path: string },
          variants: readonly { name: string; values: Readonly<Record<string, string>> }[],
        ) => {
          expect(file).toEqual({ threadId, path: "part.scad" });
          expect(variants).toEqual([{ name: "Narrow", values: { width: "80" } }]);
          calls++;
          return enabled
            ? Effect.succeed(EMPTY_MODEL_WORKSPACE)
            : Effect.fail(
                new ModelPreviewError({
                  reason: "command-failed",
                  message: "Agent model tools disabled",
                }),
              );
        },
      } as unknown as ModelPreviewService["Service"];
      const toolkit = yield* ModelPreview3dToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(modelPreview3dHandlers).pipe(
            Layer.provide(callerLayer),
            Layer.provide(
              Layer.succeed(
                ForkRuntime,
                Context.make(
                  ModelPreviewService,
                  service,
                ) as unknown as Context.Context<ForkServices>,
              ),
            ),
          ),
        ),
      );
      const invoke = () =>
        toolkit
          .handle("loom_model_preview_3d_propose_variants", {
            path: "part.scad",
            variants: [{ name: "Narrow", values: { width: "80" } }],
          })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, {
              environmentId: EnvironmentId.make("test"),
              thread: {
                threadId: threadId,
                providerSessionId: "session",
                providerInstanceId: ProviderInstanceId.make("codex"),
              },

              client: undefined,

              requestNamespace: "model-test",
              capabilities: new Set<McpCapability>(),
              issuedAt: 0,
            }),
          );
      expect(yield* Effect.flip(invoke()).pipe(Effect.provide(callerLayer))).toMatchObject({
        reason: "command-failed",
      });
      enabled = true;
      expect((yield* invoke().pipe(Effect.provide(callerLayer))).length).toBeGreaterThan(0);
      expect(calls).toBe(2);
    }).pipe(Effect.scoped),
);

it.effect("rejects MCP clients without a calling project thread", () =>
  Effect.gen(function* () {
    const result = yield* renderModelTool({ path: "part.scad" }).pipe(
      Effect.provide(callerLayer),
      Effect.provideService(McpInvocationContext, {
        environmentId: EnvironmentId.make("test"),
        requestNamespace: "client:test",
        thread: undefined,
        client: { sessionId: "client", label: "External", access: "read-only" },
        capabilities: new Set<McpCapability>(),
        issuedAt: 0,
      }),
      Effect.flip,
    );
    expect(result).toMatchObject({ reason: "command-failed" });
    expect(result.message).toContain("project thread");
  }),
);

it.effect("refuses every tool, including settings, while agent model tools are off", () =>
  Effect.gen(function* () {
    const settings = { ...DEFAULT_MODEL_PREVIEW_SETTINGS, agentToolEnabled: false };
    // Only getSettings is provided: any tool reaching another service method fails the test.
    const service = partial<ModelPreviewService["Service"]>({
      getSettings: () => Effect.succeed(settings),
    });
    const toolkit = yield* ModelPreview3dToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(modelPreview3dHandlers).pipe(
          Layer.provide(callerLayer),
          Layer.provide(
            Layer.succeed(
              ForkRuntime,
              Context.make(
                ModelPreviewService,
                service,
              ) as unknown as Context.Context<ForkServices>,
            ),
          ),
        ),
      ),
    );
    const invocation = {
      environmentId: EnvironmentId.make("test"),
      thread: {
        threadId: ThreadId.make("disabled-thread"),
        providerSessionId: "session",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      requestNamespace: "model-test",
      // Saving settings is an environment write, which needs the orchestration capability.
      capabilities: new Set<McpCapability>(["orchestration"]),
      issuedAt: 0,
    };
    const inThread = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(McpInvocationContext, invocation),
        Effect.provide(callerLayer),
      );
    const calls = [
      toolkit.handle("loom_model_preview_3d_status", {}).pipe(Effect.flatMap(Stream.runDrain)),
      toolkit.handle("loom_model_preview_3d_settings", {}).pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_save_settings", {
          settings: { ...settings, agentToolEnabled: true },
        })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit.handle("loom_model_preview_3d_printers", {}).pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_save_printers", {
          expectedVersion: 0,
          printers: [],
          materials: [],
          hiddenBuiltIns: [],
        })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_read_printer_profile", { path: "printer.ini" })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_slice", { path: "part.b3d.py", cachedOnly: true })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_history", { path: "part.b3d.py" })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_restore_version", {
          path: "part.b3d.py",
          checkpointId: CheckpointId.make("checkpoint-1"),
        })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_assembly", { path: "case.loom-assembly.json" })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_assembly_update", {
          path: "case.loom-assembly.json",
          operations: [{ op: "set-name", name: "Case" }],
        })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_assembly_check", { path: "case.loom-assembly.json" })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_export_step", { path: "part.b3d.py" })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit.handle("loom_model_preview_3d_list", {}).pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_file", { path: "part.stl" })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_parameters", { path: "part.b3d.py" })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_workspace", { path: "part.stl" })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_save_workspace", {
          path: "part.stl",
          operation: { kind: "orientation", item: null },
        })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_check", { path: "part.stl" })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_render_mesh", {
          path: "part.b3d.py",
          overrides: {},
          parameterSet: null,
        })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_save_parameter_set", {
          path: "part.b3d.py",
          name: "Default",
          values: {},
        })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_cancel_variant", {
          path: "part.b3d.py",
          variantId: "wide",
        })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit.handle("loom_model_preview_3d_clear_cache", {}).pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_propose_variants", {
          path: "part.b3d.py",
          variants: [{ name: "Wide", values: { width: "10" } }],
        })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_render", { path: "part.b3d.py" })
        .pipe(Effect.flatMap(Stream.runDrain)),
      toolkit
        .handle("loom_model_preview_3d_editor", {
          path: "case.loom-assembly.json",
          command: { action: "snapshot" },
        })
        .pipe(Effect.flatMap(Stream.runDrain)),
    ];
    for (const call of calls) {
      const error = yield* inThread(call.pipe(Effect.flip));
      expect(error).toMatchObject({
        reason: "command-failed",
        message: expect.stringContaining("disabled"),
      });
    }
  }).pipe(Effect.scoped),
);

it.effect("print checks use caller workspace, forward options and obey the agent switch", () =>
  Effect.gen(function* () {
    let enabled = true,
      calls = 0;
    const threadId = ThreadId.make("check-thread"),
      service = partial<ModelPreviewService["Service"]>({
        getSettings: () =>
          Effect.succeed({ ...DEFAULT_MODEL_PREVIEW_SETTINGS, agentToolEnabled: enabled }),
        checkPrint: (input) => {
          calls++;
          expect(input).toEqual({
            file: { threadId, path: "part.scad" },
            overrides: { width: "3" },
            force: true,
            allowLarge: true,
            parameterSet: null,
          });
          return Effect.succeed({ status: "cancelled", report: null });
        },
      });
    const toolkit = yield* ModelPreview3dToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(modelPreview3dHandlers).pipe(
          Layer.provide(callerLayer),
          Layer.provide(
            Layer.succeed(
              ForkRuntime,
              Context.make(
                ModelPreviewService,
                service,
              ) as unknown as Context.Context<ForkServices>,
            ),
          ),
        ),
      ),
    );
    const invoke = () =>
      toolkit
        .handle("loom_model_preview_3d_check", {
          path: "part.scad",
          overrides: { width: "3" },
          force: true,
          allowLarge: true,
          parameterSet: null,
        })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provide(callerLayer),
          Effect.provideService(McpInvocationContext, {
            environmentId: EnvironmentId.make("test"),
            thread: {
              threadId,
              providerSessionId: "session",
              providerInstanceId: ProviderInstanceId.make("codex"),
            },
            client: undefined,
            requestNamespace: "check-test",
            capabilities: new Set<McpCapability>(),
            issuedAt: 0,
          }),
        );
    expect((yield* invoke())[0]).toMatchObject({
      isFailure: false,
      result: { status: "cancelled", report: null },
    });
    enabled = false;
    expect((yield* Effect.flip(invoke())).message).toBe(
      "Agent model tools are disabled in Loom settings.",
    );
    expect(calls).toBe(1);
  }).pipe(Effect.scoped),
);

it.effect("assembly edits preserve atomic operations and revision conflicts", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("assembly-thread");
    const path = "cases/case.loom-assembly.json";
    const operations: readonly AssemblyOperation[] = [
      { op: "add-part", id: "board", name: "Board", path: "models/board.b3d.py" },
      { op: "update-part", id: "board", position: [1, 2, 3], parameters: { width: "20" } },
    ];
    const snapshot: AssemblyReadResult = {
      path,
      revision: "saved-revision",
      readOnly: false,
      assembly: {
        format: "loom-assembly",
        version: 1,
        units: "mm",
        name: "Case",
        parts: [],
        clearances: [],
      },
      parts: [],
    };
    const inputs: Array<Parameters<ModelPreviewService["Service"]["updateAssembly"]>[0]> = [];
    const toolkit = yield* modelToolkit(
      partial<ModelPreviewService["Service"]>({
        getSettings: () => Effect.succeed(DEFAULT_MODEL_PREVIEW_SETTINGS),
        updateAssembly: (input) => {
          inputs.push(input);
          return input.expectedRevision === "stale-revision"
            ? Effect.fail(
                new ModelPreviewError({ reason: "conflict", message: "Assembly changed." }),
              )
            : Effect.succeed(snapshot);
        },
      }),
    );
    const invoke = (expectedRevision: string) =>
      inThread(
        toolkit
          .handle("loom_model_preview_3d_assembly_update", {
            path,
            operations,
            expectedRevision,
            createOnly: false,
          })
          .pipe(Effect.flatMap(Stream.runCollect)),
        threadId,
      );
    expect((yield* invoke("current-revision"))[0]).toMatchObject({
      isFailure: false,
      result: snapshot,
    });
    expect(yield* Effect.flip(invoke("stale-revision"))).toMatchObject({ reason: "conflict" });
    expect(inputs).toEqual([
      {
        file: { threadId, path },
        operations,
        expectedRevision: "current-revision",
        createOnly: false,
      },
      {
        file: { threadId, path },
        operations,
        expectedRevision: "stale-revision",
        createOnly: false,
      },
    ]);
  }).pipe(Effect.scoped),
);

it.effect(
  "history restore preserves content guards, obtains an omitted guard and supports undo",
  () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("history-thread");
      const file = { threadId, path: "part.b3d.py" };
      const checkpointId = CheckpointId.make("checkpoint-1");
      let reads = 0;
      const restores: ModelHistoryRestoreInput[] = [];
      const undos: Array<{ file: typeof file; undoId: string }> = [];
      const toolkit = yield* modelToolkit(
        partial<ModelPreviewService["Service"]>({
          getSettings: () => Effect.succeed(DEFAULT_MODEL_PREVIEW_SETTINGS),
          history: (input) => {
            expect(input).toEqual({ file });
            reads++;
            return Effect.succeed({
              versions: [],
              nextCursor: null,
              latestTurn: null,
              current: { present: true, contentKey: "current-key" },
              threadRunning: false,
              unavailable: null,
            });
          },
          historyRestore: (input) => {
            restores.push(input);
            return input.expectedContentKey === "stale-key"
              ? Effect.fail(
                  new ModelPreviewError({ reason: "conflict", message: "Model changed." }),
                )
              : Effect.succeed({ undoId: "undo-1", restored: [file.path] });
          },
          historyUndo: (input) => {
            undos.push(input);
            return Effect.void;
          },
        }),
      );
      const invoke = (options: {
        checkpointId?: CheckpointId;
        undoId?: string;
        expectedContentKey?: string | null;
        includeDependencies?: boolean;
      }) =>
        inThread(
          toolkit
            .handle("loom_model_preview_3d_restore_version", { path: file.path, ...options })
            .pipe(Effect.flatMap(Stream.runCollect)),
          threadId,
        );
      expect(
        (yield* invoke({
          checkpointId,
          expectedContentKey: "read-key",
          includeDependencies: true,
        }))[0],
      ).toMatchObject({ result: { undoId: "undo-1", restored: [file.path] } });
      yield* invoke({ checkpointId });
      yield* invoke({ checkpointId, expectedContentKey: null });
      expect(
        yield* Effect.flip(invoke({ checkpointId, expectedContentKey: "stale-key" })),
      ).toMatchObject({ reason: "conflict" });
      expect(restores).toEqual([
        { file, checkpointId, expectedContentKey: "read-key", includeDependencies: true },
        { file, checkpointId, expectedContentKey: "current-key", includeDependencies: false },
        { file, checkpointId, expectedContentKey: null, includeDependencies: false },
        { file, checkpointId, expectedContentKey: "stale-key", includeDependencies: false },
      ]);
      expect((yield* invoke({ undoId: "undo-1" }))[0]).toMatchObject({
        result: { undoId: null, restored: [] },
      });
      for (const options of [{}, { checkpointId, undoId: "undo-1" }])
        expect(yield* Effect.flip(invoke(options))).toMatchObject({ reason: "invalid-parameter" });
      expect(reads).toBe(1);
      expect(undos).toEqual([{ file, undoId: "undo-1" }]);
      expect(restores).toHaveLength(4);
    }).pipe(Effect.scoped),
);

it.effect("STEP export defaults parameter values and returns the signed workspace output", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("step-thread");
    const file = { threadId, path: "models/part.b3d.py" };
    const output = {
      path: "exports/part.step",
      file: {
        relativeUrl: "/api/model-preview-3d/files/step?token=test",
        expiresAt: 1234,
        sizeBytes: 120,
        modifiedAt: "2026-10-10T00:00:00Z",
        revision: "step-revision",
      },
    };
    const inputs: Array<ScadRenderInput & { outputPath?: string }> = [];
    const toolkit = yield* modelToolkit(
      partial<ModelPreviewService["Service"]>({
        getSettings: () => Effect.succeed(DEFAULT_MODEL_PREVIEW_SETTINGS),
        exportStepTo: (input) => {
          inputs.push(input);
          return Effect.succeed(output);
        },
      }),
    );
    for (const options of [
      {},
      { overrides: { width: "20" }, parameterSet: "Wide", outputPath: output.path },
    ]) {
      const results = yield* inThread(
        toolkit
          .handle("loom_model_preview_3d_export_step", { path: file.path, ...options })
          .pipe(Effect.flatMap(Stream.runCollect)),
        threadId,
      );
      expect(results[0]).toMatchObject({ isFailure: false, result: output });
    }
    expect(inputs).toEqual([
      { file, overrides: {}, parameterSet: null },
      { file, overrides: { width: "20" }, parameterSet: "Wide", outputPath: output.path },
    ]);
  }).pipe(Effect.scoped),
);

it.effect("Python CAD listing opts in and mesh rendering uses the shared renderer", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("python-thread");
    const model = {
      path: "part.b3d.py",
      format: "build123d" as const,
      revision: "source-revision",
      sizeBytes: 10,
      modifiedAt: "2026-10-10T00:00:00Z",
    };
    const toolkit = yield* modelToolkit(
      partial<ModelPreviewService["Service"]>({
        getSettings: () => Effect.succeed(DEFAULT_MODEL_PREVIEW_SETTINGS),
        listModels: (caller, include) => {
          expect(caller).toBe(threadId);
          expect(include).toEqual(["build123d"]);
          return Effect.succeed({ models: [model], assemblies: [], truncated: false });
        },
        renderModel: (input) => {
          expect(input).toEqual({
            file: { threadId, path: model.path },
            overrides: { width: "20" },
            parameterSet: "Wide",
            variantId: "wide",
          });
          return Effect.succeed({
            status: "cancelled",
            mesh: null,
            meshFormat: null,
            cached: false,
            durationMs: 0,
            log: [],
            summary: null,
          });
        },
      }),
    );
    expect(
      (yield* inThread(
        toolkit.handle("loom_model_preview_3d_list", {}).pipe(Effect.flatMap(Stream.runCollect)),
        threadId,
      ))[0],
    ).toMatchObject({ result: { models: [model] } });
    expect(
      (yield* inThread(
        toolkit
          .handle("loom_model_preview_3d_render_mesh", {
            path: model.path,
            overrides: { width: "20" },
            parameterSet: "Wide",
            variantId: "wide",
          })
          .pipe(Effect.flatMap(Stream.runCollect)),
        threadId,
      ))[0],
    ).toMatchObject({ result: { status: "cancelled", mesh: null } });
  }).pipe(Effect.scoped),
);

it.effect("plan-mode callers can preview STEP but cannot execute Python CAD", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("python-plan-thread");
    const planCaller = Layer.succeed(
      ThreadManagement.ThreadManagementService,
      partial<ThreadManagement.ThreadManagementService["Service"]>({
        getThreadShell: (id) =>
          Effect.succeed(
            partial<OrchestrationV2ThreadShell>({
              id,
              deletedAt: null,
              archivedAt: null,
              activeRunId: RunId.make("plan-run"),
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: "full-access",
              interactionMode: "plan",
            }),
          ),
      }),
    );
    const calls: string[] = [];
    const toolkit = yield* modelToolkit(
      partial<ModelPreviewService["Service"]>({
        getSettings: () => Effect.succeed(DEFAULT_MODEL_PREVIEW_SETTINGS),
        renderImages: (file) => {
          calls.push(file.path);
          return Effect.succeed({
            images: [],
            summary: null,
            log: [],
            fit: null,
            orientation: null,
          });
        },
      }),
    );
    const invoke = (path: string) =>
      toolkit
        .handle("loom_model_preview_3d_render", { path })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, invocationFor(threadId)),
          Effect.provide(planCaller),
        );
    expect(yield* Effect.flip(invoke("part.b3d.py"))).toMatchObject({
      code: "capability_denied",
      message: expect.stringContaining("full-access"),
    });
    expect((yield* invoke("part.step"))[0]).toMatchObject({ isFailure: false });
    expect(calls).toEqual(["part.step"]);
  }).pipe(Effect.scoped),
);
