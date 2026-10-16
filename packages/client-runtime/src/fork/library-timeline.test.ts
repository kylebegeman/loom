import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { LibraryTimelineEntry, LibraryTimelinePage } from "@t3tools/contracts/fork";
import {
  EMPTY_LIBRARY_TIMELINE_FEED,
  libraryTimelineEntryFailed,
  libraryTimelineEntryLink,
  libraryTimelineEntrySummary,
  libraryTimelineFilters,
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

describe("timeline activity", () => {
  const base = {
    sequence: 1,
    at: "2026-10-10T00:00:00.000Z",
    environmentId: dorothy,
    copy: { id: "copy", rootPath: "/work/loom" },
  };
  const entry = (fields: object) => ({ ...base, ...fields }) as LibraryTimelineEntry;

  it("shows commit and run chips only for a Library that records them", () => {
    expect(libraryTimelineFilters(false)).not.toContain("runs");
    const shown = libraryTimelineFilters(true);
    expect(shown).toContain("commits");
    expect(libraryTimelineKinds(["runs"], shown)).toEqual(["scheduled-run", "mini-job"]);
    expect(libraryTimelineKinds(shown, shown)).toBeUndefined();
    // A chip a Library cannot fill never narrows what it is asked for.
    expect(libraryTimelineKinds(["runs"])).toBeUndefined();
  });

  it("says how many commits landed only when the computer counted them", () => {
    const commits = {
      kind: "commits",
      repository: { resourceId: "api", branch: "main" },
      from: "1".repeat(40),
      to: "abcdef0123456789abcdef0123456789abcdef01",
    };
    expect(libraryTimelineEntrySummary(entry({ ...commits, count: 3 }))).toBe(
      "3 new commits on main",
    );
    expect(libraryTimelineEntrySummary(entry({ ...commits, count: 1 }))).toBe(
      "1 new commit on main",
    );
    expect(libraryTimelineEntrySummary(entry(commits))).toBe("main moved to abcdef0");
    expect(
      libraryTimelineEntrySummary(entry({ ...commits, repository: { resourceId: "api" } })),
    ).toBe("The checkout moved to abcdef0");
  });

  it("names finished runs and marks the ones that broke", () => {
    const run = (status: string) =>
      entry({
        kind: "scheduled-run",
        run: { taskId: "task", title: " Nightly ", status, startedAt: base.at },
      });
    expect(libraryTimelineEntrySummary(run("succeeded"))).toBe('Scheduled run "Nightly" finished');
    expect(libraryTimelineEntrySummary(run("failed"))).toBe('Scheduled run "Nightly" failed');
    expect(libraryTimelineEntryFailed(run("failed"))).toBe(true);
    expect(libraryTimelineEntryFailed(run("succeeded"))).toBe(false);

    const job = (fields: object) =>
      entry({
        kind: "mini-job",
        job: { requestId: "job", label: "Unit tests", workerName: "studio", ...fields },
      });
    expect(libraryTimelineEntrySummary(job({ status: "succeeded" }))).toBe(
      'Mini job "Unit tests" on studio succeeded',
    );
    expect(libraryTimelineEntrySummary(job({ status: "failed", exitCode: 2 }))).toBe(
      'Mini job "Unit tests" on studio failed with exit code 2',
    );
    expect(
      libraryTimelineEntrySummary(
        job({ status: "failed", exitCode: 2, summary: "3 tests failed" }),
      ),
    ).toBe('Mini job "Unit tests" on studio failed: 3 tests failed');
    expect(libraryTimelineEntryFailed(job({ status: "interrupted" }))).toBe(true);
    expect(libraryTimelineEntryFailed(job({ status: "cancelled" }))).toBe(false);
    // Neither a run nor a job has a conversation saved to open.
    expect(libraryTimelineEntryLink(job({ status: "failed" }), () => true)).toBeNull();
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
