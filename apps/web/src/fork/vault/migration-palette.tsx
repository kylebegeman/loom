import { KeyRoundIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openVaultMigration } from "./migration-navigation";
export const vaultMigrationPaletteSource: ForkCommandPaletteSource = {
  id: "vault-migration",
  items: ({ activeThreadRef, loomFeatures }) => [
    ...(loomFeatures.includes("vault-migration-inventory")
      ? [
          {
            kind: "action" as const,
            value: "action:loom:vault-migration:inventory",
            title: "Vault migration plans",
            description: "Inspect project dependencies and review dedicated replacements",
            searchTerms: ["credentials", "migration", "SSH", "GitHub", "inventory"],
            icon: <KeyRoundIcon className="size-4" />,
            run: async () => {
              openVaultMigration(activeThreadRef?.environmentId, "inventory");
            },
          },
        ]
      : []),
    ...(loomFeatures.includes("vault-migration-imports")
      ? [
          {
            kind: "action" as const,
            value: "action:loom:vault-migration:open",
            title: "Vault development imports",
            description: "Review one dedicated development import before storing it",
            searchTerms: ["credentials", "migration", "imports", "development"],
            icon: <KeyRoundIcon className="size-4" />,
            run: async () => {
              openVaultMigration(activeThreadRef?.environmentId);
            },
          },
        ]
      : []),
  ],
};
