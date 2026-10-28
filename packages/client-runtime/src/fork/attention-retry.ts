import { ATTENTION_STATUS_WS_METHODS as A } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";

export function createAttentionRetryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    retry: createEnvironmentRpcCommand(runtime, { label: "loom:attention-retry", tag: A.retry }),
  };
}
