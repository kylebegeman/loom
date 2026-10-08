import { ModelPreviewError, ScadRenderResult, ModelWorkspace } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { ModelPreviewService } from "./ModelPreviewService.ts";
import { View } from "./openscad.ts";
export const ModelPreview3dToolkit = Toolkit.make(
  Tool.make("loom_model_preview_3d_propose_variants", {
    description:
      "Propose up to 12 named OpenSCAD parameter variants into the user's live variant workbench. Does not edit source or promote designs. Values are OpenSCAD literals.",
    parameters: Schema.Struct({
      path: Schema.String,
      variants: Schema.Array(
        Schema.Struct({
          name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
          values: Schema.Record(Schema.String, Schema.String),
        }),
      ).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
    }),
    success: ModelWorkspace,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Propose model variants")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_render", {
    description:
      "Render a workspace SCAD, STL, 3MF or OBJ to PNG views. Returns host paths, geometry summary and logs. Read the PNGs to inspect the part.",
    parameters: Schema.Struct({
      path: Schema.String,
      views: Schema.optional(
        Schema.Array(View).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
      ),
      overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
    success: Schema.Struct({
      images: Schema.Array(Schema.Struct({ view: View, path: Schema.String })),
      summary: ScadRenderResult.fields.summary,
      log: ScadRenderResult.fields.log,
    }),
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "Render 3D model")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);
const modelThread = Effect.gen(function* () {
  const invocation = yield* McpInvocationContext;
  if (invocation.thread === undefined)
    return yield* new ModelPreviewError({
      reason: "command-failed",
      message: "Use model tools from an agent running in a Loom project thread.",
    });
  return invocation.thread.threadId;
});
export const renderModelTool = Effect.fn("ModelPreview.renderTool")(function* (input: {
  path: string;
  views?: ReadonlyArray<typeof View.Type> | undefined;
  overrides?: Readonly<Record<string, string>> | undefined;
}) {
  const threadId = yield* modelThread;
  return yield* withForkRuntime(
    Effect.flatMap(ModelPreviewService, (service) =>
      service.renderImages(
        { threadId, path: input.path },
        input.views ?? ["iso", "front", "top", "right"],
        input.overrides ?? {},
      ),
    ),
  );
});
// HTTP/MCP registration captures only required dependencies. Bind the Reference during
// layer construction, when ForkLayer is present, rather than in the later request context.
export const modelPreview3dHandlers = McpToolAccess.toLayer(
  ModelPreview3dToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return {
      loom_model_preview_3d_propose_variants: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              service.proposeVariants({ threadId, path: input.path }, input.variants),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_render: McpToolAccess.readsAsCaller(
        (input: Parameters<typeof renderModelTool>[0]) =>
          renderModelTool(input).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    };
  }),
);
