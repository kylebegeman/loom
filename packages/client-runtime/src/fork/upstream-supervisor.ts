import { UPSTREAM_WS_METHODS } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

export function createUpstreamSupervisorAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:upstream:status",
      tag: UPSTREAM_WS_METHODS.status,
    }),
    configure: createEnvironmentRpcCommand(runtime, {
      label: "loom:upstream:configure",
      tag: UPSTREAM_WS_METHODS.configure,
    }),
    dispatch: createEnvironmentRpcCommand(runtime, {
      label: "loom:upstream:dispatch",
      tag: UPSTREAM_WS_METHODS.dispatch,
    }),
  };
}
