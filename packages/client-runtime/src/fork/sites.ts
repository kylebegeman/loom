import { SITES_WS_METHODS } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** Keep private site data in memory and route reads to the selected Library authority. */
export function createSitesAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    saveSite: createEnvironmentRpcCommand(runtime, {
      label: "loom:sites:saveSite",
      tag: SITES_WS_METHODS.saveSite,
    }),
    saveService: createEnvironmentRpcCommand(runtime, {
      label: "loom:sites:saveService",
      tag: SITES_WS_METHODS.saveService,
    }),
    saveCheck: createEnvironmentRpcCommand(runtime, {
      label: "loom:sites:saveCheck",
      tag: SITES_WS_METHODS.saveCheck,
    }),
    runChecks: createEnvironmentRpcCommand(runtime, {
      label: "loom:sites:runChecks",
      tag: SITES_WS_METHODS.runChecks,
    }),

    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:sites:snapshot",
      tag: SITES_WS_METHODS.snapshot,
    }),
    analytics: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:sites:analytics",
      tag: SITES_WS_METHODS.analytics,
    }),
  };
}
