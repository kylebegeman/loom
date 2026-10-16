import type {
  LibraryCopyHealth,
  LibraryRepositoryHealth,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

const SHORT_COMMIT_LENGTH = 7;
const ERROR_LABELS: Record<NonNullable<LibraryRepositoryHealth["error"]>, string> = {
  missing: "Folder missing",
  "not-a-repository": "Not a Git repository",
  unreadable: "Status unavailable",
};

/** One line describing a repository, for example "main · 3 behind · 2 changed". */
export function libraryRepositoryHealthSummary(health: LibraryRepositoryHealth): string {
  if (health.error !== undefined) return ERROR_LABELS[health.error];
  const parts = [
    health.branch ??
      (health.head ? `detached at ${health.head.slice(0, SHORT_COMMIT_LENGTH)}` : "detached"),
  ];
  if (health.upstreamGone === true) {
    parts.push("upstream gone");
    if (health.unpushedCommits > 0) parts.push(`${health.unpushedCommits} unpushed`);
  } else if (health.ahead === undefined || health.behind === undefined) {
    // Detached heads never track an upstream, so only call it out for branches.
    if (health.branch !== undefined) parts.push("no upstream");
    if (health.unpushedCommits > 0) parts.push(`${health.unpushedCommits} unpushed`);
  } else {
    if (health.ahead > 0) parts.push(`${health.ahead} ahead`);
    if (health.behind > 0) parts.push(`${health.behind} behind`);
    if (health.ahead === 0 && health.behind === 0) parts.push("up to date");
  }
  if (health.uncommittedFiles > 0) parts.push(`${health.uncommittedFiles} changed`);
  return parts.join(" · ");
}

/** A fast-forward pull is safe: on a branch, behind its upstream, nothing local to merge. */
export function libraryRepositoryCanPull(health: LibraryRepositoryHealth): boolean {
  return (
    health.error === undefined &&
    health.branch !== undefined &&
    health.upstreamGone !== true &&
    health.ahead === 0 &&
    (health.behind ?? 0) > 0 &&
    health.uncommittedFiles === 0
  );
}

/** The copy health worth showing, and how old it is. */
export interface LibraryEffectiveCopyHealth {
  readonly health: LibraryCopyHealth;
  /** `live` was just read on the connected computer. `published` is the Library's last report. */
  readonly source: "live" | "published";
  /** When this health was last known to hold. */
  readonly asOf: string;
}

const describesCopy = (health: LibraryCopyHealth, copy: LibraryWorkingCopy) =>
  health.copyId === copy.id && health.environmentId === copy.environmentId;

/**
 * Live health from the copy's connected computer wins. Otherwise the last report the computer
 * published to the Library, aged by when the Library last heard from that computer. A copy whose
 * computer never reported has no health, which is never the same as clean.
 */
export function effectiveLibraryCopyHealth(input: {
  readonly copy: LibraryWorkingCopy;
  readonly live: LibraryCopyHealth | null;
  /** `LibraryComputer.lastSeenAt` for the copy's computer, when the Library knows it. */
  readonly lastSeenAt?: string | undefined;
}): LibraryEffectiveCopyHealth | null {
  const { copy, live, lastSeenAt } = input;
  if (live !== null && describesCopy(live, copy))
    return { health: live, source: "live", asOf: live.checkedAt };
  const published = copy.health;
  if (
    published === undefined ||
    !describesCopy(published, copy) ||
    published.repositories.length === 0
  )
    return null;
  // A computer rereads its copies while it is in touch with the Library and reports any change,
  // so its last report still held when the Library last heard from it.
  const asOf =
    lastSeenAt !== undefined && Date.parse(lastSeenAt) > Date.parse(published.checkedAt)
      ? lastSeenAt
      : published.checkedAt;
  return { health: published, source: "published", asOf };
}
