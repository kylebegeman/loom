import { UsersIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openVaultTestAccounts } from "./test-accounts-navigation";
export const vaultTestAccountsPaletteSource: ForkCommandPaletteSource = {
  id: "vault-test-accounts",
  items: ({ activeThreadRef, loomFeatures }) =>
    loomFeatures.includes("vault-test-accounts")
      ? [
          {
            kind: "action",
            value: "action:loom:vault-test-accounts:open",
            title: "Vault test accounts",
            description: "Manage development account collections and reservations",
            searchTerms: ["QA", "staging", "collections", "accounts", "reserve"],
            icon: <UsersIcon className="size-4" />,
            run: async () => {
              openVaultTestAccounts(activeThreadRef?.environmentId);
            },
          },
        ]
      : [],
};
