import { KeyRoundIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openVaultAccess } from "./access-navigation";
export const vaultAccessPaletteSource: ForkCommandPaletteSource = {
  id: "vault-grants",
  items: ({ activeThreadRef, loomFeatures }) =>
    activeThreadRef && loomFeatures.includes("vault-grants")
      ? [
          {
            kind: "action",
            value: "action:loom:vault-access:open",
            title: "Vault grants and readiness",
            description: "Inspect this thread's access and manage development grants",
            searchTerms: [
              "credentials",
              "secrets",
              "access",
              "grant",
              "readiness",
              "headless",
              "permissions",
            ],
            icon: <KeyRoundIcon className="size-4" />,
            run: async () => {
              openVaultAccess({
                environmentId: activeThreadRef.environmentId,
                threadId: activeThreadRef.threadId,
              });
            },
          },
        ]
      : [],
};
