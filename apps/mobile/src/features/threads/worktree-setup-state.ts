import type { ThreadId, WorktreeSetupSnapshot } from "@t3tools/contracts";
import { worktreeSetupAgentStarted } from "@t3tools/client-runtime/worktree-setup";

/** A subscription can close or replay an older value during the setup handoff. */
export function resolveWorktreeSetupSnapshot(
  threadId: ThreadId | null,
  latest: WorktreeSetupSnapshot | null | undefined,
  held: WorktreeSetupSnapshot | null,
): WorktreeSetupSnapshot | null {
  const current = latest?.threadId === threadId ? latest : null;
  const previous = held?.threadId === threadId ? held : null;
  return current && (!previous || current.sequence >= previous.sequence) ? current : previous;
}

/**
 * Library project files fill in after the conversation opens, and the computer holds the first
 * message until they arrive, so only a worktree setup holds back Send and Stop.
 */
export function worktreeSetupBlocksSend(snapshot: WorktreeSetupSnapshot): boolean {
  return (
    snapshot.phase === "running" &&
    snapshot.kind !== "project-files" &&
    !worktreeSetupAgentStarted(snapshot)
  );
}
