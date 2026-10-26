import type { ThreadId } from "@t3tools/contracts";
import type { LibraryReplicationStatus } from "@t3tools/contracts/fork";

export type LibraryThreadSaveState =
  | { readonly kind: "unsaved" }
  | {
      readonly kind: "behind";
      readonly reason: NonNullable<LibraryReplicationStatus["lastFailure"]>;
    };

/**
 * What a conversation's own view says about its Library copy. Only a conversation the Library
 * saves has an entry. A pending upload is normal for a few seconds after each milestone, so it
 * shows only while uploads are failing.
 */
export function libraryThreadSaveState(
  status: LibraryReplicationStatus | null | undefined,
  threadId: ThreadId,
): LibraryThreadSaveState | null {
  if (!status?.enabled) return null;
  const thread = status.threads.find((entry) => entry.threadId === threadId);
  if (thread === undefined) return null;
  if (thread.acknowledgedSequence === 0) return { kind: "unsaved" };
  if (thread.pending && status.lastFailure !== null)
    return { kind: "behind", reason: status.lastFailure };
  return null;
}

/** Polling stops for a conversation the Library does not save, or while saving is off. */
export const libraryThreadSaveStatusIsFinal = (status: LibraryReplicationStatus) =>
  !status.enabled || status.threads.length === 0;
