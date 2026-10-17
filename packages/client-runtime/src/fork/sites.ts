import { SITES_WS_METHODS } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "../state/runtime.ts";

/** Keep private site data in memory and route reads to the selected Library authority. */
export function createSitesAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
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
