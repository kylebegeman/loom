import type { EnvironmentId } from "@t3tools/contracts";
type Target = { environmentId: EnvironmentId | undefined; section: "profiles" | "references" };
const listeners = new Set<(target: Target) => void>();
export const onOpenVaultProfiles = (listener: (target: Target) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const openVaultProfiles = (target: Target) => {
  for (const listener of listeners) listener(target);
};
