import { PROJECT_CHECKOUT_WS_METHODS as C } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

export function createProjectCheckoutAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    release: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-checkout:release",
      tag: C.release,
    }),
    restore: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-checkout:restore",
      tag: C.restore,
    }),
    preview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:project-checkout:preview",
      tag: C.preview,
    }),
    adopt: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-checkout:adopt",
      tag: C.adopt,
    }),
    setRetention: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-checkout:retention",
      tag: C.setRetention,
    }),
  };
}
