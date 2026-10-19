import {
  VAULT_PROFILE_WS_METHODS as P,
  VAULT_REFERENCE_WS_METHODS as R,
  type VaultProfilePreview,
} from "@t3tools/contracts/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import { vaultItemChanges } from "./vault-core.ts";
const changes = Atom.family((_environmentId: EnvironmentId) => Atom.make(0));
export function createVaultProfileAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    pins: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:profile-pins",
      tag: P.pins,
      refreshTrigger: ({ environmentId }) => changes(environmentId),
    }),
    retirePin: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:retire-pin",
      tag: P.retirePin,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => {
          const signal = changes(environmentId);
          registry.set(signal, registry.get(signal) + 1);
        }),
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:profiles",
      tag: P.list,
      refreshTrigger: ({ environmentId }) => changes(environmentId),
    }),
    apply: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:profiles-apply",
      tag: P.apply,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => {
          const signal = changes(environmentId);
          registry.set(signal, registry.get(signal) + 1);
        }),
    }),
    preview: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:profiles-preview",
      tag: P.preview,
    }),
  };
}
export function createVaultReferenceAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    search: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:references-search",
      tag: R.search,
      refreshTrigger: ({ environmentId }) => vaultItemChanges(environmentId),
    }),
    describe: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:references-describe",
      tag: R.describe,
      refreshTrigger: ({ environmentId }) => vaultItemChanges(environmentId),
    }),
  };
}
export const vaultProfileBindingMessage = (
  state: VaultProfilePreview["bindings"][number]["state"],
) =>
  ({
    ready: "Ready for this thread",
    unchecked: "Host checked; choose a thread to check its grant",
    missing: "Choose a key and, for Git, a repository",
    unavailable: "The key is missing, archived or unsupported",
    untrusted: "Verify host trust before use",
    denied: "This thread needs a matching use grant",
  })[state];
