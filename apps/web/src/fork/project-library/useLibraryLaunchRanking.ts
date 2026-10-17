import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  libraryLaunchInputs,
  libraryLaunchRanking,
  libraryWorkingThreadCounts,
  type LibraryLaunchHealthTarget,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryProfileReadiness,
  LibraryProject,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import type { LibraryLaunchMiniWorker } from "@t3tools/shared/fork/library-launch";
import { useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { mini } from "../mini-offload/state";
import { projectLibrary, useLibraryAuthority } from "./state";

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
              projectLibrary.copyHealth({
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
        const result = get(projectLibrary.profileReadiness({ environmentId, input }));
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null) readiness.set(environmentId, value);
        else if (!AsyncResult.isFailure(result)) pending = true;
      }
      return { readiness, pending };
    });
  }, [key]);
  return useAtomValue(atom);
}

/** Ready-or-not reports for the enabled Mini workers on each listed computer, as they arrive. */
function useMiniWorkers(environmentIds: readonly EnvironmentId[]) {
  const key = JSON.stringify(environmentIds);
  const atom = useMemo(() => {
    const parsed = JSON.parse(key) as EnvironmentId[];
    return Atom.make((get) => {
      const workers: LibraryLaunchMiniWorker[] = [];
      for (const environmentId of parsed) {
        if (!get(mini.check.permissionAtom(environmentId))) continue;
        const summaries = Option.getOrNull(
          AsyncResult.value(get(mini.workers({ environmentId, input: {} }))),
        );
        for (const summary of summaries ?? []) {
          if (!summary.enabled) continue;
          const readiness = Option.getOrNull(
            AsyncResult.value(
              get(mini.readiness({ environmentId, input: { workerId: summary.id } })),
            ),
          );
          if (readiness !== null) workers.push({ environmentId, readiness });
        }
      }
      return workers;
    });
  }, [key]);
  return useAtomValue(atom);
}

/**
 * Rank every computer for a new conversation in this project and scope, from what this client
 * knows now: connections, live copy health where the computer advertises it, the project's
 * conversations, how many threads each connected computer is running, the project's required
 * tools as checked on each connected computer, and Mini workers when the project allows Mini.
 */
export function useLibraryLaunchRanking(input: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly resourceId: string | null;
}) {
  const authority = useLibraryAuthority();
  const threads = useEnvironmentQuery(
    authority.authorityId
      ? projectLibrary.threads({
          environmentId: authority.authorityId,
          input: { projectId: input.project.id },
        })
      : null,
  );
  const shells = useThreadShells();
  const working = useMemo(() => libraryWorkingThreadCounts(shells), [shells]);
  const inputs = libraryLaunchInputs({
    project: input.project,
    copies: input.copies,
    hosts: authority.environments.map((entry) => ({
      environmentId: entry.environmentId,
      label: entry.label,
      online: entry.entry.enabled && entry.connection.phase === "connected",
      supportsExecution: entry.serverConfig?.environment.capabilities.supportsExecution !== false,
      capabilities: entry.serverConfig?.environment.capabilities,
    })),
    remembered: authority.computers,
    workingThreads: working,
  });
  const liveHealth = useLiveCopyHealth(inputs.healthTargets);
  const checks = useRequiredToolChecks(input.project, inputs.readinessEnvironmentIds);
  const miniWorkers = useMiniWorkers(inputs.miniEnvironmentIds);
  return libraryLaunchRanking({
    project: input.project,
    copies: input.copies,
    computers: inputs.computers,
    threads: threads.data ?? [],
    resourceId: input.resourceId,
    liveHealth,
    readiness: checks.readiness,
    readinessPending: checks.pending,
    miniWorkers,
  });
}
