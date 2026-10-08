import * as W from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
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
      "Control the visible PCB editor: fit, zoom, pan, navigate back/forward, select components and nets, set layers, linked/3D modes, tool dock, measurements and annotation tools, load views, or capture PNG. Returns an acknowledgement and host PNG path for captures.",
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
      "Inspect components, pins, nets, layers and physical board coordinates. Runs CAD exporters when needed.",
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
  Tool.make("loom_pcb_check", {
    description: "Run KiCad ERC or DRC on saved source.",
    parameters: Schema.Struct({ ...design, kind: W.PcbCheckInput.fields.kind }),
    success: W.PcbCheckResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "PCB: check")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_latest_checks", {
    description: "Read latest persisted rule checks.",
    parameters: Schema.Struct(design),
    success: W.PcbLatestChecksResult,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "PCB: latest checks")
    .annotate(Tool.Readonly, true)
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
      "Save editor tools with optimistic concurrency. Supports creating and removing every saved view, layer combination, measurement, annotation, setup and variant.",
    parameters: Schema.Struct({
      ...design,
      expectedVersion: W.PcbWorkspaceUpdate.fields.expectedVersion,
      workspace: W.PcbWorkspace,
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
      loom_pcb_check: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) => service.check({ ...input, threadId })),
          );
        }).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      loom_pcb_latest_checks: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const threadId = yield* thread;
          return yield* withForkRuntime(
            Effect.flatMap(PcbPreviewService, (service) =>
              service.latestChecks({ ...input, threadId }),
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
