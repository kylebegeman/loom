import { expect, it } from "@effect/vitest";
import type { VaultTestAccount } from "@t3tools/contracts/fork";
import { vaultTestAccountActions, vaultTestAccountState } from "./vault-test-accounts.ts";
const account: VaultTestAccount = {
  id: "a".repeat(32),
  collectionId: "b".repeat(32),
  itemId: "c".repeat(32),
  itemVersion: 1,
  label: "Editor",
  role: "editor",
  state: "reserved",
  lease: { id: "d".repeat(32), owner: "client:one", createdAt: 0, expiresAt: 300_000 },
};
it("withdraws renew/release after expiry and never silently returns a dirty account to availability", () => {
  expect(vaultTestAccountState(account, 299_999)).toBe("reserved");
  expect(
    vaultTestAccountActions(account, "client:one", false, 299_999).map((a) => a.change.type),
  ).toEqual(["renew", "release", "quarantine", "retire"]);
  expect(vaultTestAccountState(account, 300_000)).toBe("quarantined");
  expect(
    vaultTestAccountActions(account, "client:one", false, 300_000).map((a) => a.change.type),
  ).toEqual(["mark-clean", "retire"]);
});
it("keeps lease ownership, archive and retire restrictions visible while providing reverse actions", () => {
  expect(
    vaultTestAccountActions(account, "client:other", false, 100).map((a) => a.change.type),
  ).toEqual(["quarantine", "retire"]);
  const retired = { ...account, state: "retired" as const, lease: null };
  expect(
    vaultTestAccountActions(retired, "client:one", false, 0).map((a) => a.change.type),
  ).toEqual(["restore"]);
  const dirty = { ...account, state: "quarantined" as const, lease: null };
  expect(vaultTestAccountActions(dirty, "client:one", true, 0).map((a) => a.change.type)).toEqual([
    "retire",
  ]);
  const available = { ...account, state: "available" as const, lease: null };
  expect(
    vaultTestAccountActions(available, "client:one", false, 0).map((a) => a.change.type),
  ).toContain("reserve");
  expect(
    vaultTestAccountActions(available, "client:one", true, 0).map((a) => a.change.type),
  ).not.toContain("reserve");
});
