import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";
export interface VaultAccessTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId?: string;
  readonly itemId?: string;
}
export const vaultAccessTarget = Atom.make<VaultAccessTarget | null>(null).pipe(Atom.keepAlive);
const listeners = new Set<(target: VaultAccessTarget) => void>();
export const onOpenVaultAccess = (listener: (target: VaultAccessTarget) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const openVaultAccess = (target: VaultAccessTarget) => {
  appAtomRegistry.set(vaultAccessTarget, target);
  for (const listener of listeners) listener(target);
};
