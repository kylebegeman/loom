import { KeyRoundIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openVaultHealth } from "./health-navigation";
export const vaultHealthPaletteSource: ForkCommandPaletteSource = {
  id: "vault-health",
  items: ({ activeThreadRef, loomFeatures }) =>
    loomFeatures.includes("vault-health")
      ? [
          {
            kind: "action",
            value: "action:loom:vault-health:open",
            title: "Vault maintenance inbox",
            description: "Review expiry, authentication failures and enabled health checks",
            searchTerms: ["credentials", "expiry", "health", "authentication", "outage"],
            icon: <KeyRoundIcon className="size-4" />,
            run: async () => {
              openVaultHealth(activeThreadRef?.environmentId);
            },
          },
        ]
      : [],
};
