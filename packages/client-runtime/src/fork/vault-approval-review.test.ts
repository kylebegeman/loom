import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import type {
  VaultApprovalRequest,
  VaultApprovalCardData,
  VaultApprovalInbox,
} from "@t3tools/contracts/fork";
import {
  vaultApprovalState,
  reviewVaultApprovalCard,
  vaultApprovalReviewQueue,
  vaultApprovalReviewLabels,
} from "./vault-access.ts";
const base: VaultApprovalRequest = {
  id: "a".repeat(32),
  threadId: ThreadId.make("review-thread"),
  itemId: "b".repeat(32),
  action: "use",
  destination: null,
  projectId: "review-project",
  itemVersion: 1,
  policyRevision: 0,
  revision: 1,
  requestedBy: "thread:review-thread",
  requestedAt: 0,
  requestExpiresAt: 600_000,
  state: "pending",
  decidedBy: null,
  approvedUntil: null,
  grantId: null,
};
const card: VaultApprovalCardData = {
  type: "vault_access_request",
  requestId: base.id,
  revision: base.revision,
  itemLabel: "Development key",
  itemKind: "secret",
  action: base.action,
  destination: base.destination,
  state: base.state,
  requestExpiresAt: base.requestExpiresAt,
  approvedUntil: base.approvedUntil,
};
const context = {
  requestId: base.id,
  itemLabel: card.itemLabel,
  threadTitle: "Thread",
  projectTitle: "Project",
  state: "current" as const,
};
const inbox: VaultApprovalInbox = {
  policyRevision: 8,
  requests: [base],
  notifications: "stubbed",
  reviewContext: [context],
};
const choice = {
  operationId: "c".repeat(32),
  decision: "approve" as const,
  durationMs: 300000 as const,
};
it("keeps pending work first in all requests and leaves source order untouched", () => {
  const terminal = { ...base, id: "c".repeat(32), state: "denied" as const, requestedAt: 200 };
  const pending = { ...base, id: "d".repeat(32), requestedAt: 100 };
  const source = [terminal, base, pending];
  expect(vaultApprovalReviewQueue(source, 300, "all")).toMatchObject({
    pendingCount: 2,
    totalCount: 3,
    requests: [pending, base, terminal],
  });
  expect(source).toEqual([terminal, base, pending]);
  expect(vaultApprovalReviewQueue(source, 300, "pending").requests).toEqual([pending, base]);
});
it("removes expired pending work at the exact deadline while preserving decision review", () => {
  const future = { ...base, id: "c".repeat(32), requestExpiresAt: 900_000 };
  expect(vaultApprovalReviewQueue([base, future], 600_000, "pending")).toMatchObject({
    pendingCount: 1,
    totalCount: 2,
    requests: [future],
  });
  expect(vaultApprovalState(base, 600_000)).toBe("expired");
  const approved = {
    ...base,
    state: "approved" as const,
    approvedUntil: 300_000,
    grantId: base.id,
  };
  expect(vaultApprovalState(approved, 300_000)).toBe("expired");
  expect(vaultApprovalReviewQueue([approved], 300_000, "all").requests).toEqual([approved]);
});
it("hides cached entries at the retention boundary and handles an empty queue", () => {
  expect(vaultApprovalReviewQueue([base], 86_400_000, "all")).toEqual({
    pendingCount: 0,
    totalCount: 0,
    requests: [],
  });
  expect(vaultApprovalReviewQueue([], 0, "pending")).toEqual({
    pendingCount: 0,
    totalCount: 0,
    requests: [],
  });
});

it("uses readable labels while retaining safe ID fallback for old or unavailable context", () => {
  const labels = vaultApprovalReviewLabels(base, {
    requestId: base.id,
    itemLabel: "Development key",
    threadTitle: "Fix the build",
    projectTitle: "Loom",
    state: "current",
  });
  expect(labels).toMatchObject({
    item: "Development key",
    thread: "Fix the build",
    project: "Loom",
    approvalBlocked: false,
  });
  expect(labels.accessibleContext).toContain(base.id);
  const legacy = vaultApprovalReviewLabels(base, undefined);
  expect(legacy.item).toContain(base.itemId);
  expect(legacy.approvalBlocked).toBe(false);
  const mismatched = vaultApprovalReviewLabels(base, {
    requestId: "f".repeat(32),
    itemLabel: "Other key",
    threadTitle: "Other",
    projectTitle: "Other",
    state: "changed",
  });
  expect(mismatched.item).toContain(base.itemId);
  expect(mismatched.approvalBlocked).toBe(false);
});
it("requires refreshed review for changed or unavailable context without adding decision authority", () => {
  for (const state of ["changed", "unavailable"] as const) {
    const labels = vaultApprovalReviewLabels(base, {
      requestId: base.id,
      itemLabel: null,
      threadTitle: null,
      projectTitle: null,
      state,
    });
    expect(labels.approvalBlocked).toBe(true);
    expect(labels.warning).not.toBeNull();
    expect(labels.accessibleContext).toContain(base.threadId);
  }
});

it("prepares card decisions with the displayed request revision and fresh policy revision", () => {
  const reviewed = reviewVaultApprovalCard(card, inbox, {
    operationId: "c".repeat(32),
    decision: "approve",
    durationMs: 900000,
  });
  expect(reviewed).toMatchObject({
    input: {
      id: base.id,
      operationId: "c".repeat(32),
      expectedRevision: 1,
      expectedPolicyRevision: 8,
      decision: "approve",
      durationMs: 900000,
    },
  });
});
it("refreshes a changed card before any decision and never approves unavailable context", () => {
  const changed = reviewVaultApprovalCard(
    card,
    { ...inbox, requests: [{ ...base, revision: 2, state: "denied" }] },
    choice,
  );
  expect(changed.input).toBeNull();
  expect(changed.card).toMatchObject({ revision: 2, state: "denied" });
  const unavailable = reviewVaultApprovalCard(
    card,
    { ...inbox, reviewContext: [{ ...context, state: "unavailable" }] },
    choice,
  );
  expect(unavailable.input).toBeNull();
  expect(unavailable.message).toContain("context");
  const missing = reviewVaultApprovalCard(card, { ...inbox, requests: [] }, choice);
  expect(missing.card).toBeNull();
  expect(missing.input).toBeNull();
});
it("keeps deny and cancel available when context cannot be verified, and scopes revoke to a grant", () => {
  for (const decision of ["deny", "cancel"] as const) {
    expect(
      reviewVaultApprovalCard(card, { ...inbox, reviewContext: [] }, { ...choice, decision }).input
        ?.decision,
    ).toBe(decision);
  }
  expect(reviewVaultApprovalCard(card, inbox, { ...choice, decision: "revoke" }).input).toBeNull();
  const approved = {
    ...base,
    state: "approved" as const,
    approvedUntil: 900000,
    grantId: base.id,
    revision: 2,
  };
  expect(
    reviewVaultApprovalCard(
      { ...card, state: "approved", approvedUntil: 900000, revision: 2 },
      { ...inbox, requests: [approved] },
      { ...choice, decision: "revoke" },
    ).input?.decision,
  ).toBe("revoke");
});
it("refreshes a renamed item before approving the new label", () => {
  const reviewed = reviewVaultApprovalCard(
    card,
    { ...inbox, reviewContext: [{ ...context, itemLabel: "New credential" }] },
    choice,
  );
  expect(reviewed.input).toBeNull();
  expect(reviewed.card?.itemLabel).toBe("New credential");
});
