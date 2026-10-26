import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryTimelineEntry,
  LibraryTimelineKind,
  LibraryTimelinePage,
} from "@t3tools/contracts/fork";

/** Filter chips group the timeline's kinds the way a person thinks about them. */
const LIBRARY_TIMELINE_FILTERS = [
  "conversations",
  "pull-requests",
  "brief",
  "copies",
  "commits",
  "runs",
] as const;
export type LibraryTimelineFilter = (typeof LIBRARY_TIMELINE_FILTERS)[number];

/** Chips for kinds only a Library with `library-timeline-activity` records. */
const ACTIVITY_FILTERS: ReadonlySet<LibraryTimelineFilter> = new Set(["commits", "runs"]);

/** The chips a Library can fill: activity chips only when it records commits and runs. */
export function libraryTimelineFilters(activity: boolean): readonly LibraryTimelineFilter[] {
  return activity
    ? LIBRARY_TIMELINE_FILTERS
    : LIBRARY_TIMELINE_FILTERS.filter((filter) => !ACTIVITY_FILTERS.has(filter));
}

export const LIBRARY_TIMELINE_FILTER_LABELS: Record<LibraryTimelineFilter, string> = {
  conversations: "Conversations",
  "pull-requests": "Pull requests",
  brief: "Brief",
  copies: "Copies",
  commits: "Commits",
  runs: "Runs",
};

const FILTER_KINDS: Record<LibraryTimelineFilter, readonly LibraryTimelineKind[]> = {
  conversations: [
    "conversation-started",
    "conversation-settled",
    "conversation-failed",
    "conversation-archived",
  ],
  "pull-requests": [
    "pull-request-linked",
    "pull-request-merged",
    "pull-request-closed",
    "pull-request-checks-failed",
  ],
  brief: ["brief-revised", "brief-proposed"],
  copies: ["copy-added", "copy-released", "copy-failed"],
  commits: ["commits"],
  runs: ["scheduled-run", "mini-job"],
};

/** Turns a chip on or off, keeping the chips' own order so equal choices make equal requests. */
export function toggleLibraryTimelineFilter(
  filters: readonly LibraryTimelineFilter[],
  filter: LibraryTimelineFilter,
): readonly LibraryTimelineFilter[] {
  const next = new Set(filters);
  if (next.has(filter)) next.delete(filter);
  else next.add(filter);
  return LIBRARY_TIMELINE_FILTERS.filter((entry) => next.has(entry));
}

/**
 * The request's `kinds`, or undefined for everything when no chip (or every shown chip) is on.
 * `shown` is the chips on screen, from `libraryTimelineFilters`, so a chip the Library cannot
 * fill never narrows a request. It defaults to a Library without timeline activity.
 */
export function libraryTimelineKinds(
  filters: readonly LibraryTimelineFilter[],
  shown: readonly LibraryTimelineFilter[] = libraryTimelineFilters(false),
): readonly LibraryTimelineKind[] | undefined {
  const chosen = shown.filter((filter) => filters.includes(filter));
  if (chosen.length === 0 || chosen.length === shown.length) return undefined;
  return chosen.flatMap((filter) => FILTER_KINDS[filter]);
}

/**
 * Entries read so far, newest first, and the cursor for the next older page. `nextBefore` is
 * undefined until the newest page arrives and null once the start of the project is reached.
 */
export type LibraryTimelineFeed = {
  readonly entries: readonly LibraryTimelineEntry[];
  readonly nextBefore: number | null | undefined;
};

export const EMPTY_LIBRARY_TIMELINE_FEED: LibraryTimelineFeed = {
  entries: [],
  nextBefore: undefined,
};

/**
 * Folds a page into the feed; omit `before` for the newest page, which refreshes as the Library
 * hears of new events. Entries are kept by sequence and never dropped, so paging never gaps or
 * repeats a row. Only the newest page's first read and older pages move the cursor; other pages are
 * stale and ignored. Returns the same feed when nothing changed.
 */
export function mergeLibraryTimelinePage(
  feed: LibraryTimelineFeed,
  page: LibraryTimelinePage,
  before?: number,
): LibraryTimelineFeed {
  const head = before === undefined;
  if (!head && before !== feed.nextBefore) return feed;
  const nextBefore = head && feed.nextBefore !== undefined ? feed.nextBefore : page.nextBefore;
  const known = new Set(feed.entries.map((entry) => entry.sequence));
  const added = page.entries.filter((entry) => !known.has(entry.sequence));
  if (!added.length && nextBefore === feed.nextBefore) return feed;
  const entries = added.length
    ? [...feed.entries, ...added].sort((a, b) => b.sequence - a.sequence)
    : feed.entries;
  return { entries, nextBefore };
}

export type LibraryTimelineLink =
  | { readonly kind: "pull-request"; readonly url: string }
  | {
      readonly kind: "thread";
      readonly environmentId: EnvironmentId;
      readonly threadId: string;
    }
  | { readonly kind: "conversation"; readonly conversationId: string };

/**
 * Where an entry leads: its pull request, the live thread while that thread's computer is
 * connected, or else the conversation as the Library saved it. Brief and copy entries describe
 * the page they sit on and lead nowhere.
 */
export function libraryTimelineEntryLink(
  entry: LibraryTimelineEntry,
  isConnected: (environmentId: EnvironmentId) => boolean,
): LibraryTimelineLink | null {
  switch (entry.kind) {
    case "pull-request-linked":
    case "pull-request-merged":
    case "pull-request-closed":
    case "pull-request-checks-failed": {
      // Pull request URLs arrive from other computers, so only web links become links.
      const url = webUrl(entry.pullRequest.url);
      if (url) return { kind: "pull-request", url };
      return conversationLink(entry.environmentId, entry.conversation, isConnected);
    }
    case "conversation-started":
    case "conversation-settled":
    case "conversation-failed":
    case "conversation-archived":
      return conversationLink(entry.environmentId, entry.conversation, isConnected);
    case "brief-revised":
    case "brief-proposed":
    case "copy-added":
    case "copy-released":
    case "copy-failed":
    case "commits":
    case "scheduled-run":
    case "mini-job":
      return null;
  }
}

function conversationLink(
  environmentId: EnvironmentId | null,
  conversation: { readonly id: string; readonly threadId: string },
  isConnected: (environmentId: EnvironmentId) => boolean,
): LibraryTimelineLink {
  return environmentId && isConnected(environmentId)
    ? { kind: "thread", environmentId, threadId: conversation.threadId }
    : { kind: "conversation", conversationId: conversation.id };
}

function webUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** One line saying what happened. Who and where sit beside it. */
export function libraryTimelineEntrySummary(entry: LibraryTimelineEntry) {
  switch (entry.kind) {
    case "conversation-started":
      return `Started ${quoted(entry.conversation.title)}`;
    case "conversation-settled":
      return `Settled ${quoted(entry.conversation.title)}`;
    case "conversation-failed":
      return `${quoted(entry.conversation.title)} failed`;
    case "conversation-archived":
      return `Archived ${quoted(entry.conversation.title)}`;
    case "pull-request-linked":
      return `Opened ${pullRequestName(entry.pullRequest)}`;
    case "pull-request-merged":
      return `Merged ${pullRequestName(entry.pullRequest)}`;
    case "pull-request-closed":
      return `Closed ${pullRequestName(entry.pullRequest)}`;
    case "pull-request-checks-failed":
      return `Checks failed on ${pullRequestName(entry.pullRequest)}`;
    case "brief-revised":
      return `Brief revised to revision ${entry.revision}`;
    case "brief-proposed":
      return entry.summary.trim()
        ? `Brief update suggested: ${entry.summary}`
        : "Brief update suggested";
    case "copy-added":
      return "Copy added";
    case "copy-released":
      return "Copy removed";
    case "copy-failed":
      return "Copy failed";
    case "commits": {
      const branch = entry.repository.branch?.trim() || "The checkout";
      // Without a count the head may have moved by a rewrite, so it says only where it went.
      if (entry.count === undefined) return `${branch} moved to ${shortCommit(entry.to)}`;
      const commits = entry.count === 1 ? "1 new commit" : `${entry.count} new commits`;
      return entry.repository.branch?.trim() ? `${commits} on ${branch}` : commits;
    }
    case "scheduled-run": {
      const run = `Scheduled run ${named(entry.run.title)}`;
      return entry.run.status === "failed" ? `${run} failed` : `${run} finished`;
    }
    case "mini-job": {
      const worker = entry.job.workerName?.trim();
      const job = `Mini job ${named(entry.job.label)}${worker ? ` on ${worker}` : ""}`;
      switch (entry.job.status) {
        case "succeeded":
          return `${job} succeeded`;
        case "cancelled":
          return `${job} was cancelled`;
        case "interrupted":
          return `${job} was interrupted`;
        case "failed": {
          const summary = entry.job.summary?.trim();
          if (summary) return `${job} failed: ${summary}`;
          return entry.job.exitCode === undefined
            ? `${job} failed`
            : `${job} failed with exit code ${entry.job.exitCode}`;
        }
      }
    }
  }
}

/** Kinds worth a second look: something broke. */
export function libraryTimelineEntryFailed(entry: LibraryTimelineEntry) {
  return (
    entry.kind === "conversation-failed" ||
    entry.kind === "pull-request-checks-failed" ||
    entry.kind === "copy-failed" ||
    (entry.kind === "scheduled-run" && entry.run.status === "failed") ||
    (entry.kind === "mini-job" &&
      (entry.job.status === "failed" || entry.job.status === "interrupted"))
  );
}

function named(title: string) {
  return title.trim() ? `"${title.trim()}"` : "without a name";
}

function shortCommit(commit: string) {
  return commit.slice(0, 7);
}

function quoted(title: string) {
  return title.trim() ? `"${title.trim()}"` : "a conversation";
}

function pullRequestName(pullRequest: {
  readonly repository: string;
  readonly number: number;
  readonly title: string | null;
}) {
  const reference = `${pullRequest.repository}#${pullRequest.number}`;
  return pullRequest.title?.trim() ? `${reference} ${pullRequest.title.trim()}` : reference;
}
