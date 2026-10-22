import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  VaultGrantBatchMutation,
  VaultOwnerPolicy,
  VaultOwnerPolicyChange,
  VaultPolicySnapshot,
} from "./vault-access.ts";

const input = {
  operationId: "a".repeat(32),
  expectedRevision: 0,
  changes: [{ type: "state", id: "b".repeat(32), state: "revoked" }],
};
it("bounds atomic grant batches and rejects duplicate grant IDs across change types", () => {
  const valid = Schema.is(VaultGrantBatchMutation);
  expect(valid(input)).toBe(true);
  expect(valid({ ...input, changes: [] })).toBe(false);
  expect(valid({ ...input, changes: [input.changes[0], input.changes[0]] })).toBe(false);
  expect(
    valid({
      ...input,
      changes: Array.from({ length: 128 }, (_, index) => ({
        ...input.changes[0],
        id: index.toString(16).padStart(32, "0"),
      })),
    }),
  ).toBe(true);
  expect(
    valid({
      ...input,
      changes: Array.from({ length: 129 }, (_, index) => ({
        ...input.changes[0],
        id: index.toString(16).padStart(32, "0"),
      })),
    }),
  ).toBe(false);
  expect(valid({ ...input, expectedRevision: -1 })).toBe(false);
  expect(
    valid({
      ...input,
      changes: [input.changes[0], { type: "state", id: "c".repeat(32), state: "unsupported" }],
    }),
  ).toBe(false);
  const grant = {
    id: "b".repeat(32),
    label: "Grant",
    principal: { kind: "project", id: "project" },
    itemIds: ["d".repeat(32)],
    actions: ["use"],
    projectId: "project",
    destination: null,
    notBefore: 0,
    expiresAt: null,
    parentId: null,
  };
  expect(valid({ ...input, changes: [{ type: "save", grant }] })).toBe(true);
  expect(valid({ ...input, changes: [input.changes[0], { type: "save", grant }] })).toBe(false);
});

const isOwnerPolicy = Schema.is(VaultOwnerPolicy);
const decodeOwnerChange = Schema.decodeUnknownSync(VaultOwnerPolicyChange, {
  onExcessProperty: "error",
});
const isSnapshot = Schema.is(VaultPolicySnapshot);
it("owner policy distinguishes unconfigured legacy snapshots from an explicitly bound environment", () => {
  const legacy = {
    environmentId: "environment",
    revision: 0,
    grants: [],
    audit: [],
    omittedAuditEvents: 0,
  };
  expect(isSnapshot(legacy)).toBe(true);
  const restricted = {
    environmentId: "environment",
    mode: "restricted",
    ownerId: null,
    revision: 0,
    updatedAt: null,
    updatedBy: null,
  };
  expect(isOwnerPolicy(restricted)).toBe(true);
  expect(isOwnerPolicy({ ...restricted, mode: "owner-trusted" })).toBe(false);
  const trusted = {
    ...restricted,
    mode: "owner-trusted",
    ownerId: "a".repeat(32),
    revision: 1,
    updatedAt: 10,
    updatedBy: "owner",
  };
  expect(isOwnerPolicy(trusted)).toBe(true);
  expect(isOwnerPolicy({ ...trusted, mode: "restricted" })).toBe(true);
  expect(isOwnerPolicy({ ...trusted, ownerId: "unvalidated" })).toBe(false);
  expect(isOwnerPolicy({ ...trusted, updatedAt: null })).toBe(false);
  expect(isOwnerPolicy({ ...trusted, revision: 0 })).toBe(false);
});
it("owner mutation accepts only the mode and CAS/idempotency fields, never caller-provided identity or extra privileges", () => {
  const input = { operationId: "a".repeat(32), expectedRevision: 0, mode: "owner-trusted" };
  expect(decodeOwnerChange(input)).toEqual(input);
  for (const extra of [
    { actor: "owner" },
    { ownerId: "a".repeat(32) },
    { environmentId: "other" },
    { actions: ["reveal"] },
  ])
    expect(() => decodeOwnerChange({ ...input, ...extra })).toThrow();
  expect(() => decodeOwnerChange({ ...input, expectedRevision: -1 })).toThrow();
  expect(() => decodeOwnerChange({ ...input, mode: "all-access" })).toThrow();
});
