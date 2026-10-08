import * as W from "@t3tools/contracts/fork";
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
  Tool.make("loom_model_preview_3d_editor", {
    description:
      "Open, close, maximize and control the 3D editor: camera, standard views, display, navigation, section, selection tools, inspectors, refresh, saved views, captures and current state. Captures return a host PNG path.",
    parameters: Schema.Struct({ path: W.ModelFileRef.fields.path, command: W.ModelEditorAction }),
    success: W.ModelEditorResult,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Control 3D editor")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_status", {
    description: "Detect the environment OpenSCAD installation.",
    parameters: Tool.EmptyParams,
    success: W.ModelPreviewStatus,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "3D: status")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_list", {
    description: "List model files in this thread workspace.",
    parameters: Tool.EmptyParams,
    success: Schema.Struct({ models: Schema.Array(W.ModelEntry), truncated: Schema.Boolean }),
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "3D: list")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_file", {
    description: "Get an authenticated mesh URL for this workspace model.",
    parameters: Schema.Struct({
      path: W.ModelFileRef.fields.path,
      allowLarge: Schema.optional(Schema.Boolean),
    }),
    success: W.SignedFile,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "3D: file")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_parameters", {
    description: "Read OpenSCAD customizer parameters and sets.",
    parameters: Schema.Struct({ path: W.ModelFileRef.fields.path }),
    success: W.ScadParameters,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "3D: parameters")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_workspace", {
    description: "Read saved views, measurements, annotations, capture presets and variants.",
    parameters: Schema.Struct({ path: W.ModelFileRef.fields.path }),
    success: W.ModelWorkspace,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "3D: workspace")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_save_workspace", {
    description:
      "Add, update or remove a view, measurement, annotation, capture preset or variant.",
    parameters: Schema.Struct({
      path: W.ModelFileRef.fields.path,
      operation: W.ModelWorkspaceOperation,
    }),
    success: W.ModelWorkspace,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: save workspace")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_render_mesh", {
    description:
      "Build a preview mesh with customizer values or a saved parameter set. MCP cancellation interrupts the render.",
    parameters: Schema.Struct({
      path: W.ModelFileRef.fields.path,
      overrides: W.ScadRenderInput.fields.overrides,
      parameterSet: W.ScadRenderInput.fields.parameterSet,
      variantId: W.ScadRenderInput.fields.variantId,
    }),
    success: W.ScadRenderResult,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: render mesh")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_save_parameter_set", {
    description: "Save customizer values in the workspace sidecar.",
    parameters: Schema.Struct({
      path: W.ModelFileRef.fields.path,
      name: Schema.String,
      values: Schema.Record(Schema.String, Schema.String),
    }),
    success: Schema.Void,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: save parameter set")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_cancel_variant", {
    description: "Cancel one running variant build.",
    parameters: Schema.Struct({ path: W.ModelFileRef.fields.path, variantId: Schema.String }),
    success: Schema.Void,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: cancel variant")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_settings", {
    description: "Read 3D preview settings, including the build plate.",
    parameters: Tool.EmptyParams,
    success: W.ModelPreviewSettings,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "3D: settings")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_save_settings", {
    description: "Update 3D preview settings, including build volume and OpenSCAD path.",
    parameters: Schema.Struct({ settings: W.ModelPreviewSettings }),
    success: W.ModelPreviewSettings,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: save settings")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_clear_cache", {
    description: "Remove completed temporary model render cache entries.",
    parameters: Tool.EmptyParams,
    success: Schema.Void,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: clear cache")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
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
      loom_model_preview_3d_editor: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                if (!(yield* service.getSettings()).agentToolEnabled)
                  return yield* new ModelPreviewError({
                    reason: "command-failed",
                    message: "Agent model tools are disabled in Loom settings.",
                  });
                return yield* service.editorAction({ ...input, threadId });
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_status: McpToolAccess.readsAsCaller((_input) =>
        Effect.gen(function* () {
          yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                return yield* service.status();
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_list: McpToolAccess.readsAsCaller((_input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                const settings = yield* service.getSettings();
                if (!settings.agentToolEnabled)
                  return yield* new ModelPreviewError({
                    reason: "command-failed",
                    message: "Agent model tools are disabled in Loom settings.",
                  });
                return yield* service.listModels(threadId);
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_file: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                const settings = yield* service.getSettings();
                if (!settings.agentToolEnabled)
                  return yield* new ModelPreviewError({
                    reason: "command-failed",
                    message: "Agent model tools are disabled in Loom settings.",
                  });
                return yield* service.fileUrl(
                  { threadId, path: input.path },
                  input.allowLarge ?? false,
                );
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_parameters: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                const settings = yield* service.getSettings();
                if (!settings.agentToolEnabled)
                  return yield* new ModelPreviewError({
                    reason: "command-failed",
                    message: "Agent model tools are disabled in Loom settings.",
                  });
                return yield* service.parameters({ threadId, path: input.path });
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_workspace: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                const settings = yield* service.getSettings();
                if (!settings.agentToolEnabled)
                  return yield* new ModelPreviewError({
                    reason: "command-failed",
                    message: "Agent model tools are disabled in Loom settings.",
                  });
                return yield* service.getWorkspace({ threadId, path: input.path });
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_save_workspace: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                const settings = yield* service.getSettings();
                if (!settings.agentToolEnabled)
                  return yield* new ModelPreviewError({
                    reason: "command-failed",
                    message: "Agent model tools are disabled in Loom settings.",
                  });
                return yield* service.updateWorkspace(
                  { threadId, path: input.path },
                  input.operation,
                );
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_render_mesh: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                const settings = yield* service.getSettings();
                if (!settings.agentToolEnabled)
                  return yield* new ModelPreviewError({
                    reason: "command-failed",
                    message: "Agent model tools are disabled in Loom settings.",
                  });
                return yield* service.renderScad({
                  file: { threadId, path: input.path },
                  overrides: input.overrides,
                  parameterSet: input.parameterSet,
                  ...(input.variantId ? { variantId: input.variantId } : {}),
                });
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_save_parameter_set: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                const settings = yield* service.getSettings();
                if (!settings.agentToolEnabled)
                  return yield* new ModelPreviewError({
                    reason: "command-failed",
                    message: "Agent model tools are disabled in Loom settings.",
                  });
                return yield* service.saveParameterSet(
                  { threadId, path: input.path },
                  input.name,
                  input.values,
                );
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_cancel_variant: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                const settings = yield* service.getSettings();
                if (!settings.agentToolEnabled)
                  return yield* new ModelPreviewError({
                    reason: "command-failed",
                    message: "Agent model tools are disabled in Loom settings.",
                  });
                return yield* service.cancelVariant(
                  { threadId, path: input.path },
                  input.variantId,
                );
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_settings: McpToolAccess.readsAsCaller((_input) =>
        Effect.gen(function* () {
          yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                return yield* service.getSettings();
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_save_settings: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                return yield* service.updateSettings(input.settings);
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_clear_cache: McpToolAccess.writesEnvironment((_input) =>
        Effect.gen(function* () {
          yield* modelThread;
          return yield* withForkRuntime(
            Effect.flatMap(ModelPreviewService, (service) =>
              Effect.gen(function* () {
                const settings = yield* service.getSettings();
                if (!settings.agentToolEnabled)
                  return yield* new ModelPreviewError({
                    reason: "command-failed",
                    message: "Agent model tools are disabled in Loom settings.",
                  });
                return yield* service.clearCache();
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
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
