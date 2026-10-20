import type { EnvironmentId } from "@t3tools/contracts";
const listeners = new Set<
  (environmentId: EnvironmentId | undefined, section?: "imports" | "inventory") => void
>();
export const onOpenVaultMigration = (
  listener: (environmentId: EnvironmentId | undefined, section?: "imports" | "inventory") => void,
) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const openVaultMigration = (
  environmentId?: EnvironmentId,
  section: "imports" | "inventory" = "imports",
) => {
  for (const listener of listeners) listener(environmentId, section);
};
