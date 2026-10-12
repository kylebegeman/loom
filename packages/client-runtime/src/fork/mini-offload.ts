import { MINI_OFFLOAD_WS_METHODS as M } from "@t3tools/contracts/fork";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export function createMiniOffloadAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    workers: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:mini-workers",
      tag: M.workers,
      staleTimeMs: 0,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:mini-list",
      tag: M.list,
      staleTimeMs: 0,
    }),
    inspect: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:mini-inspect",
      tag: M.inspect,
      staleTimeMs: 0,
    }),
    patch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:mini-patch",
      tag: M.patch,
      staleTimeMs: 0,
    }),
    check: createEnvironmentRpcCommand(runtime, { label: "loom:mini-check", tag: M.check }),
    prepare: createEnvironmentRpcCommand(runtime, { label: "loom:mini-prepare", tag: M.prepare }),
    artifacts: createEnvironmentRpcCommand(runtime, {
      label: "loom:mini-artifacts",
      tag: M.artifacts,
    }),
    register: createEnvironmentRpcCommand(runtime, {
      label: "loom:mini-register",
      tag: M.register,
    }),
    setEnabled: createEnvironmentRpcCommand(runtime, {
      label: "loom:mini-enabled",
      tag: M.setEnabled,
    }),
    submit: createEnvironmentRpcCommand(runtime, { label: "loom:mini-submit", tag: M.submit }),
    recover: createEnvironmentRpcCommand(runtime, { label: "loom:mini-recover", tag: M.recover }),
    cancel: createEnvironmentRpcCommand(runtime, { label: "loom:mini-cancel", tag: M.cancel }),
  };
}
