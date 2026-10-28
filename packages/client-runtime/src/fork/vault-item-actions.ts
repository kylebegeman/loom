import type { VaultItemKind } from "@t3tools/contracts/fork";

export const VAULT_REVEAL_DURATION_MS = 60_000;
export const VAULT_GENERIC_ITEM_KINDS = [
  "secret",
  "account",
  "secure-note",
  "secure-file",
] as const;

export const vaultItemActions = (kind: VaultItemKind) => {
  const manager = kind === "ssh-key" ? "ssh" : kind === "service-connection" ? "github" : null;
  return { manager, replaceValue: manager === null, revealValue: manager === null };
};
