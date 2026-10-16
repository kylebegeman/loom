import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { libraryLaunchRanking, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  type LibraryCopyHealth,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import type { LibraryLaunchComputer } from "@t3tools/shared/fork/library-launch";
import { resolveSidebarThreadStatus } from "~/components/Sidebar.logic";
import { useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary, useLibraryAuthority } from "./state";

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
 * Rank every computer for a new conversation in this project and scope, from what this client
 * knows now: connections, live copy health where the computer advertises it, the project's
 * conversations, and how many threads each connected computer is running.
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
  return libraryLaunchRanking({
    project: input.project,
    copies: input.copies,
    computers,
    threads: threads.data ?? [],
    resourceId: input.resourceId,
    liveHealth,
  });
}
