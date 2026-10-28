import {
  VAULT_CORE_WS_METHODS as V,
  type VaultCoreStatus,
  type VaultItemKind,
} from "@t3tools/contracts/fork";
import { Atom } from "effect/reactivity";
import type { AtomRegistry } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

export const VAULT_KIND_LABELS: Record<VaultItemKind, string> = {
  secret: "Secret",
  "ssh-key": "SSH key",
  "service-connection": "Service connection",
  account: "Account",
  "secure-note": "Secure note",
  "secure-file": "Secure file",
};
// Hourly renewal keeps a seven-day token near its full period, so three days left means it stopped.
export const VAULT_TOKEN_WARNING_SECONDS = 72 * 60 * 60;
export const vaultStatusMessage = (status: VaultCoreStatus) => {
  const message = {
    unconfigured: "Connect this environment to your OpenBao service to start using Vault.",
    ready: "Vault is connected. Values stay hidden until you choose to reveal them.",
    locked: "Your Vault backend is locked. Unlock OpenBao, then refresh.",
    unavailable: "Your Vault backend is unavailable. Check its connection, then retry.",
    denied: "The Vault service connection needs access to its configured storage mount.",
    misconfigured:
      "The Vault connection needs repair. Check the origin, private token file and KV v2 mount in fork/vault/openbao.json or the server environment.",
  }[status.state];
  const remaining = status.tokenTtlSeconds ?? Infinity;
  if (status.state !== "ready" || remaining >= VAULT_TOKEN_WARNING_SECONDS) return message;
  const hours = Math.floor(remaining / (60 * 60));
  const left = hours < 1 ? "under an hour" : `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${message} Its service token expires in ${left}. Check the token renewal job on the computer running Loom, or reissue the token before then.`;
};
export const vaultHealthBackendMessage = (status: VaultCoreStatus) => {
  if (status.state === "locked") return "Backend sealed. Unlock OpenBao, then refresh.";
  if (status.state !== "ready") return vaultStatusMessage(status);
  const remaining = status.tokenTtlSeconds ?? Infinity;
  if (remaining >= VAULT_TOKEN_WARNING_SECONDS) return "Backend ready.";
  const hours = Math.floor(remaining / 3600);
  const left = hours < 1 ? "under an hour" : `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `Service token expires in ${left}. Check its renewal on the computer running Loom.`;
};
export const vaultItemChanges = Atom.family((_environmentId: EnvironmentId) => Atom.make(0));
export const refreshVaultItems = (
  target: { readonly environmentId: EnvironmentId },
  registry: AtomRegistry.AtomRegistry,
) =>
  Effect.sync(() => {
    const signal = vaultItemChanges(target.environmentId);
    registry.set(signal, registry.get(signal) + 1);
  });
export function createVaultCoreAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:status",
      tag: V.status,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:list",
      tag: V.list,
      refreshTrigger: ({ environmentId }) => vaultItemChanges(environmentId),
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:save",
      tag: V.save,
      onSuccess: refreshVaultItems,
    }),
    change: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:change",
      tag: V.change,
      onSuccess: refreshVaultItems,
    }),
    reveal: createEnvironmentRpcCommand(runtime, { label: "loom:vault:reveal", tag: V.reveal }),
  };
}

export const VAULT_FILE_LIMIT_BYTES = 512 * 1024;
