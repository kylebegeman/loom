import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { RunId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import type { McpCapability } from "../../mcp/McpInvocationContext.ts";
import * as Layer from "effect/Layer";
import { EnvironmentId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import { ModelPreviewError, EMPTY_MODEL_WORKSPACE } from "@t3tools/contracts/fork";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { ModelPreviewService } from "./ModelPreviewService.ts";
import { ModelPreview3dToolkit, modelPreview3dHandlers, renderModelTool } from "./mcp.ts";
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

it.effect(
  "routes variant proposals through the retained fork service with the invoking thread",
  () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("proposal-thread");
      let enabled = false;
      let calls = 0;
      const service = {
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
