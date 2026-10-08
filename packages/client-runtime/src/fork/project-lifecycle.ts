import { PROJECT_LIFECYCLE_WS_METHODS as L } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Lanes and storage settings for one environment; every request stays on that host. */
export function createProjectLifecycleAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    settings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:lanes-settings",
      tag: L.getSettings,
    }),
    updateSettings: createEnvironmentRpcCommand(runtime, {
      label: "loom:lanes-settings-update",
      tag: L.updateSettings,
    }),
    status: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:lanes-status",
      tag: L.watch,
    }),
    free: createEnvironmentRpcCommand(runtime, { label: "loom:lanes-free", tag: L.free }),
    grow: createEnvironmentRpcCommand(runtime, { label: "loom:lanes-grow", tag: L.grow }),
    mount: createEnvironmentRpcCommand(runtime, { label: "loom:lanes-mount", tag: L.mount }),
    discard: createEnvironmentRpcCommand(runtime, { label: "loom:lanes-discard", tag: L.discard }),
    installShell: createEnvironmentRpcCommand(runtime, {
      label: "loom:lanes-shell-install",
      tag: L.installShell,
    }),
    removeShell: createEnvironmentRpcCommand(runtime, {
      label: "loom:lanes-shell-remove",
      tag: L.removeShell,
    }),
    releaseLease: createEnvironmentRpcCommand(runtime, {
      label: "loom:lanes-lease-release",
      tag: L.releaseLease,
    }),
  };
}
