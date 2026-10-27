import { canCreateProjectInEnvironment } from "@t3tools/client-runtime/operations/projects";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentId, ExecutionEnvironmentCapabilities } from "@t3tools/contracts"; // fork: library-only

// fork: library-only The Library holds projects for other computers and runs none itself.
export function addProjectTargets<T extends { readonly environmentId: EnvironmentId }>(
  computers: ReadonlyArray<T>,
  serverConfigs: ReadonlyMap<
    EnvironmentId,
    {
      readonly environment: {
        readonly capabilities: Pick<ExecutionEnvironmentCapabilities, "supportsExecution">;
      };
    }
  >,
): ReadonlyArray<T> {
  return computers.filter(
    (computer) =>
      serverConfigs.get(computer.environmentId)?.environment.capabilities.supportsExecution !==
      false,
  );
}

export function resolveAddProjectEnvironment<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly connectionState: EnvironmentConnectionPhase;
  },
>(environmentOptions: ReadonlyArray<T>, requestedEnvironmentId: EnvironmentId | null): T | null {
  if (requestedEnvironmentId !== null) {
    return (
      environmentOptions.find(
        (environment) =>
          environment.environmentId === requestedEnvironmentId &&
          canCreateProjectInEnvironment(environment.connectionState),
      ) ?? null
    );
  }

  return (
    environmentOptions.find((environment) =>
      canCreateProjectInEnvironment(environment.connectionState),
    ) ?? null
  );
}
