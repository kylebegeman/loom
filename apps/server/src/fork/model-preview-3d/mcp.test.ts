import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import type { McpCapability } from "../../mcp/McpInvocationContext.ts";
import * as Layer from "effect/Layer";
import { EnvironmentId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import { ModelPreviewError, EMPTY_MODEL_WORKSPACE } from "@t3tools/contracts/fork";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ForkRuntime } from "../ForkRuntime.ts";
import { ModelPreviewService } from "./ModelPreviewService.ts";
import { ModelPreview3dToolkit, modelPreview3dHandlers } from "./mcp.ts";
it("uses a unique Loom-prefixed shared tool name", () => {
  expect(Object.keys(ModelPreview3dToolkit.tools).sort()).toEqual([
    "loom_model_preview_3d_propose_variants",
    "loom_model_preview_3d_render",
  ]);
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
      const layer = modelPreview3dHandlers.pipe(
        Layer.provide(Layer.succeed(ForkRuntime, Context.make(ModelPreviewService, service))),
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
              threadId,
              providerSessionId: "session",
              providerInstanceId: ProviderInstanceId.make("codex"),
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
          modelPreview3dHandlers.pipe(
            Layer.provide(Layer.succeed(ForkRuntime, Context.make(ModelPreviewService, service))),
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
              threadId,
              providerSessionId: "session",
              providerInstanceId: ProviderInstanceId.make("codex"),
              capabilities: new Set<McpCapability>(),
              issuedAt: 0,
            }),
          );
      expect((yield* Effect.flip(invoke())).reason).toBe("command-failed");
      enabled = true;
      expect((yield* invoke()).length).toBeGreaterThan(0);
      expect(calls).toBe(2);
    }).pipe(Effect.scoped),
);
