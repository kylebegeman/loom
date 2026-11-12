import type { EnvironmentId } from "@t3tools/contracts";
import { createVaultCoreAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";

const vault = createVaultCoreAtoms(connectionAtomRuntime);
export function useVaultEnvironment(environmentId: EnvironmentId) {
  const source = useEnvironmentQuery(vault.status({ environmentId, input: {} }));
  return {
    vaultEnvironmentId: source.data?.accountEnvironmentId ?? environmentId,
    resolved: source.isSuccess,
  };
}
