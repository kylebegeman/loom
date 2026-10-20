import {
  VAULT_ACCESS_WS_METHODS as V,
  type VaultAccessAction,
  type VaultReadinessReport,
  type VaultGrant,
} from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export function createVaultAccessAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    approvalInbox: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:approvals",
      tag: V.approvalInbox,
    }),
    approvalCreate: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:approval-request",
      tag: V.approvalCreate,
    }),
    approvalChange: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:approval-decide",
      tag: V.approvalChange,
    }),
    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:grants",
      tag: V.snapshot,
    }),
    catalog: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:subjects",
      tag: V.catalog,
    }),
    apply: createEnvironmentRpcCommand(runtime, { label: "loom:vault:grant-apply", tag: V.apply }),
    preview: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:grant-preview",
      tag: V.preview,
    }),
    explain: createEnvironmentRpcCommand(runtime, { label: "loom:vault:explain", tag: V.explain }),
    readiness: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:readiness",
      tag: V.readiness,
    }),
  };
}
export const VAULT_ACTION_LABELS: Record<VaultAccessAction, string> = {
  inspect: "Inspect metadata",
  manage: "Manage item",
  use: "Use credential",
  reveal: "Reveal value",
  export: "Export value",
  delegate: "Delegate access",
};
export const vaultGrantExpiry = (grant: VaultGrant, now: number) =>
  grant.definition.expiresAt !== null && now >= grant.definition.expiresAt
    ? "Expired"
    : now < grant.definition.notBefore
      ? "Not yet valid"
      : grant.state === "active"
        ? "Active"
        : grant.state === "suspended"
          ? "Suspended"
          : "Revoked";
export const vaultReadinessIsStale = (report: VaultReadinessReport, now: number) =>
  now >= report.freshUntil;

const decisionMessages: Readonly<Record<string, string>> = {
  allowed: "An active grant permits this action.",
  "no-grant": "No grant matches this thread, item and action.",
  scope: "The grant does not cover this project or exact destination.",
  "not-active": "This grant or an inherited grant is suspended or revoked.",
  "not-yet-valid": "The access window has not started.",
  expired: "The access window has expired.",
  "invalid-lineage": "The inherited grant is missing, cyclic or broader than its parent.",
  "item-unavailable": "This item is missing, archived or deleted.",
  "caller-permission":
    "The runner mode does not permit this action. A Vault grant cannot increase T3 permissions.",
  "workload-inactive": "The authenticated thread no longer has an active run.",
};
export const vaultDecisionMessage = (reason: string) => decisionMessages[reason] ?? reason;
