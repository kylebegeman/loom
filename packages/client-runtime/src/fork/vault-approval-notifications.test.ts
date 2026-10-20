import { expect, it } from "@effect/vitest";
import type { VaultApprovalNotificationOutcome } from "@t3tools/contracts/fork";
import { vaultApprovalNotificationMessage } from "./vault-access.ts";
const observation: VaultApprovalNotificationOutcome = {
  requestId: "a".repeat(32),
  requestRevision: 1,
  storage: "process",
  inApp: "available-in-inbox",
  delivery: "sending",
  attemptedAt: 0,
  expiresAt: 86_400_000,
};
it("derives terminal copy from current request state rather than stale delivery progress", () => {
  for (const state of ["expired", "denied", "cancelled", "approved", "revoked"] as const)
    expect(vaultApprovalNotificationMessage(observation, state)).toBe(
      "This request no longer needs an approval notification.",
    );
});
it("keeps missing, stubbed and unconfirmed delivery distinct", () => {
  expect(vaultApprovalNotificationMessage(undefined, "pending")).toContain(
    "unavailable on this server",
  );
  expect(
    vaultApprovalNotificationMessage({ ...observation, delivery: "stubbed" }, "pending"),
  ).toContain("not connected");
  expect(
    vaultApprovalNotificationMessage({ ...observation, delivery: "unconfirmed" }, "pending"),
  ).toContain("do not assume an alert arrived");
});
it("does not equate an adapter receipt with human review or approval", () => {
  expect(
    vaultApprovalNotificationMessage({ ...observation, delivery: "delivered" }, "pending"),
  ).toContain("does not mean the request was reviewed or approved");
});
