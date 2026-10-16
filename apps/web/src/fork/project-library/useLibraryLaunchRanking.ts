import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { libraryLaunchRanking, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  LIBRARY_PROFILE_READINESS_FEATURE,
  type LibraryCopyHealth,
  type LibraryProfileReadiness,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import type {
  LibraryLaunchComputer,
  LibraryLaunchMiniWorker,
} from "@t3tools/shared/fork/library-launch";
import { resolveSidebarThreadStatus } from "~/components/Sidebar.logic";
import { useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { mini } from "../mini-offload/state";
import { projectLibrary, useLibraryAuthority } from "./state";

/** Computers advertise this when they can check a Mini worker's readiness. */
const MINI_WORKER_READINESS_FEATURE = "mini-worker-readiness";

interface HealthTarget {
  readonly environmentId: EnvironmentId;
  readonly workingCopyId: string;
}

/** Live health for each listed copy, read on its own computer. Copies still loading are absent. */
function useLiveCopyHealth(targets: readonly HealthTarget[]) {
  const key = JSON.stringify(targets);
  const atom = useMemo(() => {
    const parsed = JSON.parse(key) as HealthTarget[];
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
  const working = useMemo(() => {
    const counts = new Map<EnvironmentId, number>();
    for (const shell of shells)
      if (resolveSidebarThreadStatus(shell) === "working")
        counts.set(shell.environmentId, (counts.get(shell.environmentId) ?? 0) + 1);
    return counts;
  }, [shells]);
  const computers: LibraryLaunchComputer[] = [
    ...authority.environments.map((entry) => ({
      environmentId: entry.environmentId,
      label: entry.label,
      online: entry.entry.enabled && entry.connection.phase === "connected",
      supportsExecution: entry.serverConfig?.environment.capabilities.supportsExecution !== false,
      workingThreads: working.get(entry.environmentId) ?? 0,
    })),
    // Computers the Library remembers but this client has not connected to.
    ...authority.computers
      .filter(
        (computer) =>
          !authority.environments.some((entry) => entry.environmentId === computer.environmentId),
      )
      .map((computer) => ({
        environmentId: computer.environmentId,
        label: computer.label,
        online: false,
        supportsExecution: computer.supportsExecution,
        workingThreads: 0,
      })),
  ];
  const liveHealth = useLiveCopyHealth(
    input.copies
      .filter(
        (copy) =>
          copy.projectId === input.project.id &&
          copy.state === "ready" &&
          computers.some(
            (computer) => computer.environmentId === copy.environmentId && computer.online,
          ) &&
          supportsLoomFeature(
            authority.environments.find((entry) => entry.environmentId === copy.environmentId)
              ?.serverConfig?.environment.capabilities,
            LIBRARY_COPY_HEALTH_FEATURE,
          ),
      )
      .map((copy) => ({ environmentId: copy.environmentId, workingCopyId: copy.id })),
  );
  const onlineWith = (feature: string) =>
    authority.environments
      .filter(
        (entry) =>
          entry.entry.enabled &&
          entry.connection.phase === "connected" &&
          supportsLoomFeature(entry.serverConfig?.environment.capabilities, feature),
      )
      .map((entry) => entry.environmentId);
  // Older computers and offline ones are not checked, so they rank as before.
  const checks = useRequiredToolChecks(
    input.project,
    (input.project.profile?.requiredTools?.length ?? 0) > 0
      ? onlineWith(LIBRARY_PROFILE_READINESS_FEATURE)
      : [],
  );
  const miniWorkers = useMiniWorkers(
    input.project.profile?.allowMini === true ? onlineWith(MINI_WORKER_READINESS_FEATURE) : [],
  );
  return libraryLaunchRanking({
    project: input.project,
    copies: input.copies,
    computers,
    threads: threads.data ?? [],
    resourceId: input.resourceId,
    liveHealth,
    readiness: checks.readiness,
    readinessPending: checks.pending,
    miniWorkers,
  });
}
