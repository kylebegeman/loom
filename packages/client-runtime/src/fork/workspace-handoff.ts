import { WORKSPACE_HANDOFF_WS_METHODS as H } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";

export function createWorkspaceHandoffAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    offer: createEnvironmentRpcCommand(runtime, { label: "loom:handoff-offer", tag: H.offer }),
    prepare: createEnvironmentRpcCommand(runtime, {
      label: "loom:handoff-prepare",
      tag: H.prepare,
    }),
    finish: createEnvironmentRpcCommand(runtime, { label: "loom:handoff-finish", tag: H.finish }),
    resume: createEnvironmentRpcCommand(runtime, { label: "loom:handoff-resume", tag: H.resume }),
  };
}
