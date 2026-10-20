import { VAULT_MIGRATION_WS_METHODS as V } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export function createVaultMigrationAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    typedList: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:typed-import-list",
      tag: V.typedList,
    }),
    typedInspect: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:typed-import-inspect",
      tag: V.typedInspect,
    }),
    typedPrepare: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:typed-import-prepare",
      tag: V.typedPrepare,
    }),
    typedApply: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:typed-import-apply",
      tag: V.typedApply,
    }),
    typedCancel: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:typed-import-cancel",
      tag: V.typedCancel,
    }),
    typedArchive: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:typed-import-archive",
      tag: V.typedArchive,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:migration-list",
      tag: V.list,
    }),
    inspect: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:migration-inspect",
      tag: V.inspect,
    }),
    prepare: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:migration-prepare",
      tag: V.prepare,
    }),
    apply: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:migration-apply",
      tag: V.apply,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:migration-cancel",
      tag: V.cancel,
    }),
    archive: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:migration-archive",
      tag: V.archive,
    }),
  };
}
