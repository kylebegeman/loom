import { expect, it } from "vite-plus/test";
import type { VaultItemSummary } from "@t3tools/contracts/fork";
import { secretRequestAcceptsItem, secretSaveTarget } from "./vault-secret.ts";

const item: VaultItemSummary = {
  id: "a".repeat(32),
  label: "API key",
  kind: "secret",
  state: "active",
  version: 4,
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
};
it("replaces a name match at its existing version or explicitly saves as new", () => {
  expect(secretSaveTarget([item], " api KEY ", false)).toEqual(item);
  expect(secretSaveTarget([item], "api KEY", true)).toBeNull();
  expect(secretSaveTarget([{ ...item, state: "archived" }], item.label, false)).toBeNull();
  expect(secretSaveTarget([{ ...item, kind: "ssh-key" }], item.label, false)).toBeNull();
  expect(secretSaveTarget([item], "another key", false)).toBeNull();
});
it("allows a saved file only when delivery is a file and rejects managed connections", () => {
  expect(secretRequestAcceptsItem({ ...item, kind: "secure-file" }, false)).toBe(false);
  expect(secretRequestAcceptsItem({ ...item, kind: "secure-file" }, true)).toBe(true);
  expect(secretRequestAcceptsItem({ ...item, kind: "service-connection" }, true)).toBe(false);
});
