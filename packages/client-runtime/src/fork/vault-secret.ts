import { VAULT_SECRET_WS_METHODS, type VaultItemSummary } from "@t3tools/contracts/fork";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";

export const secretRequestAcceptsItem = (item: VaultItemSummary, fileDelivery: boolean) =>
  item.state === "active" &&
  (item.kind === "secret" ||
    item.kind === "account" ||
    item.kind === "secure-note" ||
    (fileDelivery && item.kind === "secure-file"));

export const secretSaveTarget = (
  items: ReadonlyArray<VaultItemSummary>,
  name: string,
  saveAsNew: boolean,
): VaultItemSummary | null =>
  saveAsNew
    ? null
    : (items.find(
        (item) =>
          secretRequestAcceptsItem(item, false) &&
          item.label.toLowerCase() === name.trim().toLowerCase(),
      ) ?? null);

export function createVaultSecretAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    answerFromItem: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault-secret:answer-from-item",
      tag: VAULT_SECRET_WS_METHODS.answerFromItem,
    }),
  };
}
