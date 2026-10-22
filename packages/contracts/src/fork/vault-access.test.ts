import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { VaultGrantBatchMutation } from "./vault-access.ts";

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
