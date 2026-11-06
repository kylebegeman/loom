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

import { FilesystemBrowseError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isFilesystemBrowseError = Schema.is(FilesystemBrowseError);

/** Clone destinations may name folders that do not exist yet; cloning creates them. */
export function isMissingCloneParentBrowseFailure(input: {
  readonly cloning: boolean;
  readonly failure: unknown;
}): boolean {
  return (
    input.cloning &&
    isFilesystemBrowseError(input.failure) &&
    input.failure.failure === "read_directory_failed" &&
    input.failure.pathMissing === true
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
