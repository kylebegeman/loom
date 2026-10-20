import { VAULT_MIGRATION_INVENTORY_WS_METHODS as V } from "@t3tools/contracts/fork";
import type { Atom, AtomRegistry } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export function createVaultMigrationInventoryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const originalVerification = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:vault:original-verification",
    tag: V.originalVerification,
  });
  const verification = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:vault:replacement-verification",
    tag: V.verification,
  });
  const refreshVerification = (
    { environmentId, input }: { environmentId: EnvironmentId; input: { readonly id: string } },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() => {
      registry.refresh(verification({ environmentId, input: { id: input.id } }));
      registry.refresh(originalVerification({ environmentId, input: { id: input.id } }));
    });
  return {
    originalVerification,
    originalVerify: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:original-verify",
      tag: V.originalVerify,
      onSettled: refreshVerification,
    }),
    recoveryPreview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:recovery-preview",
      tag: V.recoveryPreview,
    }),
    preview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:replacement-preview",
      tag: V.preview,
    }),
    verify: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:replacement-verify",
      tag: V.verify,
      onSettled: refreshVerification,
    }),
    verification,
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
      onSuccess: refreshVerification,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:replacement-cancel",
      tag: V.cancel,
      onSuccess: refreshVerification,
    }),
  };
}
