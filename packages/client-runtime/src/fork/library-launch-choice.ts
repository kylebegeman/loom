import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryLaunchWorkspace,
  LibraryProfileReadiness,
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  rankLibraryProjectLaunch,
  type LibraryLaunchCandidate,
  type LibraryLaunchComputer,
  type LibraryLaunchMiniWorker,
  type LibraryLaunchRanking,
} from "@t3tools/shared/fork/library-launch";
import { threadRuntimeIsActive, type EnvironmentThreadShell } from "../state/models.ts";
import { libraryRepositoryCanPull } from "./library-copy-health.ts";
import { isRepositoryResource } from "./library-resources.ts";

/**
 * Rank this project's computers for one scope, counting only copies that cover it. While
 * required-tool checks are still loading nothing is preselected, so a computer missing a tool is
 * never chosen before its check arrives.
 */
export function libraryLaunchRanking(input: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly computers: readonly LibraryLaunchComputer[];
  readonly threads: readonly LibraryThreadSummary[];
  /** One selected component, or null for the whole project. */
  readonly resourceId: string | null;
  readonly liveHealth?: ReadonlyMap<string, LibraryCopyHealth> | undefined;
  /** Required-tool checks read on each computer, keyed by computer. */
  readonly readiness?: ReadonlyMap<EnvironmentId, LibraryProfileReadiness> | undefined;
  /** True while a computer's required-tool check has not answered yet. */
  readonly readinessPending?: boolean | undefined;
  readonly miniWorkers?: readonly LibraryLaunchMiniWorker[] | undefined;
}): LibraryLaunchRanking {
  const ranking = rankLibraryProjectLaunch({
    ...input,
    resourceIds: input.resourceId === null ? null : [input.resourceId],
  });
  return input.readinessPending === true ? { ...ranking, preselected: null } : ranking;
}

/**
 * The computer and copy a dialog launches with. An explicit choice wins; otherwise the ranking's
 * preselection follows the data as it arrives. On a chosen computer, the best ranked copy applies
 * unless a copy was picked by hand. Mini workers are never the launch target: a conversation starts
 * on a computer and sends long jobs to Mini from there.
 */
export function libraryLaunchChoice(input: {
  readonly ranking: LibraryLaunchRanking;
  readonly hostId: EnvironmentId | null;
  readonly copyId: string | null;
}): { readonly hostId: EnvironmentId | null; readonly candidate: LibraryLaunchCandidate | null } {
  const hostId = input.hostId ?? input.ranking.preselected?.environmentId ?? null;
  if (hostId === null) return { hostId, candidate: null };
  const onHost = input.ranking.candidates.filter(
    (candidate) => candidate.environmentId === hostId && candidate.kind !== "mini",
  );
  const candidate =
    input.copyId === null
      ? (onHost[0] ?? null)
      : (onHost.find((entry) => entry.kind === "copy" && entry.copyId === input.copyId) ?? null);
  return { hostId, candidate };
}

export interface LibraryLaunchWarning {
  /** One plain line, for example "This copy is 3 commits behind and has 2 uncommitted files." */
  readonly message: string;
  /** Repository folders to fast-forward before starting, or null when a pull is not safe. */
  readonly pullPaths: readonly string[] | null;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const normalizeFolder = (folder: string) => folder.replace(/\\/g, "/").replace(/\/+$/, "");

/**
 * Conversations working now in a copy's own folder, including its component folders. Worktrees
 * made from the copy live elsewhere, so their conversations do not count: only these share the
 * folder's files and branch with a conversation started there.
 */
export function libraryCopyFolderConversations(
  shells: readonly Pick<
    EnvironmentThreadShell,
    "environmentId" | "worktreePath" | "runtime" | "archivedAt"
  >[],
  copy: Pick<LibraryWorkingCopy, "environmentId" | "rootPath" | "state"> | null,
): number {
  if (copy === null || copy.state !== "ready") return 0;
  const root = normalizeFolder(copy.rootPath);
  return shells.filter((shell) => {
    if (shell.environmentId !== copy.environmentId || shell.archivedAt !== null) return false;
    if (shell.worktreePath === null || !threadRuntimeIsActive(shell.runtime)) return false;
    const folder = normalizeFolder(shell.worktreePath);
    return folder === root || folder.startsWith(`${root}/`);
  }).length;
}

/**
 * Whether a start in this scope can have a worktree of its own: the server makes one only for a
 * single repository, which is a chosen component or a project that is one repository at its root.
 */
export function libraryLaunchCanUseWorktree(
  project: Pick<LibraryProject, "resources">,
  resourceId: string | null,
): boolean {
  if (resourceId !== null) return true;
  const repositories = project.resources.filter(isRepositoryResource);
  return repositories.length === 1 && repositories[0]!.relativePath === ".";
}

/**
 * Where a start works: the user's choice, otherwise a new worktree while other conversations are
 * working in the copy's folder, otherwise the folder. Null when the start can only use the folder.
 */
export function libraryLaunchWorkspace(input: {
  readonly available: boolean;
  readonly chosen: LibraryLaunchWorkspace | null;
  readonly conversations: number;
}): LibraryLaunchWorkspace | null {
  if (!input.available) return null;
  return input.chosen ?? (input.conversations > 0 ? "worktree" : "folder");
}

/**
 * What to say before launching on a copy that is behind or broken, or into a folder other
 * conversations are working in. Uncommitted files alone are normal in a copy in use, so they are
 * only mentioned alongside being behind, where they explain why a pull is not offered.
 */
export function libraryLaunchWarning(
  candidate: LibraryLaunchCandidate | null,
  copy: LibraryWorkingCopy | null,
  resourceId: string | null,
  sharedFolder?: {
    /** Other conversations working in the copy's folder. */
    readonly conversations: number;
    /** Where this start works, or null when it can only use the folder. */
    readonly workspace: LibraryLaunchWorkspace | null;
  },
): LibraryLaunchWarning | null {
  if (candidate?.kind !== "copy") return null;
  const others = sharedFolder?.conversations ?? 0;
  const working = `${others === 1 ? "Another conversation is" : `${others} other conversations are`} working in this folder`;
  // A start in its own worktree leaves the folder alone, but pulling would still change files
  // under the others' work, so the pull stays withheld below.
  const shared =
    others === 0 || sharedFolder?.workspace === "worktree"
      ? null
      : sharedFolder?.workspace === "folder"
        ? `${working}. Choose New worktree to keep the changes apart.`
        : `${working} and changing the same files.`;
  if (candidate.health !== null && candidate.freshness === "broken")
    return {
      message: "A folder in this copy is missing or is no longer a Git repository.",
      pullPaths: null,
    };
  if (candidate.health === null || candidate.freshness !== "stale")
    return shared === null ? null : { message: shared, pullPaths: null };
  const behind =
    candidate.behind > 0 ? `is ${plural(candidate.behind, "commit", "commits")} behind` : null;
  const changed =
    candidate.changed > 0
      ? `has ${plural(candidate.changed, "uncommitted file", "uncommitted files")}`
      : null;
  const message = [
    `This copy ${[behind, changed].filter((part) => part !== null).join(" and ")}.`,
    ...(shared === null ? [] : [shared]),
  ].join(" ");
  // Pull only when every behind repository in scope can fast-forward cleanly, and never under
  // another conversation's work in the same folder.
  const behindRepositories = candidate.health.repositories.filter(
    (repository) =>
      (repository.behind ?? 0) > 0 &&
      (resourceId === null || repository.resourceId === resourceId) &&
      copy?.repositories.some((entry) => entry.resourceId === repository.resourceId),
  );
  const pullPaths =
    others === 0 &&
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
