import { KeyRoundIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openVaultPasswordGenerator } from "./password-navigation";

export const vaultPasswordPaletteSource: ForkCommandPaletteSource = {
  id: "vault-passwords",
  items: () => [
    {
      kind: "action",
      value: "action:loom:vault-passwords:generate",
      title: "Generate a Vault password",
      description: "Create a password locally without saving or sending it",
      searchTerms: ["password", "vault", "generate", "random", "offline", "secret"],
      icon: <KeyRoundIcon className="size-4" />,
      run: async () => openVaultPasswordGenerator(),
    },
  ],
};
