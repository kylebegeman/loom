import * as W from "@t3tools/contracts/fork";
import { ModelPreviewError, ScadRenderResult, ModelWorkspace } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { loadCaller, assertFullAccess } from "../../mcp/threadAccess.ts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { ModelPreviewService } from "./ModelPreviewService.ts";
import { DEFAULT_RENDER_PROJECTION, View } from "./openscad.ts";
export const ModelPreview3dToolkit = Toolkit.make(
  Tool.make("loom_model_preview_3d_editor", {
    description:
      "Open, close, maximize and control the 3D editor: camera, standard views, display, navigation, section, selection tools, inspectors, refresh, saved views, captures and current state. Captures return a host PNG path. Lengths are in millimetres. display can show an everyday object for scale (reference), overhang shading, or the previous model version after a change (previous). Measure picks can snap to corners and edges (snap). Use tool with measure set to hole and one pick near a rim to save a hole diameter, returned as measurement. orientation supports auto, reset, bake, or face with one model-space point; tool lay-flat enables face picking. section.caps controls filled cuts; wall-thickness with one point returns a section-plane wall chord. display.findings shows or hides print-check pins. turn-history opens a checkpoint timeline; turn-compare shows another version as a ghost. layers shows sliced toolpaths. explode, isolate and select-part control assemblies.",
    parameters: Schema.Struct({ path: W.ModelFileRef.fields.path, command: W.ModelEditorAction }),
    success: W.ModelEditorResult,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Control 3D editor")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_printers", {
    description: "Read the environment printer and material library and built-in bed data.",
    parameters: Tool.EmptyParams,
    success: Schema.Struct({ library: W.PrinterLibrary, builtIns: Schema.Array(Schema.Unknown) }),
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "3D: printers")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_save_printers", {
    description:
      "Save the printer and material library. Read first and pass expectedVersion to detect competing changes.",
    parameters: W.PrinterLibraryUpdate,
    success: W.PrinterLibrary,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: save printers")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_read_printer_profile", {
    description:
      "Read a workspace JSON machine profile or PrusaSlicer INI config into a draft for review. Does not save.",
    parameters: Schema.Struct({ path: W.ModelFileRef.fields.path }),
    success: W.PrinterProfileDraft,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "3D: read printer profile")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_slice", {
    description:
      "Estimate print time, filament, support and cost with the mapped host slicer. Returns cached results on request. Never sends anything to a printer.",
    parameters: Schema.Struct({
      path: W.ModelFileRef.fields.path,
      overrides: Schema.optionalKey(W.SliceInput.fields.overrides),
      parameterSet: Schema.optionalKey(W.SliceInput.fields.parameterSet),
      variantId: W.SliceInput.fields.variantId,
      bedId: W.SliceInput.fields.bedId,
      cachedOnly: W.SliceInput.fields.cachedOnly,
    }),
    success: W.SliceResult,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: slice")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_history", {
    description:
      "List thread checkpoints that changed this model or its inputs. Use checkpointId with render, restore_version or the editor history commands.",
    parameters: Schema.Struct({
      path: W.ModelFileRef.fields.path,
      cursor: W.ModelHistoryInput.fields.cursor,
      limit: W.ModelHistoryInput.fields.limit,
    }),
    success: W.ModelHistory,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "3D: history")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_restore_version", {
    description:
      "Restore one model checkpoint, optionally with its dependencies, or undo the last restore using undoId. expectedContentKey detects a competing edit; read history first.",
    parameters: Schema.Struct({
      path: W.ModelFileRef.fields.path,
      checkpointId: Schema.optionalKey(W.ModelHistoryVersion.fields.checkpointId),
      undoId: Schema.optionalKey(Schema.String),
      includeDependencies: Schema.optionalKey(Schema.Boolean),
      expectedContentKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
    success: Schema.Struct({
      undoId: Schema.NullOr(Schema.String),
      restored: Schema.Array(Schema.String),
    }),
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: restore version")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_assembly", {
    description: "Read a repository assembly and its resolved part paths.",
    parameters: Schema.Struct({ path: W.ModelFileRef.fields.path }),
    success: W.AssemblyReadResult,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "3D: assembly")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_assembly_update", {
    description:
      "Create or edit a repository assembly with atomic operations. Pass expectedRevision from a read to detect competing edits. Positions, rotations and clearances are in millimetres and degrees. set-enclosure configures board, case parts and requirements; clear-enclosure removes them; place-board centres a board over the case; swap-board preserves its drawing-frame placement.",
    parameters: Schema.Struct({
      path: W.ModelFileRef.fields.path,
      operations: Schema.Array(W.AssemblyOperation).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(64),
      ),
      expectedRevision: Schema.optionalKey(Schema.String),
      createOnly: Schema.optionalKey(Schema.Boolean),
    }),
    success: W.AssemblyReadResult,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: assembly update")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_assembly_check", {
    description:
      "Check assembly intersections, touching faces, containment and required clearances on the host. Enclosure assemblies also report wall, lid/floor, connector and standoff findings, with a suggested board move when the mounting holes agree. A sampled or incomplete result needs review.",
    parameters: Schema.Struct({
      path: W.ModelFileRef.fields.path,
      ...W.AssemblyCheckOptions.fields,
    }),
    success: W.AssemblyCheckResult,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: assembly check")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_export_step", {
    description:
      "Export a Python CAD model to a STEP file in the workspace. Optional outputPath chooses a workspace-relative destination.",
    parameters: Schema.Struct({
      path: W.ModelFileRef.fields.path,
      overrides: Schema.optionalKey(W.ScadRenderInput.fields.overrides),
      parameterSet: Schema.optionalKey(W.ScadRenderInput.fields.parameterSet),
      outputPath: Schema.optionalKey(W.ModelFileRef.fields.path),
    }),
    success: Schema.Struct({ path: Schema.String, file: W.SignedFile }),
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: export step")
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
    success: Schema.Struct({
      models: Schema.Array(W.ModelEntry),
      assemblies: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            path: Schema.String,
            sizeBytes: Schema.Number,
            modifiedAt: Schema.String,
          }),
        ),
      ),
      truncated: Schema.Boolean,
    }),
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
    description: "Read OpenSCAD or Python CAD customizer parameters and sets.",
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
  Tool.make("loom_model_preview_3d_check", {
    description:
      "Check mesh topology, shells, build volume, first-layer contact, overhangs, unsupported islands, walls and small features before slicing. Runs on the environment host and returns the same located report as the Part inspector. All lengths and coordinates are millimetres, in model space. Applies saved orientation. Settings control nozzle diameter, first-layer height and overhang angle. Results may be sampled; incomplete reports need review.",
    parameters: Schema.Struct({ path: W.ModelFileRef.fields.path, ...W.PrintCheckOptions.fields }),
    success: W.PrintCheckResult,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "3D: print check")
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
    description:
      "Update 3D preview settings, including build volume, OpenSCAD path, scale reference, display units and display precision. displayUnits and displayPrecision only change what the user sees; every tool reads and writes millimetres.",
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
      "Render workspace SCAD, Python CAD, STEP, STL, 3MF or OBJ to PNG views. Python CAD uses *.b3d.py with def model(...) returning a build123d Shape; defaulted int, float, bool, str, Literal choices and numeric tuples become customizer parameters. Annotated metadata can supply min, max, step, group and description. checkpointId previews an earlier thread checkpoint. Returns host paths, geometry summary and logs. Read the PNGs to inspect the part. Projection defaults to orthographic; pass perspective for a perspective view. Includes a fit summary for the user's beds (sizes in mm), or null when this OpenSCAD build gives no geometry summary. fit.beds[].zone.reach is all-zones for shared nozzle reach, one-zone for the listed zoneIds, or whole-bed for the combined bed using the same filament in every nozzle. Set overhangs to also return overhang statistics: area beyond the angle from vertical, and the largest regions with their centres in model coordinates. overhangAngle defaults to the environment setting. Applies the model's saved Loom orientation unless orientation is none. Rendered PNGs remain unshaded; use an editor capture for overhang shading.",
    parameters: Schema.Struct({
      path: Schema.String,
      checkpointId: Schema.optionalKey(W.ModelHistoryVersion.fields.checkpointId),
      views: Schema.optional(
        Schema.Array(View).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
      ),
      overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      projection: Schema.optional(W.ModelProjection),
      orientation: Schema.optional(Schema.Literals(["saved", "none"])),
      overhangs: Schema.optional(Schema.Boolean),
      overhangAngle: Schema.optional(W.OverhangStats.fields.thresholdDegrees),
    }),
    success: Schema.Struct({
      images: Schema.Array(Schema.Struct({ view: View, path: Schema.String })),
      summary: ScadRenderResult.fields.summary,
      fit: Schema.NullOr(W.BedFitSummary),
      orientation: Schema.NullOr(W.ModelOrientation).pipe(
        Schema.withDecodingDefault(Effect.succeed(null)),
      ),
      overhangs: Schema.optional(W.OverhangStats),
      log: ScadRenderResult.fields.log,
    }),
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
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
/**
 * Runs one agent tool against the model service. Every tool, including settings, is refused
 * while the user has turned agent model tools off, so an agent cannot switch them back on.
 */
const withAgentTools = <A, E, R>(
  use: (service: ModelPreviewService["Service"]) => Effect.Effect<A, E, R>,
) =>
  withForkRuntime(
    Effect.gen(function* () {
      const service = yield* ModelPreviewService;
      if (!(yield* service.getSettings()).agentToolEnabled)
        return yield* new ModelPreviewError({
          reason: "command-failed",
          message: "Agent model tools are disabled in Loom settings.",
        });
      return yield* use(service);
    }),
  );
const cadAccess = (path: string) =>
  /\.b3d\.py$/i.test(path)
    ? loadCaller().pipe(
        Effect.flatMap((caller) =>
          assertFullAccess(
            caller,
            "Running Python CAD needs a full-access caller in default mode.",
          ),
        ),
      )
    : Effect.void;
export const renderModelTool = Effect.fn("ModelPreview.renderTool")(function* (input: {
  path: string;
  checkpointId?: typeof W.ModelHistoryVersion.Type.checkpointId | undefined;
  views?: ReadonlyArray<typeof View.Type> | undefined;
  overrides?: Readonly<Record<string, string>> | undefined;
  projection?: W.ModelProjection | undefined;
  orientation?: "saved" | "none" | undefined;
  overhangs?: boolean | undefined;
  overhangAngle?: number | undefined;
}) {
  const threadId = yield* modelThread;
  yield* cadAccess(input.path);
  return yield* withAgentTools((service) =>
    service.renderImages(
      { threadId, path: input.path },
      input.views ?? ["iso", "front", "top", "right"],
      input.overrides ?? {},
      input.projection ?? DEFAULT_RENDER_PROJECTION,
      {
        ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
        ...(input.overhangs ? { overhangs: { angle: input.overhangAngle } } : {}),
        ...(input.orientation ? { orientation: input.orientation } : {}),
      },
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
          return yield* withAgentTools((service) => service.editorAction({ ...input, threadId }));
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_printers: McpToolAccess.readsAsCaller(() =>
        Effect.gen(function* () {
          yield* modelThread;
          return yield* withAgentTools((service) =>
            service.printers().pipe(
              Effect.map((library) => ({
                library,
                builtIns: Object.values(W.BUILT_IN_PRINTERS),
              })),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_save_printers: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          yield* modelThread;
          return yield* withAgentTools((service) => service.updatePrinters(input));
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_read_printer_profile: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withAgentTools((service) =>
            service.readPrinterProfile({ threadId, path: input.path }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_slice: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          const { path, overrides, parameterSet, ...options } = input;
          yield* cadAccess(path);
          return yield* withAgentTools((service) =>
            service.slice({
              file: { threadId, path },
              overrides: overrides ?? {},
              parameterSet: parameterSet ?? null,
              ...options,
            }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_history: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          const { path, ...options } = input;
          return yield* withAgentTools((service) =>
            service.history({ file: { threadId, path }, ...options }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_restore_version: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          const file = { threadId, path: input.path };
          return yield* withAgentTools((service) =>
            Effect.gen(function* () {
              if (input.undoId && !input.checkpointId) {
                yield* service.historyUndo({ file, undoId: input.undoId });
                return { undoId: null, restored: [] as string[] };
              }
              if (!input.checkpointId || input.undoId)
                return yield* new ModelPreviewError({
                  reason: "invalid-parameter",
                  message: "Choose either checkpointId or undoId.",
                });
              const expectedContentKey =
                input.expectedContentKey !== undefined
                  ? input.expectedContentKey
                  : (yield* service.history({ file })).current.contentKey;
              return yield* service.historyRestore({
                file,
                checkpointId: input.checkpointId,
                expectedContentKey,
                includeDependencies: input.includeDependencies ?? false,
              });
            }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_assembly: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withAgentTools((service) =>
            service.assembly({ threadId, path: input.path }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_assembly_update: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          const { path, ...options } = input;
          return yield* withAgentTools((service) =>
            service.updateAssembly({ file: { threadId, path }, ...options }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_assembly_check: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          const { path, ...options } = input;
          return yield* withAgentTools((service) =>
            service.checkAssembly({ file: { threadId, path }, ...options }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_export_step: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          const { path, overrides, parameterSet, outputPath } = input;
          return yield* withAgentTools((service) =>
            service.exportStepTo({
              file: { threadId, path },
              overrides: overrides ?? {},
              parameterSet: parameterSet ?? null,
              ...(outputPath ? { outputPath } : {}),
            }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_status: McpToolAccess.readsAsCaller((_input) =>
        Effect.gen(function* () {
          yield* modelThread;
          return yield* withAgentTools((service) => service.status());
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_list: McpToolAccess.readsAsCaller((_input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withAgentTools((service) => service.listModels(threadId, ["build123d"]));
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_file: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withAgentTools((service) =>
            service.fileUrl({ threadId, path: input.path }, input.allowLarge ?? false),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_parameters: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withAgentTools((service) =>
            service.parameters({ threadId, path: input.path }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_workspace: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withAgentTools((service) =>
            service.getWorkspace({ threadId, path: input.path }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_save_workspace: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withAgentTools((service) =>
            service.updateWorkspace({ threadId, path: input.path }, input.operation),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_check: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          const { path, ...options } = input;
          return yield* withAgentTools((service) =>
            service.checkPrint({ file: { threadId, path }, ...options }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_render_mesh: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          yield* cadAccess(input.path);
          return yield* withAgentTools((service) =>
            service.renderModel({
              file: { threadId, path: input.path },
              overrides: input.overrides,
              parameterSet: input.parameterSet,
              ...(input.variantId ? { variantId: input.variantId } : {}),
            }),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_save_parameter_set: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withAgentTools((service) =>
            service.saveParameterSet({ threadId, path: input.path }, input.name, input.values),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_cancel_variant: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withAgentTools((service) =>
            service.cancelVariant({ threadId, path: input.path }, input.variantId),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_settings: McpToolAccess.readsAsCaller((_input) =>
        Effect.gen(function* () {
          yield* modelThread;
          return yield* withAgentTools((service) => service.getSettings());
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_save_settings: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          yield* modelThread;
          return yield* withAgentTools((service) => service.updateSettings(input.settings));
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_clear_cache: McpToolAccess.writesEnvironment((_input) =>
        Effect.gen(function* () {
          yield* modelThread;
          return yield* withAgentTools((service) => service.clearCache());
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_propose_variants: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* modelThread;
          return yield* withAgentTools((service) =>
            service.proposeVariants({ threadId, path: input.path }, input.variants),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_model_preview_3d_render: McpToolAccess.actsAsCaller(
        (input: Parameters<typeof renderModelTool>[0]) =>
          renderModelTool(input).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    };
  }),
);
