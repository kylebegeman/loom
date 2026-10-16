import type { LibraryRepositoryHealth } from "@t3tools/contracts/fork";

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
  if (health.ahead === undefined || health.behind === undefined) {
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
    health.ahead === 0 &&
    (health.behind ?? 0) > 0 &&
    health.uncommittedFiles === 0
  );
}
