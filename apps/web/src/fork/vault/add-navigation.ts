import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { openVaultSsh } from "./ssh-navigation";
export const vaultAddTarget = Atom.make<{
  environmentId?: EnvironmentId;
  requestId: number;
} | null>(null).pipe(Atom.keepAlive);
let nextRequest = 0;
export const openVaultAdd = (environmentId?: EnvironmentId) => {
  appAtomRegistry.set(vaultAddTarget, {
    ...(environmentId ? { environmentId } : {}),
    requestId: ++nextRequest,
  });
  openVaultSsh(environmentId);
};
