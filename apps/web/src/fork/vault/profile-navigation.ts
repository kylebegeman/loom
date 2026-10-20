import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";
type Target = {
  environmentId: EnvironmentId | undefined;
  projectId?: ProjectId;
  section: "profiles" | "references";
};
export const vaultProfileTarget = Atom.make<Target | null>(null).pipe(Atom.keepAlive);
const listeners = new Set<(target: Target) => void>();
export const onOpenVaultProfiles = (listener: (target: Target) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const openVaultProfiles = (target: Target) => {
  appAtomRegistry.set(vaultProfileTarget, target);
  for (const listener of listeners) listener(target);
};
