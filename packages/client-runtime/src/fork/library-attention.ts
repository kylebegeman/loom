import type { LibraryThreadSummary, LibraryWorkingCopy } from "@t3tools/contracts/fork";

export interface LibraryAttentionItem {
  readonly id: string;
  readonly kind: "conversation" | "files";
  readonly title: string;
  readonly detail: string;
  readonly checkedAt: string;
  readonly priority: number;
}

/** Saved observations stay labelled as observations; disconnected computers cannot imply live status. */
export function libraryProjectAttention(
  threads: readonly LibraryThreadSummary[],
  copies: readonly LibraryWorkingCopy[],
): LibraryAttentionItem[] {
  const items: LibraryAttentionItem[] = [];
  const available = threads.filter(
    (thread) => !thread.archived && !thread.deleted && !thread.settled,
  );
  for (const thread of available) {
    if (
      !["preparing", "queued", "starting", "running", "waiting", "failed"].includes(thread.status)
    )
      continue;
    items.push({
      id: thread.id,
      kind: "conversation",
      title: thread.title,
      detail:
        thread.status === "waiting"
          ? "Waiting for a decision"
          : thread.status === "failed"
            ? "Last run needs attention"
            : "Work was running at the last sync",
      checkedAt: thread.syncedAt,
      priority: thread.status === "waiting" ? 0 : thread.status === "failed" ? 1 : 3,
    });
  }
  for (const copy of copies) {
    if (copy.state === "released" || copy.registered === false) continue;
    if (copy.state === "failed" || copy.state === "missing") {
      items.push({
        id: copy.id,
        kind: "files",
        title: copy.rootPath,
        detail:
          copy.state === "missing"
            ? "Files are missing on this computer"
            : "File preparation needs attention",
        checkedAt: copy.updatedAt,
        priority: 1,
      });
      continue;
    }
    const health = copy.health;
    if (!health) {
      items.push({
        id: copy.id,
        kind: "files",
        title: copy.rootPath,
        detail: "File and remote status have not been checked",
        checkedAt: copy.updatedAt,
        priority: 4,
      });
      continue;
    }
    const dirty = health.repositories.reduce((sum, repo) => sum + repo.uncommittedFiles, 0);
    const unpushed = health.repositories.reduce((sum, repo) => sum + repo.unpushedCommits, 0);
    const incomplete = copy.repositories.some(
      (repository) =>
        !health.repositories.some((report) => report.resourceId === repository.resourceId),
    );
    const unknown =
      incomplete ||
      health.repositories.some(
        (repo) => repo.error || repo.fetchFailed || !repo.fetchedAt || repo.upstreamGone,
      );
    if (dirty || unpushed || unknown)
      items.push({
        id: copy.id,
        kind: "files",
        title: copy.rootPath,
        detail: [
          dirty ? `${dirty} changed ${dirty === 1 ? "file" : "files"}` : "",
          unpushed ? `${unpushed} local ${unpushed === 1 ? "commit" : "commits"}` : "",
          incomplete
            ? "Some repositories have not been checked"
            : unknown
              ? "Remote preservation needs checking"
              : "",
        ]
          .filter(Boolean)
          .join("; "),
        checkedAt: health.checkedAt,
        priority: dirty || unpushed ? 2 : 4,
      });
  }
  const resume = available
    .filter(
      (thread) => !items.some((item) => item.kind === "conversation" && item.id === thread.id),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (resume)
    items.push({
      id: resume.id,
      kind: "conversation",
      title: resume.title,
      detail: "Continue your most recent conversation",
      checkedAt: resume.syncedAt,
      priority: 5,
    });
  return items.sort((a, b) => a.priority - b.priority || b.checkedAt.localeCompare(a.checkedAt));
}
