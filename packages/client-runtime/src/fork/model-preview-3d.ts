import { MODEL_PREVIEW_3D_WS_METHODS as M, type ScadRenderInput } from "@t3tools/contracts/fork";
import {
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentRpcCommand,
} from "../state/runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import type { Atom } from "effect/reactivity";

/** All requests stay scoped to the model's environment, including remote captures and settings. */
export function createModelPreviewAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const render = createEnvironmentRpcCommand<
    R,
    E,
    typeof M.renderScad,
    ScadRenderInput & { revision?: number }
  >(runtime, {
    label: "loom:model-render",
    tag: M.renderScad,
  });
  return {
    history: createEnvironmentRpcCommand(runtime, { label: "loom:model-history", tag: M.history }),
    historyVersion: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-historyVersion",
      tag: M.historyVersion,
    }),
    historyCancel: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-historyCancel",
      tag: M.historyCancel,
    }),
    historyRestore: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-historyRestore",
      tag: M.historyRestore,
    }),
    historyUndo: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-historyUndo",
      tag: M.historyUndo,
    }),
    assembly: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-assembly",
      tag: M.assembly,
    }),
    updateAssembly: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-updateAssembly",
      tag: M.updateAssembly,
    }),
    checkAssembly: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-checkAssembly",
      tag: M.checkAssembly,
    }),
    cancelAssemblyCheck: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-cancelAssemblyCheck",
      tag: M.cancelAssemblyCheck,
    }),
    slice: createEnvironmentRpcCommand(runtime, { label: "loom:model-slice", tag: M.slice }),
    slicerProfiles: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-slicerProfiles",
      tag: M.slicerProfiles,
    }),
    importSlicerProfile: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-importSlicerProfile",
      tag: M.importSlicerProfile,
    }),
    openSlice: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-openSlice",
      tag: M.openSlice,
    }),
    exportStep: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-exportStep",
      tag: M.exportStep,
    }),
    pythonSetup: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-pythonSetup",
      tag: M.pythonSetup,
    }),
    renderModel: createEnvironmentRpcCommand<
      R,
      E,
      typeof M.renderModel,
      ScadRenderInput & { revision?: number }
    >(runtime, { label: "loom:model-render-model", tag: M.renderModel }),

    printers: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:model-printers",
      tag: M.printers,
    }),
    updatePrinters: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-printers-save",
      tag: M.updatePrinters,
    }),
    parsePrinterProfile: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-printer-profile",
      tag: M.parsePrinterProfile,
    }),
    editorEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:model-editor",
      tag: M.editorEvents,
      idleTtlMs: 0,
    }),
    panelEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:model-panel",
      tag: M.panelEvents,
      idleTtlMs: 0,
    }),
    editorAction: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-editor-action",
      tag: M.editorAction,
    }),
    completeEditorAction: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-editor-ack",
      tag: M.completeEditorAction,
    }),
    workspace: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:model-workspace",
      tag: M.workspace,
      idleTtlMs: 0,
    }),
    updateWorkspace: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-workspace-update",
      tag: M.updateWorkspace,
    }),
    cancelVariant: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-variant-cancel",
      tag: M.cancelVariant,
    }),
    models: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:models",
      tag: M.listModels,
    }),
    turnModels: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:model-turn-models",
      tag: M.turnModels,
    }),
    loadTurnModels: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-turn-models-load",
      tag: M.turnModels,
    }),
    turnModelEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:model-turn-events",
      tag: M.turnModelEvents,
      idleTtlMs: 0,
    }),
    settings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:model-settings",
      tag: M.getSettings,
    }),
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:model-status",
      tag: M.status,
    }),
    watch: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:model-watch",
      tag: M.watch,
      idleTtlMs: 0,
    }),
    parameters: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-parameters",
      tag: M.parameters,
    }),
    fileUrl: createEnvironmentRpcCommand(runtime, { label: "loom:model-url", tag: M.fileUrl }),
    checkPrint: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-print-check",
      tag: M.checkPrint,
    }),
    cancelPrintCheck: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-print-check-cancel",
      tag: M.cancelPrintCheck,
    }),
    renderResult: render.resultAtom,
    render,
    saveSet: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-save-set",
      tag: M.saveParameterSet,
    }),
    updateSettings: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-update-settings",
      tag: M.updateSettings,
    }),
    clearCache: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-clear-cache",
      tag: M.clearCache,
    }),
    detect: createEnvironmentRpcCommand(runtime, { label: "loom:model-detect", tag: M.status }),
  };
}
