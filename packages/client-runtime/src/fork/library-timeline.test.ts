import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { LibraryTimelineEntry, LibraryTimelinePage } from "@t3tools/contracts/fork";
import {
  EMPTY_LIBRARY_TIMELINE_FEED,
  libraryTimelineEntryLink,
  libraryTimelineKinds,
  mergeLibraryTimelinePage,
  toggleLibraryTimelineFilter,
} from "./library-timeline.ts";

const dorothy = EnvironmentId.make("dorothy");
const conversation = { id: "conv-1", threadId: ThreadId.make("thread-1"), title: "Fix login" };
const started = (sequence: number, environmentId: EnvironmentId | null = dorothy) =>
  ({
    sequence,
    at: "2026-10-10T00:00:00.000Z",
    environmentId,
    kind: "conversation-started",
    conversation,
  }) as LibraryTimelineEntry;
const pullRequest = (url: string) =>
  ({
    sequence: 1,
    at: "2026-10-10T00:00:00.000Z",
    environmentId: dorothy,
    kind: "pull-request-merged",
    conversation,
    pullRequest: { url, repository: "kylebegeman/loom", number: 12, title: null },
  }) as LibraryTimelineEntry;
const page = (sequences: readonly number[], nextBefore: number | null): LibraryTimelinePage => ({
  entries: sequences.map((sequence) => started(sequence)),
  nextBefore,
});
const sequences = (feed: { readonly entries: readonly LibraryTimelineEntry[] }) =>
  feed.entries.map((entry) => entry.sequence);

describe("library timeline filters", () => {
  it("asks for everything when no chip or every chip is on", () => {
    expect(libraryTimelineKinds([])).toBeUndefined();
    expect(
      libraryTimelineKinds(["copies", "brief", "pull-requests", "conversations"]),
    ).toBeUndefined();
  });

  it("asks for the chosen kinds in the same order however the chips were picked", () => {
    const one = toggleLibraryTimelineFilter(toggleLibraryTimelineFilter([], "copies"), "brief");
    const other = toggleLibraryTimelineFilter(toggleLibraryTimelineFilter([], "brief"), "copies");
    expect(libraryTimelineKinds(one)).toEqual(libraryTimelineKinds(other));
    expect(libraryTimelineKinds(one)).toEqual([
      "brief-revised",
      "brief-proposed",
      "copy-added",
      "copy-released",
      "copy-failed",
    ]);
    expect(toggleLibraryTimelineFilter(one, "brief")).toEqual(["copies"]);
  });
});

describe("mergeLibraryTimelinePage", () => {
  it("pages older entries from the cursor until the start of the project", () => {
    const first = mergeLibraryTimelinePage(EMPTY_LIBRARY_TIMELINE_FEED, page([9, 8], 8));
    const second = mergeLibraryTimelinePage(first, page([5, 4], 4), 8);
    const last = mergeLibraryTimelinePage(second, page([2], null), 4);
    expect(sequences(last)).toEqual([9, 8, 5, 4, 2]);
    expect(last.nextBefore).toBeNull();
  });

  it("keeps entries that slid off a refreshed newest page, so paging leaves no gap", () => {
    const first = mergeLibraryTimelinePage(EMPTY_LIBRARY_TIMELINE_FEED, page([9, 8], 8));
    const older = mergeLibraryTimelinePage(first, page([5, 4], 4), 8);
    // Two new events push 9 and 8 off the newest page while older pages are already shown.
    const refreshed = mergeLibraryTimelinePage(older, page([12, 11], 11));
    expect(sequences(refreshed)).toEqual([12, 11, 9, 8, 5, 4]);
    expect(refreshed.nextBefore).toBe(4);
  });

  it("ignores a page read with a stale cursor and a page folded twice", () => {
    const first = mergeLibraryTimelinePage(EMPTY_LIBRARY_TIMELINE_FEED, page([9, 8], 8));
    const older = mergeLibraryTimelinePage(first, page([5, 4], 4), 8);
    expect(mergeLibraryTimelinePage(older, page([5, 4], 4), 8)).toBe(older);
    expect(mergeLibraryTimelinePage(older, page([9, 8], 8))).toBe(older);
  });

  it("records an empty project as finished rather than still loading", () => {
    const feed = mergeLibraryTimelinePage(EMPTY_LIBRARY_TIMELINE_FEED, page([], null));
    expect(feed).toEqual({ entries: [], nextBefore: null });
  });
});

describe("libraryTimelineEntryLink", () => {
  const connected = (id: EnvironmentId) => id === dorothy;

  it("opens the live thread while its computer is connected", () => {
    expect(libraryTimelineEntryLink(started(1), connected)).toEqual({
      kind: "thread",
      environmentId: dorothy,
      threadId: "thread-1",
    });
  });

  it("opens the saved conversation for an offline computer or a Library change", () => {
    const offline = EnvironmentId.make("toto");
    expect(libraryTimelineEntryLink(started(1, offline), connected)).toEqual({
      kind: "conversation",
      conversationId: "conv-1",
    });
    expect(libraryTimelineEntryLink(started(1, null), connected)).toEqual({
      kind: "conversation",
      conversationId: "conv-1",
    });
  });

  it("opens the pull request, and never a link that is not a web address", () => {
    expect(
      libraryTimelineEntryLink(
        pullRequest("https://github.com/kylebegeman/loom/pull/12"),
        connected,
      ),
    ).toEqual({ kind: "pull-request", url: "https://github.com/kylebegeman/loom/pull/12" });
    expect(libraryTimelineEntryLink(pullRequest("javascript:alert(1)"), connected)).toEqual({
      kind: "thread",
      environmentId: dorothy,
      threadId: "thread-1",
    });
  });

  it("leaves brief and copy entries unlinked", () => {
    const copy = {
      sequence: 1,
      at: "2026-10-10T00:00:00.000Z",
      environmentId: dorothy,
      kind: "copy-added",
      copy: { id: "copy", rootPath: "/work/loom" },
    } as LibraryTimelineEntry;
    expect(libraryTimelineEntryLink(copy, connected)).toBeNull();
  });
});
