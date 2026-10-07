import { ModelPreviewError, ScadRenderResult, ModelWorkspace } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as McpServer from "effect/unstable/ai/McpServer";
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
    failure: ModelPreviewError,
    dependencies: [McpInvocationContext],
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
    failure: ModelPreviewError,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "Render 3D model")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);
export const renderModelTool = Effect.fn("ModelPreview.renderTool")(function* (input: {
  path: string;
  views?: ReadonlyArray<typeof View.Type> | undefined;
  overrides?: Readonly<Record<string, string>> | undefined;
}) {
  const invocation = yield* McpInvocationContext;
  return yield* withForkRuntime(
    Effect.flatMap(ModelPreviewService, (service) =>
      service.renderImages(
        { threadId: invocation.threadId, path: input.path },
        input.views ?? ["iso", "front", "top", "right"],
        input.overrides ?? {},
      ),
    ),
  );
});
// HTTP/MCP registration captures only required dependencies. Bind the Reference during
// layer construction, when ForkLayer is present, rather than in the later request context.
export const modelPreview3dHandlers = ModelPreview3dToolkit.toLayer(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return {
      loom_model_preview_3d_propose_variants: (input) =>
        Effect.gen(function* () {
          const invocation = yield* McpInvocationContext;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              service.proposeVariants(
                { threadId: invocation.threadId, path: input.path },
                input.variants,
              ),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      loom_model_preview_3d_render: (input: Parameters<typeof renderModelTool>[0]) =>
        renderModelTool(input).pipe(Effect.provideService(ForkRuntime, runtime)),
    };
  }),
);
export const ModelPreview3dToolkitRegistrationLive = McpServer.toolkit(ModelPreview3dToolkit).pipe(
  Layer.provide(modelPreview3dHandlers),
);
