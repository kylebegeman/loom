import { MINI_OFFLOAD_WS_METHODS as M, type MiniWorkerRef } from "@t3tools/contracts/fork";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { requestGuarded } from "../rpc/client.ts";
import {
  createEnvironmentQueryAtomFamily,
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
    /**
     * The same check as a read, for screens that show a worker's readiness without a button. Each
     * read reaches the worker over SSH, so it stays fresh for the default stale time. The check is
     * a guarded method: gate reads on `check.permissionAtom`; the request is authorized again here.
     */
    readiness: createEnvironmentQueryAtomFamily(runtime, {
      label: "loom:mini-readiness",
      execute: (input: MiniWorkerRef) => requestGuarded(M.check, input),
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
