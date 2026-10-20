import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import {
  VaultApprovalChange,
  VaultApprovalRequest,
  VaultApprovalCancel,
  VaultApprovalRequesterStatus,
} from "./vault-access.ts";
const change = Schema.decodeUnknownOption(VaultApprovalChange),
  request = Schema.decodeUnknownOption(VaultApprovalRequest);
it("requires bounded temporary durations and exact revisioned decisions", () => {
  const input = {
    id: "a".repeat(32),
    operationId: "b".repeat(32),
    expectedRevision: 1,
    expectedPolicyRevision: 0,
    decision: "approve",
    durationMs: 300000,
  };
  expect(Option.isSome(change(input))).toBe(true);
  for (const patch of [
    { durationMs: null },
    { durationMs: 0 },
    { durationMs: 3600000 },
    { expectedRevision: 0 },
    { expectedPolicyRevision: -1 },
    { decision: "allow-forever" },
  ])
    expect(Option.isNone(change({ ...input, ...patch }))).toBe(true);
});
it("cannot represent an approval with an unbounded window or a substituted grant", () => {
  const input = {
    id: "a".repeat(32),
    threadId: "thread",
    itemId: "c".repeat(32),
    action: "use",
    destination: null,
    projectId: "project",
    itemVersion: 1,
    policyRevision: 0,
    revision: 2,
    requestedBy: "requester",
    requestedAt: 0,
    requestExpiresAt: 600000,
    state: "approved",
    decidedBy: "approver",
    approvedUntil: 300000,
    grantId: "a".repeat(32),
  };
  expect(Option.isSome(request(input))).toBe(true);
  for (const patch of [
    { approvedUntil: null },
    { grantId: null },
    { grantId: "b".repeat(32) },
    { approvedUntil: 0 },
    { requestExpiresAt: 0 },
    { decidedBy: null },
  ])
    expect(Option.isNone(request({ ...input, ...patch }))).toBe(true);
});

it("keeps requester status observational and cancellation narrower than a decision", () => {
  const cancelled = Schema.decodeUnknownOption(VaultApprovalCancel);
  expect(
    Option.isSome(
      cancelled({ id: "a".repeat(32), operationId: "b".repeat(32), expectedRevision: 1 }),
    ),
  ).toBe(true);
  expect(
    Option.isNone(
      cancelled({ id: "a".repeat(32), operationId: "b".repeat(32), expectedRevision: 0 }),
    ),
  ).toBe(true);
  const requestValue = {
    id: "a".repeat(32),
    threadId: "thread",
    itemId: "c".repeat(32),
    action: "use",
    destination: null,
    projectId: "project",
    itemVersion: 1,
    policyRevision: 0,
    revision: 1,
    requestedBy: "thread:thread",
    requestedAt: 0,
    requestExpiresAt: 600000,
    state: "pending",
    decidedBy: null,
    approvedUntil: null,
    grantId: null,
    waitingOperation: { operationId: "a".repeat(32), runId: "run" },
  };
  const status = Schema.decodeUnknownOption(VaultApprovalRequesterStatus);
  const value = {
    request: requestValue,
    checkedAt: 0,
    operationState: "waiting",
    automaticResumption: false,
    allowOnceConsumption: false,
    canExecute: false,
  };
  expect(Option.isSome(status(value))).toBe(true);
  for (const key of ["automaticResumption", "allowOnceConsumption", "canExecute"])
    expect(Option.isNone(status({ ...value, [key]: true }))).toBe(true);
  expect(
    Option.isNone(
      request({ ...requestValue, waitingOperation: { operationId: "b".repeat(32), runId: "run" } }),
    ),
  ).toBe(true);
});
