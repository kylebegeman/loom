import { PROJECT_RESOURCES_WS_METHODS as R } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** Resources live on the selected project host, independent of its working files. */
export function createProjectResourcesAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    get: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:project-resources:get",
      tag: R.get,
      staleTimeMs: 0,
    }),
    upsert: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-resources:upsert",
      tag: R.upsert,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-resources:remove",
      tag: R.remove,
    }),
  };
}
