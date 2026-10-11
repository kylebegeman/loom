import * as Effect from "effect/Effect";
import {
  PCB_PREVIEW_WS_METHODS as M,
  type PcbFabPackageInput,
  type PcbFabCheckInput,
  type PcbReviewInput,
  type PcbRenderInput,
  type PcbCheckInput,
  type PcbPrintInput,
  type PcbReadSheetInput,
  type PcbInspectInput,
  type PcbWorkspaceUpdate,
  type PcbAssetInput,
  type PcbCompareInput,
  type PcbApplyParametersInput,
  type PcbSimulateInput,
  type PcbLibraryUpdate,
  type PcbReferenceInput,
  type PcbEditorInput,
  type PcbCompleteEditorInput,
} from "@t3tools/contracts/fork";
import {
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentRpcCommand,
} from "../state/runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import type { Atom } from "effect/reactivity";

/** Document-lived jobs cancel when their result atom loses its last subscriber. */
export function createPcbPreviewAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  const fabPackages = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:pcb-packages",
    tag: M.fabPackages,
    staleTimeMs: 0,
  });
  const fabCapabilities = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:pcb-fabs",
    tag: M.fabCapabilities,
    staleTimeMs: 0,
  });
  const latestFabCheck = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:pcb-fab-check",
    tag: M.latestFabCheck,
    staleTimeMs: 0,
  });
  const latestReview = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:pcb-review",
    tag: M.latestReview,
    staleTimeMs: 0,
  });
  const latestChecks = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:pcb-checks",
    tag: M.latestChecks,
    staleTimeMs: 0,
  });
  const workspace = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:pcb-workspace",
    tag: M.workspace,
    staleTimeMs: 0,
  });
  const library = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:pcb-library",
    tag: M.library,
    staleTimeMs: 0,
  });
  const projectSettings = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:pcb-project-settings",
    tag: M.projectSettings,
    staleTimeMs: 0,
  });
  return {
    enclosure: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.enclosure,
      import("@t3tools/contracts/fork").PcbEnclosureInput & { revision?: number }
    >(runtime, { label: "loom:pcb-enclosure", tag: M.enclosure }),
    history: createEnvironmentRpcCommand(runtime, { label: "loom:pcb-history", tag: M.history }),
    historyRestore: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-history-restore",
      tag: M.historyRestore,
    }),
    historyUndo: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-history-undo",
      tag: M.historyUndo,
    }),
    fabPackages,
    loadFabPackages: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-packages-load",
      tag: M.fabPackages,
    }),
    fabPackage: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.fabPackage,
      PcbFabPackageInput & { revision?: number }
    >(runtime, {
      label: "loom:pcb-package-build",
      tag: M.fabPackage,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() => {
          registry.refresh(
            fabPackages({
              environmentId,
              input: { threadId: input.threadId, designId: input.designId },
            }),
          );
          registry.refresh(
            latestChecks({
              environmentId,
              input: { threadId: input.threadId, designId: input.designId },
            }),
          );
          if (input.fabId)
            registry.refresh(
              latestFabCheck({
                environmentId,
                input: { threadId: input.threadId, designId: input.designId, fabId: input.fabId },
              }),
            );
        }),
    }),
    fabPackageZip: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-package-zip",
      tag: M.fabPackageZip,
    }),
    deleteFabPackage: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-package-delete",
      tag: M.deleteFabPackage,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(
            fabPackages({
              environmentId,
              input: { threadId: input.threadId, designId: input.designId },
            }),
          ),
        ),
    }),

    changeRequest: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-change-request",
      tag: M.changeRequest,
    }),
    pinMap: createEnvironmentRpcCommand(runtime, { label: "loom:pcb-pin-map", tag: M.pinMap }),
    turnDesigns: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:pcb-turn-designs",
      tag: M.turnDesigns,
      staleTimeMs: 0,
    }),
    loadTurnDesigns: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-turn-designs-load",
      tag: M.turnDesigns,
    }),
    turnDesignEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:pcb-turn-design-events",
      tag: M.turnDesignEvents,
      idleTtlMs: 0,
    }),
    loadFabCapabilities: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-fabs-load",
      tag: M.fabCapabilities,
    }),
    fabCapabilities,
    latestFabCheck,
    updateFabCapabilities: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-fabs-save",
      tag: M.updateFabCapabilities,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(fabCapabilities({ environmentId, input: {} }))),
    }),
    fabCheck: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.fabCheck,
      PcbFabCheckInput & { revision?: number }
    >(runtime, {
      label: "loom:pcb-fab-check-run",
      tag: M.fabCheck,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(
            latestFabCheck({
              environmentId,
              input: {
                threadId: input.threadId,
                designId: input.designId,
                ...(input.fabId ? { fabId: input.fabId } : {}),
              },
            }),
          ),
        ),
    }),
    latestReview,
    review: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.review,
      PcbReviewInput & { revision?: number }
    >(runtime, {
      label: "loom:pcb-review-run",
      tag: M.review,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(
            latestReview({
              environmentId,
              input: { threadId: input.threadId, designId: input.designId },
            }),
          ),
        ),
    }),
    projectSettings,
    updateProjectSettings: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-project-settings-save",
      tag: M.updateProjectSettings,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(projectSettings({ environmentId, input: { threadId: input.threadId } })),
        ),
    }),
    checkEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:pcb-check-events",
      tag: M.checkEvents,
      idleTtlMs: 0,
    }),
    reuseHardware: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-reuse",
      tag: M.reuseHardware,
    }),
    workspaceUpdates: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:pcb-workspace-updates",
      tag: M.workspaceUpdates,
      idleTtlMs: 0,
    }),
    panelEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:pcb-panel",
      tag: M.panelEvents,
      idleTtlMs: 0,
    }),
    editorEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:pcb-editor",
      tag: M.editorEvents,
      idleTtlMs: 0,
    }),
    exportReference: createEnvironmentRpcCommand<R, E, typeof M.exportReference, PcbReferenceInput>(
      runtime,
      { label: "loom:pcb-export-reference", tag: M.exportReference },
    ),
    editorAction: createEnvironmentRpcCommand<R, E, typeof M.editorAction, PcbEditorInput>(
      runtime,
      { label: "loom:pcb-editor-action", tag: M.editorAction },
    ),
    completeEditorAction: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.completeEditorAction,
      PcbCompleteEditorInput
    >(runtime, { label: "loom:pcb-editor-ack", tag: M.completeEditorAction }),
    workspace,
    library,
    revisions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:pcb-revisions",
      tag: M.revisions,
      staleTimeMs: 0,
    }),
    parameters: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:pcb-parameters",
      tag: M.parameters,
      staleTimeMs: 0,
    }),
    inspect: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.inspect,
      PcbInspectInput & { revision?: string }
    >(runtime, { label: "loom:pcb-inspect", tag: M.inspect }),
    asset: createEnvironmentRpcCommand<R, E, typeof M.asset, PcbAssetInput & { revision?: string }>(
      runtime,
      { label: "loom:pcb-asset", tag: M.asset },
    ),
    compare: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.compare,
      PcbCompareInput & { revision?: string }
    >(runtime, { label: "loom:pcb-compare", tag: M.compare }),
    applyParameters: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.applyParameters,
      PcbApplyParametersInput & { revision?: string }
    >(runtime, { label: "loom:pcb-applyParameters", tag: M.applyParameters }),
    simulate: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.simulate,
      PcbSimulateInput & { revision?: string }
    >(runtime, { label: "loom:pcb-simulate", tag: M.simulate }),
    updateWorkspace: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.updateWorkspace,
      PcbWorkspaceUpdate
    >(runtime, {
      label: "loom:pcb-save",
      tag: M.updateWorkspace,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(
            workspace({
              environmentId,
              input: { threadId: input.threadId, designId: input.designId },
            }),
          ),
        ),
    }),
    updateLibrary: createEnvironmentRpcCommand<R, E, typeof M.updateLibrary, PcbLibraryUpdate>(
      runtime,
      {
        label: "loom:pcb-library-save",
        tag: M.updateLibrary,
        onSuccess: ({ environmentId }, registry) =>
          Effect.sync(() => registry.refresh(library({ environmentId, input: {} }))),
      },
    ),

    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:pcb-status",
      tag: M.status,
    }),
    designs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:pcb-designs",
      tag: M.listDesigns,
    }),
    latestChecks,
    watch: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:pcb-watch",
      tag: M.watch,
      idleTtlMs: 0,
    }),
    renderVariant: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-render-variant",
      tag: M.renderVariant,
    }),
    cancelVariant: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-cancel-variant",
      tag: M.cancelVariant,
    }),
    render: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.render,
      PcbRenderInput & { revision?: string }
    >(runtime, { label: "loom:pcb-render", tag: M.render }),
    check: createEnvironmentRpcCommand<R, E, typeof M.check, PcbCheckInput & { revision?: number }>(
      runtime,
      {
        label: "loom:pcb-check",
        tag: M.check,
        onSuccess: ({ environmentId, input }, registry) =>
          Effect.sync(() =>
            registry.refresh(
              latestChecks({
                environmentId,
                input: { threadId: input.threadId, designId: input.designId },
              }),
            ),
          ),
      },
    ),
    print: createEnvironmentRpcCommand<R, E, typeof M.print, PcbPrintInput>(runtime, {
      label: "loom:pcb-print",
      tag: M.print,
    }),
    readSheet: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.readSheet,
      PcbReadSheetInput & { revision?: string }
    >(runtime, { label: "loom:pcb-sheet", tag: M.readSheet }),
  };
}
