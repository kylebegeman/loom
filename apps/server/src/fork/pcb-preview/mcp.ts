import * as W from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { assertFullAccess, loadCaller } from "../../mcp/threadAccess.ts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { PcbPreviewService } from "./PcbPreviewService.ts";
const design = { designId: W.PcbInspectInput.fields.designId };
const failure = Schema.Union([W.PcbPreviewError, OrchestratorMcpFailure]);
export const PcbToolkit = Toolkit.make(
  Tool.make("loom_pcb_reuse_hardware", {
    description:
      "Copy an entry's explicitly linked local assets into this thread workspace. Immutable content folders preserve originals; link every required companion file before importing multi-file CAD designs.",
    parameters: Schema.Struct({ itemId: W.PcbReuseHardwareInput.fields.itemId }),
    success: W.PcbReuseHardwareResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Reuse hardware assets")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_editor", {
    description:
      "Control the visible PCB editor: show changes since the last reload (changes), fit, zoom, pan, navigate back/forward, select components and nets, set layers, linked/3D modes, tool dock, measurements and annotation tools, load views, or capture PNG or SVG with format and PNG scale 1 or 2. Returns an acknowledgement and a host image path for captures. Points, pan offsets and lengths are in millimetres. finding steps next/previous or selects a finding id; markers shows/hides pins; snapshot lists current surface findings. layers accepts name: a built-in preset id (assembly-front, assembly-back, copper-only, fab-review, silkscreen-check) or a saved layer set name.",
    parameters: Schema.Struct({ ...design, command: W.PcbEditorAction }),
    success: W.PcbEditorResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Control PCB editor")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_export_reference", {
    description:
      "Save a real GLB and mechanical revision metadata in this thread workspace or a specified destination thread workspace. Other threads can use these files as enclosure references. Creates files only on request.",
    parameters: Schema.Struct({
      ...design,
      targetThreadId: W.PcbReferenceInput.fields.targetThreadId,
    }),
    success: W.PcbReferenceResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Export board reference")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_status", {
    description: "Find installed CAD tools.",
    parameters: Tool.EmptyParams,
    success: W.PcbPreviewStatus,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "PCB: status")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_list", {
    description: "Find saved KiCad and tscircuit designs in this thread workspace.",
    parameters: Tool.EmptyParams,
    success: W.PcbListDesignsResult,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "PCB: list")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_inspect", {
    description:
      "Inspect components, pins, nets, layers and physical board coordinates. Runs CAD exporters when needed. Lengths and coordinates are in millimetres. For firmware constants use loom_pcb_pin_map.",
    parameters: Schema.Struct(design),
    success: W.PcbInspection,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: inspect")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_render", {
    description: "Build schematic or board SVG previews with custom layers.",
    parameters: Schema.Struct({
      ...design,
      view: W.PcbRenderInput.fields.view,
      layers: W.PcbRenderInput.fields.layers,
      layerNames: W.PcbRenderInput.fields.layerNames,
      force: W.PcbRenderInput.fields.force,
    }),
    success: W.PcbRenderResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: render")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_read_sheet", {
    description: "Read a rendered drawing in this thread workspace.",
    parameters: Schema.Struct({
      renderKey: W.PcbReadSheetInput.fields.renderKey,
      sheetId: W.PcbReadSheetInput.fields.sheetId,
    }),
    success: W.PcbReadSheetResult,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "PCB: read sheet")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_print", {
    description:
      "Create a true-scale PDF of the top or bottom board layers with a 50 mm scale bar. layers accepts board layer names or a built-in preset id or name. Saves under fab/print/ by default and returns the saved path; save=false returns a signed PDF URL. Ask the user to print at 100%. Lengths are in millimetres.",
    parameters: Schema.Struct({
      ...design,
      side: Schema.optional(W.PcbPrintSide),
      layers: W.PcbPrintInput.fields.layers,
      mirror: W.PcbPrintInput.fields.mirror,
      paper: Schema.optional(W.PcbPrintPaper),
      blackAndWhite: Schema.optional(Schema.Boolean),
      save: Schema.optional(Schema.Boolean),
    }),
    success: W.PcbPrintResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: print")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),

  Tool.make("loom_pcb_fab_package", {
    description:
      "Create Gerbers, drill, BOM, placements and assembly drawings under fab/, run checks and return a checklist. Never uploads or orders. Rotation corrections come from part fields and fab/rotations.csv.",
    parameters: Schema.Struct({
      ...design,
      profile: W.PcbFabPackageInput.fields.profile,
      fabId: W.PcbFabPackageInput.fields.fabId,
      assembly: W.PcbFabPackageInput.fields.assembly,
      force: W.PcbFabPackageInput.fields.force,
    }),
    success: W.PcbFabPackageAgentResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: fab package")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_fab_packages", {
    description: "List fabrication packages for this design.",
    parameters: Schema.Struct(design),
    success: Schema.Array(W.PcbFabPackageSummary),
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: fab packages")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_delete_fab_package", {
    description: "Delete a fabrication package and its outputs from fab/.",
    parameters: Schema.Struct({ ...design, packageId: W.PcbFabPackageRef.fields.packageId }),
    success: Schema.Void,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: delete fab package")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
  Tool.make("loom_pcb_fab_capabilities", {
    description: "List built-in and user fab capabilities, their checked dates and the default.",
    parameters: Tool.EmptyParams,
    success: W.PcbFabCatalog,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: fab capabilities")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_save_fab_capabilities", {
    description:
      "Save user fab entries and a default with optimistic versioning. Duplicate built-ins using a new id.",
    parameters: W.PcbFabCapabilitiesUpdate,
    success: W.PcbFabCatalog,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: save fab capabilities")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_fab_check", {
    description:
      "Run KiCad DRC with a fab profile on a temporary copy. The design files are unchanged. Includes qualitative cost drivers.",
    parameters: Schema.Struct({ ...design, fabId: W.PcbFabCheckInput.fields.fabId }),
    success: W.PcbFabCheckResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: fab check")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_latest_fab_check", {
    description: "Read the last fabrication check for this design and fab.",
    parameters: Schema.Struct({ ...design, fabId: W.PcbFabCheckInput.fields.fabId }),
    success: Schema.NullOr(W.PcbFabCheckResult),
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: latest fab check")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_review", {
    description:
      "Run eight deterministic schematic review heuristics: I2C pull-ups, decoupling, ESD, floating inputs, reset bias, LED resistors, drivers and regulator ratings. Each finding explains why. Reuses unchanged saved results. Configure rules or ignore findings with loom_pcb_check_settings.",
    parameters: Schema.Struct(design),
    success: W.PcbReviewResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: review")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_check", {
    description:
      "Run KiCad ERC or DRC on saved source. The delta lists findings added and resolved since the previous run. Coordinates are millimetres.",
    parameters: Schema.Struct({ ...design, kind: W.PcbCheckInput.fields.kind }),
    success: W.PcbCheckResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: check")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_pin_map", {
    description:
      "Generate a part's pin table and firmware constants from saved source. Formats: markdown, c, rust, micropython, circuitpython, arduino. GPIO comes from pin names. Pass save.path to write; save.overwrite confirms replacement.",
    parameters: Schema.Struct({
      ...design,
      reference: W.PcbPinMapInput.fields.reference,
      family: W.PcbPinMapInput.fields.family,
      format: W.PcbPinMapInput.fields.format,
      names: W.PcbPinMapInput.fields.names,
      includePower: W.PcbPinMapInput.fields.includePower,
      includeNoConnect: W.PcbPinMapInput.fields.includeNoConnect,
      save: W.PcbPinMapInput.fields.save,
      expectedSourceHash: W.PcbPinMapInput.fields.expectedSourceHash,
    }),
    success: W.PcbPinMapResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: pin map")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_check_settings", {
    description:
      "Read or update project checks after each save. Runs while a design is open or an agent requests fresh checks.",
    parameters: Schema.Struct({
      autoChecks: W.PcbUpdateProjectSettingsInput.fields.autoChecks,
      review: W.PcbUpdateProjectSettingsInput.fields.review,
    }),
    success: W.PcbProjectSettings,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: check settings")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_latest_checks", {
    description:
      "Read latest ERC and DRC results. With project automatic checks on, waits for saved files by default. The delta lists added and resolved findings; with checks off, use loom_pcb_check to refresh.",
    parameters: Schema.Struct({ ...design, ensureFresh: Schema.optional(Schema.Boolean) }),
    success: W.PcbLatestChecksResult,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "PCB: latest checks")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_change_requests", {
    description:
      "List change requests pinned to this design. Use baseRef with loom_pcb_compare to see changes since the request. Images are omitted.",
    parameters: Schema.Struct({
      ...design,
      status: Schema.optional(Schema.Literals(["open", "review", "accepted", "all"])),
    }),
    success: Schema.Array(
      Schema.Struct({
        ...W.PcbChangeRequest.fields,
        referenceImage: Schema.optional(Schema.String),
        designChanged: Schema.Boolean,
        anchorDescription: Schema.String,
      }),
    ),
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: change requests")
    .annotate(Tool.Readonly, true),
  Tool.make("loom_pcb_update_change_request", {
    description:
      "Mark a change request ready for review or back to open with a short note. Only the user can accept or reopen.",
    parameters: Schema.Struct({
      ...design,
      requestId: W.PcbChangeRequest.fields.id,
      status: W.PcbRequestStatus,
      response: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
    }),
    success: W.PcbWorkspace,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: update change request")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_workspace", {
    description:
      "Read saved views, layers, measurements, annotations, variants and simulation setups.",
    parameters: Schema.Struct(design),
    success: W.PcbWorkspace,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "PCB: workspace")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_save_workspace", {
    description:
      "Change requests are preserved; use loom_pcb_update_change_request. Save editor tools with optimistic concurrency. Supports creating and removing every saved view, layer combination, measurement, annotation, setup and variant.",
    parameters: Schema.Struct({
      ...design,
      expectedVersion: W.PcbWorkspaceUpdate.fields.expectedVersion,
      workspace: W.PcbWorkspaceInput,
    }),
    success: W.PcbWorkspace,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: save workspace")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_asset", {
    description:
      "Export a real GLB board, Circuit JSON or SPICE netlist. GLB defaults to a signed, streamable file URL; transport=inline returns bounded base64. Other formats return text.",
    parameters: Schema.Struct({
      ...design,
      format: W.PcbAssetInput.fields.format,
      transport: W.PcbAssetInput.fields.transport,
      force: W.PcbAssetInput.fields.force,
    }),
    success: W.PcbAsset,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: asset")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_revisions", {
    description: "List design Git commits and agent checkpoints.",
    parameters: Schema.Struct(design),
    success: W.PcbRevisions,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "PCB: revisions")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_compare", {
    description:
      "Compare board revisions structurally and visually. Empty to means current saved working tree.",
    parameters: Schema.Struct({
      ...design,
      from: W.PcbCompareInput.fields.from,
      to: W.PcbCompareInput.fields.to,
    }),
    success: W.PcbComparison,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: compare")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_parameters", {
    description: "Read explicit circuit parameter schema and current source.",
    parameters: Schema.Struct(design),
    success: W.PcbParameters,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "PCB: parameters")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_apply_parameters", {
    description:
      "Review or apply bounded parameter edits to explicit source markers. preview=true returns the proposed source without writing.",
    parameters: Schema.Struct({
      ...design,
      expectedSourceHash: W.PcbApplyParametersInput.fields.expectedSourceHash,
      values: W.PcbApplyParametersInput.fields.values,
      preview: W.PcbApplyParametersInput.fields.preview,
    }),
    success: W.PcbApplyParametersResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: apply parameters")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_simulate", {
    description:
      "Run operating-point, transient or AC analysis and parameter sweeps with ngspice. Returns real probe data and logs.",
    parameters: Schema.Struct({ ...design, setup: W.PcbSimulationSetup }),
    success: W.PcbSimulationResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: simulate")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_library", {
    description: "Read this environment hardware catalog and owned inventory.",
    parameters: Tool.EmptyParams,
    success: W.PcbHardwareLibrary,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "PCB: library")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_save_library", {
    description:
      "Save hardware entries, ownership, quantities, notes, links and local assets with optimistic concurrency.",
    parameters: Schema.Struct({
      expectedVersion: W.PcbLibraryUpdate.fields.expectedVersion,
      library: W.PcbHardwareLibrary,
    }),
    success: W.PcbHardwareLibrary,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: save library")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);
const thread = Effect.gen(function* () {
  const context = yield* McpInvocationContext;
  if (!context.thread)
    return yield* new W.PcbPreviewError({
      reason: "thread-not-found",
      message: "Use PCB tools from a Loom project thread.",
    });
  return context.thread.threadId;
});
export const pcbHandlers = McpToolAccess.toLayer(
  PcbToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return {
      loom_pcb_reuse_hardware: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.reuseHardware({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_editor: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.editorAction({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_export_reference: McpToolAccess.writesThreads(
        (input) => [input.targetThreadId],
        (input) =>
          Effect.gen(function* () {
            const threadId = yield* thread;
            return yield* withForkRuntime(
              Effect.flatMap(PcbPreviewService, (service) =>
                service.exportReference({ ...input, threadId }),
              ),
            );
          }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_status: McpToolAccess.readsAsCaller((_input) =>
        Effect.gen(function* () {
          yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.status()),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_list: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.listDesigns({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_inspect: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.inspect({ ...input, threadId })),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_render: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.render({ ...input, threadId })),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_read_sheet: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.readSheet({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_print: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const caller = yield* loadCaller();
          yield* assertFullAccess(
            caller,
            "Printing boards needs a full-access caller in default mode.",
          );
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.print({
                ...input,
                threadId,
                side: input.side ?? "top",
                paper: input.paper ?? "board",
                blackAndWhite: input.blackAndWhite ?? true,
                save: input.save ?? true,
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_check: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.check({ ...input, threadId })),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_pin_map: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.pinMap({ ...input, threadId })),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),

      loom_pcb_fab_package: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service
                .fabPackage({ ...input, threadId })
                .pipe(Effect.map(({ zip: _zip, ...manifest }) => manifest)),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_fab_packages: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.fabPackages({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_delete_fab_package: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.deleteFabPackage({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_fab_capabilities: McpToolAccess.readsAsCaller((_input) =>
        Effect.gen(function* () {
          yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.fabCapabilities()),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_save_fab_capabilities: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.updateFabCapabilities(input)),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_fab_check: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.fabCheck({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_latest_fab_check: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.latestFabCheck({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_review: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.review({ ...input, threadId })),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_check_settings: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              input.autoChecks || input.review
                ? service.updateProjectSettings({ ...input, threadId })
                : service.projectSettings({ threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_latest_checks: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.latestChecks({ ...input, threadId, ensureFresh: input.ensureFresh ?? true }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_change_requests: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.listRequests({ ...input, threadId }, input.status ?? "open"),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_update_change_request: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              Effect.gen(function* () {
                const current = yield* service.getWorkspace({ ...input, threadId });
                return yield* service.changeRequest(
                  {
                    ...input,
                    threadId,
                    expectedVersion: current.version,
                    operation: {
                      op: "status",
                      id: input.requestId,
                      status: input.status,
                      ...(input.response !== undefined ? { response: input.response } : {}),
                    },
                  },
                  "agent",
                );
              }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_workspace: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.getWorkspace({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_save_workspace: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.updateWorkspace({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_asset: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.asset({ ...input, threadId })),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_revisions: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.revisions({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_compare: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.compare({ ...input, threadId })),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_parameters: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.parameters({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_apply_parameters: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.applyParameters({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_simulate: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.simulate({ ...input, threadId }),
            ),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_library: McpToolAccess.readsAsCaller((_input) =>
        Effect.gen(function* () {
          yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.library()),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_save_library: McpToolAccess.writesEnvironment((_input) =>
        Effect.gen(function* () {
          yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.updateLibrary(_input)),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    };
  }),
);
