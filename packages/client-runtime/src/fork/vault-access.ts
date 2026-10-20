import {
  VAULT_ACCESS_WS_METHODS as V,
  VAULT_APPROVAL_RETENTION_MS,
  type VaultApprovalNotificationOutcome,
  type VaultApprovalRequest,
  type VaultApprovalReviewContext,
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

export const vaultApprovalNotificationMessage = (
  outcome: VaultApprovalNotificationOutcome | undefined,
  state: VaultApprovalRequest["state"],
) => {
  if (state !== "pending") return "This request no longer needs an approval notification.";
  if (!outcome) return "Notification outcomes are unavailable on this server.";
  switch (outcome.delivery) {
    case "not-delivered":
      return "No notification delivery is recorded in this server session. Review requests here.";
    case "stubbed":
      return "Available in this inbox. External notification delivery is not connected.";
    case "sending":
      return "A notification attempt is in progress. You can still decide here.";
    case "unconfirmed":
      return "Notification delivery is unconfirmed. Review this inbox; do not assume an alert arrived.";
    case "delivered":
      return "The notification adapter reported delivery. This does not mean the request was reviewed or approved.";
    case "not-required":
      return "This request no longer needs an approval notification.";
  }
};

export const vaultApprovalState = (request: VaultApprovalRequest, now: number) =>
  (request.state === "pending" && now >= request.requestExpiresAt) ||
  (request.state === "approved" && request.approvedUntil !== null && now >= request.approvedUntil)
    ? ("expired" as const)
    : request.state;

export const vaultApprovalReviewQueue = (
  requests: ReadonlyArray<VaultApprovalRequest>,
  now: number,
  filter: "pending" | "all",
) => {
  const retained = requests.filter(
    (request) => now < request.requestedAt + VAULT_APPROVAL_RETENTION_MS,
  );
  const pendingCount = retained.filter(
    (request) => vaultApprovalState(request, now) === "pending",
  ).length;
  return {
    pendingCount,
    totalCount: retained.length,
    requests: retained
      .filter((request) => filter === "all" || vaultApprovalState(request, now) === "pending")
      .sort(
        (a, b) =>
          Number(vaultApprovalState(b, now) === "pending") -
            Number(vaultApprovalState(a, now) === "pending") ||
          b.requestedAt - a.requestedAt ||
          a.id.localeCompare(b.id),
      ),
  };
};

export const vaultApprovalReviewLabels = (
  request: VaultApprovalRequest,
  context: VaultApprovalReviewContext | undefined,
) => {
  const own = context?.requestId === request.id ? context : undefined;
  const item = own?.itemLabel || `Record ${request.itemId}`;
  const thread = own?.threadTitle || `Thread ${request.threadId}`;
  const project = own?.projectTitle || `Project ${request.projectId}`;
  return {
    item,
    thread,
    project,
    accessibleContext: `${item}, ${thread}, ${project}, request ${request.id}`,
    warning:
      own?.state === "changed"
        ? "Context has changed. Deny or cancel this request and ask for a fresh one."
        : own?.state === "unavailable"
          ? "Some request context is unavailable. Refresh before approving."
          : null,
    approvalBlocked: own?.state === "changed" || own?.state === "unavailable",
  };
};
