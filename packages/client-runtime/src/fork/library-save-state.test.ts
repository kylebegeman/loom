import { ThreadId } from "@t3tools/contracts";
import type { LibraryReplicationStatus } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { libraryThreadSaveState, libraryThreadSaveStatusIsFinal } from "./library-save-state.ts";

const threadId = ThreadId.make("thread");
const statusWith = (
  thread: Partial<LibraryReplicationStatus["threads"][number]> | null,
  lastFailure: LibraryReplicationStatus["lastFailure"] = null,
): LibraryReplicationStatus => ({
  enabled: true,
  journalId: "journal",
  acknowledgedSequence: 4,
  pendingEntries: 0,
  lastFailure,
  threads:
    thread === null
      ? []
      : [
          {
            threadId,
            queuedSequence: 4,
            acknowledgedSequence: 4,
            currentSequence: 4,
            pending: false,
            ...thread,
          },
        ],
});

describe("libraryThreadSaveState", () => {
  it("says nothing for a conversation the Library does not save", () => {
    expect(libraryThreadSaveState(statusWith(null), threadId)).toBeNull();
    expect(libraryThreadSaveState({ ...statusWith({}), enabled: false }, threadId)).toBeNull();
    expect(libraryThreadSaveStatusIsFinal(statusWith(null))).toBe(true);
  });

  it("flags a saved conversation the Library has not received yet", () => {
    const status = statusWith({ queuedSequence: 0, acknowledgedSequence: 0, pending: true });
    expect(libraryThreadSaveState(status, threadId)).toEqual({ kind: "unsaved" });
    expect(libraryThreadSaveStatusIsFinal(status)).toBe(false);
  });

  it("flags pending work only while uploads are failing", () => {
    expect(libraryThreadSaveState(statusWith({ pending: true }), threadId)).toBeNull();
    expect(libraryThreadSaveState(statusWith({ pending: true }, "io"), threadId)).toEqual({
      kind: "behind",
      reason: "io",
    });
    expect(libraryThreadSaveState(statusWith({}, "io"), threadId)).toBeNull();
  });
});
