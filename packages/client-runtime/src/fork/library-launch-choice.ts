import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  rankLibraryLaunchCandidates,
  type LibraryLaunchCandidate,
  type LibraryLaunchComputer,
  type LibraryLaunchRanking,
} from "@t3tools/shared/fork/library-launch";
import { libraryCopiesForScope } from "./library-copy-choice.ts";
import { libraryRepositoryCanPull } from "./library-copy-health.ts";

/** Rank this project's computers for one scope, counting only copies that cover it. */
export function libraryLaunchRanking(input: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly computers: readonly LibraryLaunchComputer[];
  readonly threads: readonly LibraryThreadSummary[];
  /** One selected component, or null for the whole project. */
  readonly resourceId: string | null;
  readonly liveHealth?: ReadonlyMap<string, LibraryCopyHealth> | undefined;
}): LibraryLaunchRanking {
  const resourceIds = input.resourceId === null ? null : [input.resourceId];
  return rankLibraryLaunchCandidates({
    computers: input.computers,
    copies: input.computers.flatMap((computer) =>
      libraryCopiesForScope(input.project, input.copies, computer.environmentId, resourceIds),
    ),
    threads: input.threads.filter(
      (thread) => thread.projectId === input.project.id && thread.deleted !== true,
    ),
    resourceIds,
    liveHealth: input.liveHealth,
  });
}

/**
 * The computer and copy a dialog launches with. An explicit choice wins; otherwise the ranking's
 * preselection follows the data as it arrives. On a chosen computer, the best ranked copy applies
 * unless a copy was picked by hand.
 */
export function libraryLaunchChoice(input: {
  readonly ranking: LibraryLaunchRanking;
  readonly hostId: EnvironmentId | null;
  readonly copyId: string | null;
}): { readonly hostId: EnvironmentId | null; readonly candidate: LibraryLaunchCandidate | null } {
  const hostId = input.hostId ?? input.ranking.preselected?.environmentId ?? null;
  if (hostId === null) return { hostId, candidate: null };
  const onHost = input.ranking.candidates.filter((candidate) => candidate.environmentId === hostId);
  const candidate =
    onHost.find((entry) => entry.kind === "copy" && entry.copyId === input.copyId) ??
    onHost[0] ??
    null;
  return { hostId, candidate };
}

export interface LibraryLaunchWarning {
  /** One plain line, for example "This copy is 3 commits behind and has 2 uncommitted files." */
  readonly message: string;
  /** Repository folders to fast-forward before starting, or null when a pull is not safe. */
  readonly pullPaths: readonly string[] | null;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What to say before launching on a copy that is behind, has uncommitted files, or is broken. */
export function libraryLaunchWarning(
  candidate: LibraryLaunchCandidate | null,
  copy: LibraryWorkingCopy | null,
  resourceId: string | null,
): LibraryLaunchWarning | null {
  if (candidate?.kind !== "copy" || candidate.health === null) return null;
  if (candidate.freshness === "broken")
    return {
      message: "A folder in this copy is missing or is no longer a Git repository.",
      pullPaths: null,
    };
  if (candidate.freshness !== "stale") return null;
  const behind =
    candidate.behind > 0 ? `is ${plural(candidate.behind, "commit", "commits")} behind` : null;
  const changed =
    candidate.changed > 0
      ? `has ${plural(candidate.changed, "uncommitted file", "uncommitted files")}`
      : null;
  const message = `This copy ${[behind, changed].filter((part) => part !== null).join(" and ")}.`;
  // Pull only when every behind repository in scope can fast-forward cleanly.
  const behindRepositories = candidate.health.repositories.filter(
    (repository) =>
      (repository.behind ?? 0) > 0 &&
      (resourceId === null || repository.resourceId === resourceId) &&
      copy?.repositories.some((entry) => entry.resourceId === repository.resourceId),
  );
  const pullPaths =
    candidate.behind > 0 &&
    behindRepositories.length > 0 &&
    behindRepositories.every(libraryRepositoryCanPull)
      ? behindRepositories.flatMap(
          (repository) =>
            copy?.repositories.find((entry) => entry.resourceId === repository.resourceId)?.path ??
            [],
        )
      : null;
  return { message, pullPaths };
}
