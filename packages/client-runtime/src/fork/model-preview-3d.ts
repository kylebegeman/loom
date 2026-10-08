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
