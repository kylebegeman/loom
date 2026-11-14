import { RELEASE_INDEX_WS_METHODS } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "../state/runtime.ts";

/** The same interval clients used to poll GitHub's release list. */
const RELEASE_INDEX_REFRESH_MS = 5 * 60_000;

/** The releases an environment's Library mirrors; `null` where it hosts none. */
export function createReleaseIndexAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:releases:index",
    tag: RELEASE_INDEX_WS_METHODS.index,
    refreshIntervalMs: RELEASE_INDEX_REFRESH_MS,
  });
}
