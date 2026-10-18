import { KeyRoundIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openVaultSsh } from "./ssh-navigation";
export const vaultSshPaletteSource: ForkCommandPaletteSource = {
  id: "vault-ssh-management",
  items: ({ activeThreadRef, loomFeatures }) =>
    loomFeatures.includes("vault-ssh-management")
      ? [
          {
            kind: "action",
            value: "action:loom:vault-ssh:manage",
            title: "Manage Vault SSH keys",
            description: "Create keys, review host trust and test a development SSH connection",
            searchTerms: [
              "ssh",
              "vault",
              "keys",
              "credentials",
              "host trust",
              "fingerprint",
              "connection",
            ],
            icon: <KeyRoundIcon className="size-4" />,
            run: async () => {
              openVaultSsh(activeThreadRef?.environmentId);
            },
          },
        ]
      : [],
};
