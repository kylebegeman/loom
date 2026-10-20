import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import type { VaultApprovalRequest } from "@t3tools/contracts/fork";
import { vaultApprovalState, vaultApprovalReviewQueue } from "./vault-access.ts";
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
