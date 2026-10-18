import { VAULT_SSH_WS_METHODS as V } from "@t3tools/contracts/fork";
import { createSha256 } from "@t3tools/shared/sha256";
import * as Base64 from "effect/encoding/Base64";
import * as Result from "effect/Result";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import { refreshVaultItems, vaultItemChanges } from "./vault-core.ts";

export function createVaultSshAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    info: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:ssh-info",
      tag: V.info,
      refreshTrigger: ({ environmentId }) => vaultItemChanges(environmentId),
    }),
    generate: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:ssh-generate",
      tag: V.generate,
      onSuccess: refreshVaultItems,
    }),
    trust: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:ssh-trust",
      tag: V.trust,
      onSuccess: refreshVaultItems,
    }),
    probe: createEnvironmentRpcCommand(runtime, { label: "loom:vault:ssh-probe", tag: V.probe }),
  };
}
const prefix = Uint8Array.from([
  0,
  0,
  0,
  11,
  ...new TextEncoder().encode("ssh-ed25519"),
  0,
  0,
  0,
  32,
]);
export const parseVaultSshPublicKey = (input: string) => {
  const [algorithm, encoded] = input.trim().split(/\s+/);
  if (algorithm !== "ssh-ed25519" || !encoded || input.length > 4096) return null;
  const decoded = Base64.decode(encoded);
  if (Result.isFailure(decoded)) return null;
  const bytes = decoded.success;
  if (
    bytes.length !== 51 ||
    !prefix.every((byte, index) => bytes[index] === byte) ||
    Base64.encode(bytes) !== encoded
  )
    return null;
  return {
    key: `ssh-ed25519 ${encoded}`,
    fingerprint: `SHA256:${Base64.encode(createSha256().update(bytes).digest()).replace(/=+$/, "")}`,
  };
};
