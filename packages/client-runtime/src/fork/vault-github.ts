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
    readiness: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:github-readiness",
      tag: G.readiness,
    }),
    change: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:github-change",
      tag: G.change,
      onSuccess: refreshVaultItems,
    }),
  };
}

export const vaultGitHubReadinessReason = (reason: string | null): string | null => {
  switch (reason) {
    case null:
      return null;
    case "run-or-grant-denied":
      return "Choose an active full-access run and review its repository use grant.";
    case "unauthorized":
    case "invalid-credential":
      return "Renew or replace this GitHub connection.";
    case "repository-denied":
      return "Review the repository allowlist and GitHub permissions.";
    case "cli-unavailable":
      return "Install the required executable on this computer.";
    case "unavailable":
      return "Check this computer's network access to GitHub.";
    case "timeout":
      return "The check timed out. Verify connectivity before retrying.";
    case "unsupported":
      return "Use a supported macOS or Linux execution computer.";
    default:
      return "Check repository permissions and tool configuration, then retry.";
  }
};
