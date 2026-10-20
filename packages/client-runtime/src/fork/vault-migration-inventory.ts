import { VAULT_MIGRATION_INVENTORY_WS_METHODS as V } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export function createVaultMigrationInventoryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    inventory: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:migration-inventory",
      tag: V.inventory,
    }),
    prepare: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:replacement-prepare",
      tag: V.prepare,
    }),
    inspect: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:replacement-inspect",
      tag: V.inspect,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:replacement-list",
      tag: V.list,
    }),
    review: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:replacement-review",
      tag: V.review,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:replacement-cancel",
      tag: V.cancel,
    }),
  };
}
