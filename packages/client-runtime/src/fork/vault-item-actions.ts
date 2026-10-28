import type { EnvironmentId } from "@t3tools/contracts";
import {
  vaultReferenceText,
  type VaultItemKind,
  type VaultItemSummary,
} from "@t3tools/contracts/fork";

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

export const vaultAddPrefill = (query: string, kind?: VaultItemKind | null) => {
  const selectedKind = kind ?? "secret";
  return {
    label: query.trim().slice(0, 200),
    kind: selectedKind,
    manager: vaultItemActions(selectedKind).manager,
  };
};

export const vaultPickerSelection = (
  environmentId: EnvironmentId,
  item: VaultItemSummary,
  kind?: VaultItemKind | null,
) =>
  item.state === "active" && (kind == null || item.kind === kind)
    ? { environmentId, item, reference: vaultReferenceText(environmentId, item.id) }
    : null;
