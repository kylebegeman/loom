import { VAULT_GITHUB_WS_METHODS as G } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import { refreshVaultItems, vaultItemChanges } from "./vault-core.ts";
export function createVaultGitHubAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:github",
      tag: G.list,
      refreshTrigger: ({ environmentId }) => vaultItemChanges(environmentId),
    }),
    info: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:github-info",
      tag: G.info,
      refreshTrigger: ({ environmentId }) => vaultItemChanges(environmentId),
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:github-save",
      tag: G.save,
      onSuccess: refreshVaultItems,
    }),
    test: createEnvironmentRpcCommand(runtime, { label: "loom:vault:github-test", tag: G.test }),
    change: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:github-change",
      tag: G.change,
      onSuccess: refreshVaultItems,
    }),
  };
}
