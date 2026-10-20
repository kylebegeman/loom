import type { EnvironmentId } from "@t3tools/contracts";
const listeners = new Set<(environmentId: EnvironmentId | undefined) => void>();
export const onOpenVaultMigration = (
  listener: (environmentId: EnvironmentId | undefined) => void,
) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const openVaultMigration = (environmentId?: EnvironmentId) => {
  for (const listener of listeners) listener(environmentId);
};
