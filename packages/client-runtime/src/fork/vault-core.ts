import {
  VAULT_CORE_WS_METHODS as V,
  type VaultCoreStatus,
  type VaultItemKind,
} from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
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
export const vaultStatusMessage = (status: VaultCoreStatus) =>
  ({
    unconfigured: "Connect this environment to your OpenBao service to start using Vault.",
    ready: "Vault is connected. Values stay hidden until you choose to reveal them.",
    locked: "Your Vault backend is locked. Unlock OpenBao, then refresh.",
    unavailable: "Your Vault backend is unavailable. Check its connection, then retry.",
    denied: "The Vault service connection needs access to its configured storage mount.",
    misconfigured:
      "The Vault connection needs repair. Check its origin, private token file and KV v2 mount.",
  })[status.state];
export function createVaultCoreAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:status",
      tag: V.status,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, { label: "loom:vault:list", tag: V.list }),
    save: createEnvironmentRpcCommand(runtime, { label: "loom:vault:save", tag: V.save }),
    change: createEnvironmentRpcCommand(runtime, { label: "loom:vault:change", tag: V.change }),
    reveal: createEnvironmentRpcCommand(runtime, { label: "loom:vault:reveal", tag: V.reveal }),
  };
}

export const VAULT_FILE_LIMIT_BYTES = 512 * 1024;
