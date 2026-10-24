import { noProjectTargetEnvironmentId, noProjectWorkspaceRoot } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";

import { useServerConfigs } from "../../state/entities";
import type { ConnectedEnvironmentSummary } from "../../state/remote-runtime-types";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";

/** Mobile registers no primary computer, so the selected one wins, then saved-connection order. */
export function useNoProjectTarget(
  selectedEnvironmentId: EnvironmentId | null,
): ConnectedEnvironmentSummary | null {
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const serverConfigs = useServerConfigs();
  const environmentId = noProjectTargetEnvironmentId({
    environments: connectedEnvironments,
    canRun: (environment) =>
      noProjectWorkspaceRoot(
        environment.connectionState,
        serverConfigs.get(environment.environmentId),
      ) !== null,
    preferred: [selectedEnvironmentId],
  });
  return (
    connectedEnvironments.find((environment) => environment.environmentId === environmentId) ?? null
  );
}
