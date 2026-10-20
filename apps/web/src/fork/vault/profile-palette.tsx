import { KeyRoundIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openVaultProfiles } from "./profile-navigation";
export const vaultProfilePaletteSource: ForkCommandPaletteSource = {
  id: "vault-profiles",
  items: ({ activeThreadRef, loomFeatures }) =>
    (["profiles", "references"] as const).flatMap((section) =>
      loomFeatures.includes(`vault-${section}`)
        ? [
            {
              kind: "action" as const,
              value: `action:loom:vault-${section}:manage`,
              title:
                section === "profiles"
                  ? "Manage Vault project profiles"
                  : "Search Vault references",
              description:
                section === "profiles"
                  ? "Bind named SSH and Git requirements for a project"
                  : "Find development records and copy stable references",
              searchTerms: ["vault", "credentials", section, "ssh", "git"],
              icon: <KeyRoundIcon className="size-4" />,
              run: async () => {
                openVaultProfiles({ environmentId: activeThreadRef?.environmentId, section });
              },
            },
          ]
        : [],
    ),
};
