import * as Effect from "effect/Effect";
import {
  PCB_PREVIEW_WS_METHODS as M,
  type PcbRenderInput,
  type PcbCheckInput,
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
  return {
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
    readSheet: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.readSheet,
      PcbReadSheetInput & { revision?: string }
    >(runtime, { label: "loom:pcb-sheet", tag: M.readSheet }),
  };
}
