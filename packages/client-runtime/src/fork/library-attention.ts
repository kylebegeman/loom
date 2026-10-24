import type { LibraryThreadSummary, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import type { LibraryWorkflowTone } from "./library-workflows.ts";

export interface LibraryAttentionItem {
  readonly id: string;
  /** `resume` is a suggestion, not a problem: the latest open conversation when nothing else is. */
  readonly kind: "conversation" | "files" | "resume";
  /** Where the observation came from: a conversation's computer, or the computer holding files. */
  readonly environmentId: LibraryThreadSummary["environmentId"];
  readonly title: string;
  readonly detail: string;
  readonly checkedAt: string;
  readonly priority: number;
}

/** How loudly a client should show an item, read from its priority. */
export function libraryAttentionTone(
  item: Pick<LibraryAttentionItem, "priority">,
): LibraryWorkflowTone {
  if (item.priority === 0 || item.priority === 2) return "warning";
  if (item.priority === 1) return "danger";
  if (item.priority === 3) return "active";
  return "neutral";
}

export type LibraryConversationAttention = "waiting" | "failed" | "working";

const WORKING_STATUSES = new Set(["preparing", "queued", "starting", "running"]);

/** What a saved conversation asks of a person, as of its last sync. Null when nothing. */
export function libraryConversationAttention(
  thread: Pick<LibraryThreadSummary, "status" | "archived" | "deleted" | "settled">,
): LibraryConversationAttention | null {
  if (thread.archived || thread.deleted || thread.settled) return null;
  if (thread.status === "waiting") return "waiting";
  if (thread.status === "failed") return "failed";
  return WORKING_STATUSES.has(thread.status) ? "working" : null;
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
    const attention = libraryConversationAttention(thread);
    if (!attention) continue;
    items.push({
      id: thread.id,
      kind: "conversation",
      environmentId: thread.environmentId,
      title: thread.title,
      detail:
        attention === "waiting"
          ? "Waiting for a decision"
          : attention === "failed"
            ? "Last run needs attention"
            : "Work was running at the last sync",
      checkedAt: thread.syncedAt,
      priority: attention === "waiting" ? 0 : attention === "failed" ? 1 : 3,
    });
  }
  for (const copy of copies) {
    if (copy.state === "released" || copy.registered === false) continue;
    if (copy.state === "failed" || copy.state === "missing") {
      items.push({
        id: copy.id,
        kind: "files",
        environmentId: copy.environmentId,
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
        environmentId: copy.environmentId,
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
        environmentId: copy.environmentId,
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
      kind: "resume",
      environmentId: resume.environmentId,
      title: resume.title,
      detail: "Continue your most recent conversation",
      checkedAt: resume.syncedAt,
      priority: 5,
    });
  return items.sort((a, b) => a.priority - b.priority || b.checkedAt.localeCompare(a.checkedAt));
}
