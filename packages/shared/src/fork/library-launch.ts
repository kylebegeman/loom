import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryCopyHealth, LibraryRepositoryHealth } from "@t3tools/contracts/fork";

/** A computer that might run the conversation, as the caller sees it right now. */
export interface LibraryLaunchComputer {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** Connected now. Only online computers can be preselected. */
  readonly online: boolean;
  /** Computers that cannot run agents are never candidates. */
  readonly supportsExecution: boolean;
  /** Threads running on this computer now, across every project. */
  readonly workingThreads: number;
}

/** A ready copy that covers the requested scope, for example from `libraryCopiesForScope`. */
export interface LibraryLaunchCopy {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  /** Health the Library published for this copy, if any. Live health wins over it. */
  readonly health?: LibraryCopyHealth | undefined;
}

/** A conversation of this project, enough to know where it was last used. */
export interface LibraryLaunchThread {
  readonly environmentId: EnvironmentId;
  readonly workingCopyId: string | null;
  readonly updatedAt: string;
}

/**
 * How current a copy is. `up-to-date` is clean and not behind, `unknown` has no health yet,
 * `stale` is behind or has uncommitted files, and `broken` has a missing or non-Git folder.
 */
export type LibraryLaunchFreshness = "up-to-date" | "unknown" | "stale" | "broken";

interface LibraryLaunchCandidateBase {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly online: boolean;
  /** Most recent use of this project on this computer. */
  readonly lastUsedAt: string | null;
  readonly workingThreads: number;
  /** Short, plain reasons in display order, for example ["online", "up to date"]. */
  readonly reasons: readonly string[];
}

export type LibraryLaunchCandidate =
  | (LibraryLaunchCandidateBase & {
      readonly kind: "copy";
      readonly copyId: string;
      readonly freshness: LibraryLaunchFreshness;
      /** Repositories in scope behind their upstream, summed. */
      readonly behind: number;
      /** Uncommitted files in scope, summed. */
      readonly changed: number;
      /** The health this candidate was ranked with, live or published. */
      readonly health: LibraryCopyHealth | null;
    })
  | (LibraryLaunchCandidateBase & { readonly kind: "get-copy" })
  // Reserved for LP-18: a Mini worker for long jobs. Never produced here yet.
  | (LibraryLaunchCandidateBase & { readonly kind: "mini" });

export interface LibraryLaunchRanking {
  /** Best first. Offline computers stay listed, after every online one. */
  readonly candidates: readonly LibraryLaunchCandidate[];
  /** The top candidate when it may be chosen for the user, otherwise null. */
  readonly preselected: LibraryLaunchCandidate | null;
}

const FRESHNESS_ORDER: Record<LibraryLaunchFreshness, number> = {
  "up-to-date": 0,
  unknown: 1,
  stale: 2,
  broken: 3,
};

const timestamp = (value: string | null) => {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const later = (left: string | null, right: string) =>
  timestamp(right) > timestamp(left) ? right : (left ?? right);

/** Health for the repositories in scope; `resourceIds` null means the whole copy. */
function scopedRepositories(
  health: LibraryCopyHealth,
  resourceIds: readonly string[] | null,
): readonly LibraryRepositoryHealth[] {
  return resourceIds === null
    ? health.repositories
    : health.repositories.filter((repository) => resourceIds.includes(repository.resourceId));
}

/** Freshness and counts of a copy's in-scope repositories. Missing health reads as unknown. */
export function libraryLaunchFreshness(
  health: LibraryCopyHealth | null,
  resourceIds: readonly string[] | null,
): {
  readonly freshness: LibraryLaunchFreshness;
  readonly behind: number;
  readonly changed: number;
} {
  if (health === null) return { freshness: "unknown", behind: 0, changed: 0 };
  const repositories = scopedRepositories(health, resourceIds);
  let behind = 0;
  let changed = 0;
  let broken = false;
  let unreadable = false;
  for (const repository of repositories) {
    if (repository.error === "missing" || repository.error === "not-a-repository") broken = true;
    else if (repository.error !== undefined) unreadable = true;
    else {
      behind += repository.behind ?? 0;
      changed += repository.uncommittedFiles;
    }
  }
  const freshness: LibraryLaunchFreshness = broken
    ? "broken"
    : behind > 0 || changed > 0
      ? "stale"
      : unreadable || repositories.length === 0
        ? "unknown"
        : "up-to-date";
  return { freshness, behind, changed };
}

function freshnessReason(freshness: LibraryLaunchFreshness, behind: number, changed: number) {
  switch (freshness) {
    case "up-to-date":
      return "up to date";
    case "unknown":
      return "not checked";
    case "broken":
      return "folder missing";
    case "stale":
      return [behind > 0 ? `${behind} behind` : null, changed > 0 ? `${changed} changed` : null]
        .filter((part) => part !== null)
        .join(", ");
  }
}

/**
 * Order every computer that could start this project's conversation, best first:
 * online before offline, a copy covering the scope before getting one, up to date before
 * unchecked before stale, the computer used most recently for this project, then the one with
 * the fewest working threads. Remaining ties fall to label, computer and copy id, so the order
 * never depends on input order. Live health wins over health the Library published.
 */
export function rankLibraryLaunchCandidates(input: {
  readonly computers: readonly LibraryLaunchComputer[];
  readonly copies: readonly LibraryLaunchCopy[];
  readonly threads: readonly LibraryLaunchThread[];
  /** The selected components, or null for the whole project. */
  readonly resourceIds: readonly string[] | null;
  /** Health read now on each copy's computer, keyed by copy id. */
  readonly liveHealth?: ReadonlyMap<string, LibraryCopyHealth> | undefined;
}): LibraryLaunchRanking {
  const computerLastUsed = new Map<EnvironmentId, string>();
  const copyLastUsed = new Map<string, string>();
  for (const thread of input.threads) {
    computerLastUsed.set(
      thread.environmentId,
      later(computerLastUsed.get(thread.environmentId) ?? null, thread.updatedAt),
    );
    if (thread.workingCopyId !== null)
      copyLastUsed.set(
        thread.workingCopyId,
        later(copyLastUsed.get(thread.workingCopyId) ?? null, thread.updatedAt),
      );
  }
  const mostRecentUse = [...computerLastUsed.values()].reduce<string | null>(later, null);

  const candidates: LibraryLaunchCandidate[] = [];
  for (const computer of input.computers) {
    if (!computer.supportsExecution) continue;
    const lastUsedAt = computerLastUsed.get(computer.environmentId) ?? null;
    const base = {
      environmentId: computer.environmentId,
      label: computer.label,
      online: computer.online,
      lastUsedAt,
      workingThreads: computer.workingThreads,
    };
    const context = [
      ...(lastUsedAt !== null && lastUsedAt === mostRecentUse ? ["used last"] : []),
      ...(computer.online && computer.workingThreads > 0
        ? [`${computer.workingThreads} working`]
        : []),
    ];
    const copies = input.copies.filter((copy) => copy.environmentId === computer.environmentId);
    if (copies.length === 0) {
      candidates.push({
        ...base,
        kind: "get-copy",
        reasons: [computer.online ? "online" : "offline", "no copy yet", ...context],
      });
      continue;
    }
    for (const copy of copies) {
      const live = input.liveHealth?.get(copy.id);
      const published = copy.health?.copyId === copy.id ? copy.health : undefined;
      const health = live?.copyId === copy.id ? live : (published ?? null);
      const { freshness, behind, changed } = libraryLaunchFreshness(health, input.resourceIds);
      candidates.push({
        ...base,
        kind: "copy",
        copyId: copy.id,
        freshness,
        behind,
        changed,
        health,
        reasons: [
          computer.online ? "online" : "offline",
          freshnessReason(freshness, behind, changed),
          ...context,
        ],
      });
    }
  }

  const kindOrder = (candidate: LibraryLaunchCandidate) =>
    candidate.kind === "copy" ? 0 : candidate.kind === "get-copy" ? 1 : 2;
  const freshnessOrder = (candidate: LibraryLaunchCandidate) =>
    candidate.kind === "copy" ? FRESHNESS_ORDER[candidate.freshness] : 0;
  const copyId = (candidate: LibraryLaunchCandidate) =>
    candidate.kind === "copy" ? candidate.copyId : "";
  candidates.sort(
    (left, right) =>
      Number(right.online) - Number(left.online) ||
      kindOrder(left) - kindOrder(right) ||
      freshnessOrder(left) - freshnessOrder(right) ||
      timestamp(right.lastUsedAt) - timestamp(left.lastUsedAt) ||
      left.workingThreads - right.workingThreads ||
      timestamp(copyLastUsed.get(copyId(right)) ?? null) -
        timestamp(copyLastUsed.get(copyId(left)) ?? null) ||
      left.label.localeCompare(right.label) ||
      left.environmentId.localeCompare(right.environmentId) ||
      copyId(left).localeCompare(copyId(right)),
  );
  // Offline computers and broken copies stay listed honestly but are never chosen for the user.
  const preselected =
    candidates.find(
      (candidate) =>
        candidate.online && !(candidate.kind === "copy" && candidate.freshness === "broken"),
    ) ?? null;
  return { candidates, preselected };
}

/** "Mac Mini · online, up to date". */
export function libraryLaunchCandidateSummary(candidate: LibraryLaunchCandidate): string {
  return `${candidate.label} · ${candidate.reasons.join(", ")}`;
}
