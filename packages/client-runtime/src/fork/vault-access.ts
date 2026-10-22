import {
  VAULT_ACCESS_WS_METHODS as V,
  VAULT_APPROVAL_RETENTION_MS,
  type VaultApprovalNotificationOutcome,
  type VaultApprovalRequest,
  type VaultApprovalReviewContext,
  type VaultAccessAction,
  type VaultAccessContext,
  type VaultReadinessReport,
  type VaultGrant,
  type VaultOwnerPolicy,
} from "@t3tools/contracts/fork";
import { Atom } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
const vaultPolicyChanges = Atom.family((_environmentId: EnvironmentId) => Atom.make(0));

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
      refreshTrigger: ({ environmentId }) => vaultPolicyChanges(environmentId),
    }),
    setOwnerPolicy: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:owner-policy-set",
      tag: V.setOwnerPolicy,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => {
          const signal = vaultPolicyChanges(environmentId);
          registry.set(signal, registry.get(signal) + 1);
        }),
    }),
    catalog: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:subjects",
      tag: V.catalog,
    }),
    apply: createEnvironmentRpcCommand(runtime, { label: "loom:vault:grant-apply", tag: V.apply }),
    applyBatch: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:grant-apply-batch",
      tag: V.applyBatch,
    }),
    previewBatch: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:grant-preview-batch",
      tag: V.previewBatch,
    }),
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
export const vaultOwnerAccessSummary = (
  policy: Pick<VaultOwnerPolicy, "mode" | "ownerId"> | null | undefined,
) => {
  const enabled = policy?.mode === "owner-trusted" && !!policy.ownerId;
  return {
    enabled,
    title: enabled ? "Owner access enabled" : "Restricted access",
    description: enabled
      ? "Agents in this personal environment can inspect and use connected Vault access. Saved project grants are kept for restricted mode."
      : policy
        ? "Agents need saved project access. Enable owner access only for a personal environment you control."
        : "This server has not reported owner access. Existing project grants still apply.",
    actionLabel: enabled ? "Use restricted access" : "Enable owner access",
  };
};

export const VAULT_OWNER_SETUP_HELP = [
  {
    id: "ssh-enrollment",
    title: "SSH public key enrollment",
    description:
      "Open the SSH key, copy its public key, and add it to the destination account's authorized_keys. Then test the connection in Loom.",
  },
  {
    id: "ssh-host-trust",
    title: "SSH host trust",
    description:
      "Verify the destination's Ed25519 host key through a trusted channel, then save it in the SSH key's Host trust settings.",
  },
  {
    id: "broker",
    title: "Execution broker",
    description:
      "Enroll the computer running this Loom server in Vault brokers, keep its broker running, and configure the server to use its private broker directory. Reconnect the agent after setup.",
  },
  {
    id: "github-upstream",
    title: "GitHub permissions",
    description:
      "Connect a dedicated GitHub token or App with access to the repositories you need. If GitHub rejects it, renew the credential or approve its organization access, then test the connection again.",
  },
] as const;

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
  allowed: "Vault policy permits this action.",
  "owner-trusted":
    "Owner access permits agents in this personal environment to inspect and use connected Vault access.",
  "no-grant": "No grant matches this thread, item and action.",
  scope: "The grant does not cover this project or exact destination.",
  "not-active": "This grant or an inherited grant is suspended or revoked.",
  "not-yet-valid": "The access window has not started.",
  expired: "The access window has expired.",
  "invalid-lineage": "The inherited grant is missing, cyclic or broader than its parent.",
  "item-unavailable": "This item is missing, archived or deleted.",
  "caller-permission":
    "The runner mode does not permit this action. A Vault grant cannot increase T3 permissions.",
  "classification-required": "This credential needs an explicit access classification before use.",
  "approval-required":
    "This credential requires an exact one-time approval. Protected execution is disabled.",
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

export const vaultAccessContextRows = (context: VaultAccessContext, now: number) => {
  if (context.state === "changed" || now >= context.freshUntil)
    return [
      { id: "expired", text: "Related context changed or expired. Run the access check again." },
    ];
  if (context.state === "unavailable")
    return [
      {
        id: "unavailable",
        text: "Related context is unavailable. The policy decision above is a separate observation.",
      },
    ];
  return [
    ...(context.state === "partial"
      ? [
          {
            id: "partial",
            text: "Some related context is unavailable. Empty lists do not prove there are no consumers.",
          },
        ]
      : []),
    {
      id: "provider",
      text: `Provider ${context.providerInstanceId ?? "unavailable"} · Run ${context.runId ?? "none"}.`,
    },
    ...(context.profiles.length
      ? context.profiles.map((p) => ({
          id: `profile:${p.id}`,
          text: `Profile ${p.label} (${p.id}) · ${p.state}${p.selected ? " · selected default" : ""} · Requirements ${p.requirements.join(", ")}.`,
        }))
      : [
          {
            id: "no-profiles",
            text: "No matching profile bindings in this project were observed.",
          },
        ]),
    ...(context.omittedProfiles
      ? [
          {
            id: "omitted-profiles",
            text: `${context.omittedProfiles} additional matching profiles omitted.`,
          },
        ]
      : []),
    ...(context.sessions.length
      ? context.sessions.map((s) => ({
          id: `workload:${s.id}`,
          text: `Workload ${s.id} · ${s.machineLabel ?? s.machineId} · broker ${s.brokerState} when checked · ${s.destination}.`,
        }))
      : [{ id: "no-workloads", text: "No current matching workload sessions were observed." }]),
    ...(context.omittedSessions
      ? [
          {
            id: "omitted-sessions",
            text: `${context.omittedSessions} additional matching workload sessions omitted.`,
          },
        ]
      : []),
    ...(context.approvals.length
      ? context.approvals.map((r) => ({
          id: `request:${r.id}`,
          text: `Request ${r.id} · ${r.state}.`,
        }))
      : [
          {
            id: "no-requests",
            text: "No retained matching requests for this thread were observed.",
          },
        ]),
    ...(context.omittedApprovals
      ? [
          {
            id: "omitted-requests",
            text: `${context.omittedApprovals} additional matching requests omitted.`,
          },
        ]
      : []),
    {
      id: "limits",
      text: "External consumers are not discovered. Copies held by providers are unknown. This context does not authorize an operation.",
    },
  ];
};
