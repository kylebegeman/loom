import { VAULT_HEALTH_WS_METHODS as V, type VaultHealthIssue } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export function createVaultHealthAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    context: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:health-context",
      tag: V.context,
    }),
    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:health",
      tag: V.snapshot,
    }),
    apply: createEnvironmentRpcCommand(runtime, { label: "loom:vault:health-apply", tag: V.apply }),
    recheck: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:health-recheck",
      tag: V.recheck,
    }),
  };
}
export const vaultHealthMessage = (issue: VaultHealthIssue) =>
  ({
    expiry:
      "Declared expiry is approaching or has passed. Renew or replace this development identity.",
    authentication:
      "Authentication failed. Check the dedicated identity and its provider permissions.",
    outage:
      "The provider was unreachable or timed out. Check connectivity before changing credentials.",
    configuration:
      "An operation failed or configuration needs review. Inspect command results and connection settings before retrying.",
  })[issue.category];
export const vaultHealthVisibleState = (issue: VaultHealthIssue, now: number) =>
  issue.state === "snoozed" && issue.snoozedUntil !== null && issue.snoozedUntil <= now
    ? "open"
    : issue.state;

export const vaultHealthRecheckMessage = (outcome: "checked" | "rate-limited" | "unconfigured") =>
  ({
    checked: "Check finished. Review the current issues for its result.",
    "rate-limited": "This item was checked recently. Wait before checking again.",
    unconfigured: "Configure an expiry or validation rule for this item before rechecking.",
  })[outcome];
