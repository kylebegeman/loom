import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { RunId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
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
    }).pipe(Effect.scoped),
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
        return Effect.succeed({ images: [], summary: null, log: [], fit });
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
  }).pipe(Effect.scoped),
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
        return Effect.succeed({ images: [], summary: null, log: [], fit: null, overhangs: stats });
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
    const errors = [
      yield* inThread(
        toolkit
          .handle("loom_model_preview_3d_status", {})
          .pipe(Effect.flatMap(Stream.runCollect), Effect.flip),
      ),
      yield* inThread(
        toolkit
          .handle("loom_model_preview_3d_settings", {})
          .pipe(Effect.flatMap(Stream.runCollect), Effect.flip),
      ),
      yield* inThread(
        toolkit
          .handle("loom_model_preview_3d_save_settings", {
            settings: { ...settings, agentToolEnabled: true },
          })
          .pipe(Effect.flatMap(Stream.runCollect), Effect.flip),
      ),
    ];
    for (const error of errors)
      expect(error).toMatchObject({
        reason: "command-failed",
        message: expect.stringContaining("disabled"),
      });
  }).pipe(Effect.scoped),
);
