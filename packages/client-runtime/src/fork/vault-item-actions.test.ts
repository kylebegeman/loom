import { expect, it } from "vite-plus/test";
import { vaultItemActions, VAULT_GENERIC_ITEM_KINDS } from "./vault-item-actions.ts";

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
  }
});
