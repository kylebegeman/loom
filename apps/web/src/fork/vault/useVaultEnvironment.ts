import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironmentQuery } from "~/state/query";
import { vault } from "./state";

export function useVaultEnvironment(environmentId: EnvironmentId) {
  const source = useEnvironmentQuery(vault.status({ environmentId, input: {} }));
  return {
    vaultEnvironmentId: source.data?.accountEnvironmentId ?? environmentId,
    resolved: source.isSuccess,
  };
}
