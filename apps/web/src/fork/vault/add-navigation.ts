import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultItemKind, VaultItemSummary } from "@t3tools/contracts/fork";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";
export interface VaultAddOptions {
  environmentId?: EnvironmentId;
  kind?: VaultItemKind;
  label?: string;
  value?: string;
  onSaved?: (item: VaultItemSummary) => void;
}
export const vaultAddTarget = Atom.make<(VaultAddOptions & { requestId: number }) | null>(
  null,
).pipe(Atom.keepAlive);
let nextRequest = 0;
export const openVaultAdd = (options: VaultAddOptions = {}) => {
  appAtomRegistry.set(vaultAddTarget, {
    ...options,
    requestId: ++nextRequest,
  });
};
