import { useAtomValue } from "@effect/atom-react";
import {
  libraryLaunchInputs,
  libraryLaunchRanking,
  libraryWorkingThreadCounts,
  supportsLoomFeature,
  type LibraryLaunchHealthTarget,
} from "@t3tools/client-runtime/fork";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryProfileReadiness,
  LibraryProject,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";
import { useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentsWithScope } from "../../state/session";
import { library, useLibraryAuthority } from "./libraryState";

/** Live health for each listed copy, read on its own computer. Copies still loading are absent. */
function useLiveCopyHealth(targets: readonly LibraryLaunchHealthTarget[]) {
  const key = JSON.stringify(targets);
  const atom = useMemo(() => {
    const parsed = JSON.parse(key) as LibraryLaunchHealthTarget[];
    return Atom.make((get) => {
      const health = new Map<string, LibraryCopyHealth>();
      for (const target of parsed) {
        const value = Option.getOrNull(
          AsyncResult.value(
            get(
              library.copyHealth({
                environmentId: target.environmentId,
                input: { workingCopyId: target.workingCopyId },
              }),
            ),
          ),
        );
        if (value !== null) health.set(target.workingCopyId, value);
      }
      return health;
    });
  }, [key]);
  return useAtomValue(atom);
}

/**
 * The project's required-tool checks on each listed computer. `pending` stays true until every
 * check has answered; a check that fails to run is left out, which ranks as not known.
 */
function useRequiredToolChecks(project: LibraryProject, environmentIds: readonly EnvironmentId[]) {
  const key = JSON.stringify({
    environmentIds,
    input: { projectId: project.id, profile: project.profile ?? {} },
  });
  const atom = useMemo(() => {
    const { environmentIds: ids, input } = JSON.parse(key) as {
      environmentIds: EnvironmentId[];
      input: { projectId: string; profile: NonNullable<LibraryProject["profile"]> };
    };
    return Atom.make((get) => {
      const readiness = new Map<EnvironmentId, LibraryProfileReadiness>();
      let pending = false;
      for (const environmentId of ids) {
        const result = get(library.profileReadiness({ environmentId, input }));
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null) readiness.set(environmentId, value);
        else if (!AsyncResult.isFailure(result)) pending = true;
      }
      return { readiness, pending };
    });
  }, [key]);
  return useAtomValue(atom);
}

/**
 * Rank every computer for a new conversation in this project and scope, as web does. Mobile has no
 * Mini atoms, so Mini workers are not listed. A computer is ranked only when this device can start
 * a Library conversation there, so a computer the row disables is never preselected.
 */
export function useLibraryLaunchRanking(input: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly resourceId: string | null;
}) {
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  const operable = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope);
  const threads = useEnvironmentQuery(
    authority.environmentId
      ? library.threads({
          environmentId: authority.environmentId,
          input: { projectId: input.project.id },
        })
      : null,
  );
  const shells = useThreadShells();
  const working = useMemo(() => libraryWorkingThreadCounts(shells), [shells]);
  const inputs = libraryLaunchInputs({
    project: input.project,
    copies: input.copies,
    hosts: environments.map((entry) => {
      const capabilities = entry.serverConfig?.environment.capabilities;
      return {
        environmentId: entry.environmentId,
        label: entry.label,
        online: entry.entry.enabled && entry.connection.phase === "connected",
        supportsExecution:
          capabilities?.supportsExecution !== false &&
          supportsLoomFeature(capabilities, "project-library") &&
          operable.has(entry.environmentId),
        capabilities,
      };
    }),
    remembered: authority.computers,
    workingThreads: working,
  });
  const liveHealth = useLiveCopyHealth(inputs.healthTargets);
  const checks = useRequiredToolChecks(input.project, inputs.readinessEnvironmentIds);
  return libraryLaunchRanking({
    project: input.project,
    copies: input.copies,
    computers: inputs.computers,
    threads: threads.data ?? [],
    resourceId: input.resourceId,
    liveHealth,
    readiness: checks.readiness,
    readinessPending: checks.pending,
  });
}
