import { threadRuntimeIsActive, type EnvironmentThreadShell } from "../state/models.ts";

// A Library start creates its conversation before the first message, because binding the files
// needs the thread. Only starts made on this client in this session are offered for discarding:
// an empty conversation from anywhere else was kept on purpose.
const startedHere = new Set<string>();

/** Records a conversation this client just started from the Library, by scoped thread key. */
export function markLibraryConversationStarted(threadKey: string): void {
  startedHere.add(threadKey);
}

/**
 * Whether leaving `threadKey` should offer to discard it: it was started here from the Library and
 * nothing was sent or run in it. Each start is considered once, so a kept conversation is never
 * offered again.
 */
export function takeEmptyLibraryConversation(
  threadKey: string,
  shell: Pick<EnvironmentThreadShell, "itemCount" | "latestRun" | "runtime" | "archivedAt"> | null,
): boolean {
  if (!startedHere.delete(threadKey) || shell === null) return false;
  return (
    shell.archivedAt === null &&
    shell.itemCount === 0 &&
    shell.latestRun === null &&
    !threadRuntimeIsActive(shell.runtime)
  );
}
