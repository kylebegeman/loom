import { openVaultAdd } from "./add-navigation";
import { KeyRoundIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openVaultSsh } from "./ssh-navigation";
import { openVaultAccess } from "./access-navigation";
export const vaultAccessPaletteSource: ForkCommandPaletteSource = {
  id: "vault-grants",
  items: ({ activeThreadRef, loomFeatures }) => [
    ...(loomFeatures.includes("vault-core")
      ? [
          {
            kind: "action" as const,
            value: "action:loom:vault:add",
            title: "Add to Vault...",
            description: "Save a secret, note or file in this computer's Vault",
            searchTerms: ["vault", "save", "file", "key", "secret", "add"],
            icon: <KeyRoundIcon className="size-4" />,
            run: async () =>
              openVaultAdd(activeThreadRef ? { environmentId: activeThreadRef.environmentId } : {}),
          },
        ]
      : []),
    ...(loomFeatures.includes("vault-owner-trusted")
      ? [
          {
            kind: "action" as const,
            value: "action:loom:vault-owner-access:open",
            title: "Vault owner access",
            description: "Manage personal environment access and repair development connections",
            searchTerms: ["vault", "owner", "personal", "credentials", "ssh", "github", "setup"],
            icon: <KeyRoundIcon className="size-4" />,
            run: async () => openVaultSsh(activeThreadRef?.environmentId),
          },
        ]
      : []),
    ...(activeThreadRef && loomFeatures.includes("vault-grants")
      ? [
          {
            kind: "action" as const,
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
      : []),
  ],
};
