import { expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { VaultItemSummary } from "@t3tools/contracts/fork";
import {
  vaultAddPrefill,
  vaultPickerSelection,
  vaultItemActions,
  VAULT_GENERIC_ITEM_KINDS,
} from "./vault-item-actions.ts";

it("keeps managed credentials out of generic editing and revealing", () => {
  expect(vaultItemActions("ssh-key")).toEqual({
    manager: "ssh",
    replaceValue: false,
    revealValue: false,
  });
  expect(vaultItemActions("service-connection")).toEqual({
    manager: "github",
    replaceValue: false,
    revealValue: false,
  });
  for (const kind of VAULT_GENERIC_ITEM_KINDS) {
    expect(vaultItemActions(kind)).toEqual({
      manager: null,
      replaceValue: true,
      revealValue: true,
    });
    expect(vaultAddPrefill("  Test credential  ", kind)).toEqual({
      label: "Test credential",
      kind,
      manager: null,
    });
  }
  expect(vaultAddPrefill("  key  ", "ssh-key").manager).toBe("ssh");
  expect(vaultAddPrefill("GitHub", "service-connection").manager).toBe("github");
  expect(vaultAddPrefill("name", null).kind).toBe("secret");
  expect(vaultAddPrefill("x".repeat(201)).label).toHaveLength(200);
});

it("selects newly saved active items only when they match the picker's kind", () => {
  const environmentId = EnvironmentId.make("synthetic-computer");
  const item: VaultItemSummary = {
    id: "a".repeat(32),
    label: "Test account",
    kind: "account",
    state: "active",
    version: 1,
    createdAt: "2026-10-28T00:00:00Z",
    updatedAt: "2026-10-28T00:00:00Z",
  };
  expect(vaultPickerSelection(environmentId, item, "account")).toEqual({
    environmentId,
    item,
    reference: `loom-vault:synthetic-computer:${item.id}`,
  });
  expect(vaultPickerSelection(environmentId, item, "secret")).toBeNull();
  expect(vaultPickerSelection(environmentId, { ...item, state: "archived" })).toBeNull();
  expect(vaultPickerSelection(environmentId, { ...item, state: "deleted" })).toBeNull();
});
