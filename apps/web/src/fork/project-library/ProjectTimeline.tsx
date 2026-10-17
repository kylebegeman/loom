import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_TIMELINE_ACTIVITY_FEATURE,
  LIBRARY_TIMELINE_FEATURE,
  type LibraryTimelineEntry,
  type LibraryTimelineKind,
} from "@t3tools/contracts/fork";
import {
  EMPTY_LIBRARY_TIMELINE_FEED,
  LIBRARY_TIMELINE_FILTER_LABELS,
  libraryPathParts,
  libraryTimelineEntryFailed,
  libraryTimelineEntryLink,
  libraryTimelineEntrySummary,
  libraryTimelineFilters,
  libraryTimelineKinds,
  mergeLibraryTimelinePage,
  supportsLoomFeature,
  toggleLibraryTimelineFilter,
  type LibraryTimelineFilter,
  type LibraryTimelineLink,
} from "@t3tools/client-runtime/fork";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryErrorNotice, LibrarySection } from "./LibraryControls";
import { projectLibrary } from "./state";
import { groupTimelineByDay } from "./timelineDays";

/** Entries per request. Small enough to arrive quickly, enough to fill the page. */
const TIMELINE_PAGE = 30;
/** The overview's glance at what happened most recently. */
const PREVIEW_ENTRIES = 5;

type Capabilities = Parameters<typeof supportsLoomFeature>[0];

/**
 * What happened on the project, from every computer, as the Library recorded it. A Library
 * that does not keep a timeline yet gets `fallback`, the history derived from its copies.
 */
export function ProjectTimeline({
  projectId,
  authorityId,
  connected,
  capabilities,
  hostLabel,
  hostConnected,
  fallback,
}: {
  readonly projectId: string;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly capabilities: Capabilities;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  readonly fallback: ReactNode;
}) {
  const [filters, setFilters] = useState<readonly LibraryTimelineFilter[]>([]);
  if (!supportsLoomFeature(capabilities, LIBRARY_TIMELINE_FEATURE)) return fallback;
  // Commits and runs chips appear only for a Library that records them.
  const shown = libraryTimelineFilters(
    supportsLoomFeature(capabilities, LIBRARY_TIMELINE_ACTIVITY_FEATURE),
  );
  const kinds = libraryTimelineKinds(filters, shown);
  return (
    <section aria-label="Timeline" className="flex min-w-0 flex-col gap-5">
      <div role="group" aria-label="Show only" className="flex flex-wrap gap-1.5">
        {shown.map((filter) => (
          <Toggle
            key={filter}
            size="segmented"
            shape="pill"
            variant="outline"
            pressed={filters.includes(filter)}
            onPressedChange={() =>
              setFilters((current) => toggleLibraryTimelineFilter(current, filter))
            }
          >
            {LIBRARY_TIMELINE_FILTER_LABELS[filter]}
          </Toggle>
        ))}
      </div>
      {/* A new choice of kinds starts reading from the newest entry again. */}
      <TimelineFeed
        key={kinds?.join(",") ?? "all"}
        projectId={projectId}
        authorityId={authorityId}
        connected={connected}
        kinds={kinds}
        hostLabel={hostLabel}
        hostConnected={hostConnected}
      />
    </section>
  );
}

/** The newest few entries, for the overview. Renders nothing for a Library without a timeline. */
export function TimelinePreview({
  projectId,
  authorityId,
  connected,
  capabilities,
  hostLabel,
  hostConnected,
  onShowAll,
}: {
  readonly projectId: string;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly capabilities: Capabilities;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  readonly onShowAll: () => void;
}) {
  const supported = supportsLoomFeature(capabilities, LIBRARY_TIMELINE_FEATURE);
  const latest = useEnvironmentQuery(
    supported
      ? projectLibrary.timeline({
          environmentId: authorityId,
          input: { projectId, limit: PREVIEW_ENTRIES },
        })
      : null,
  );
  if (!supported) return null;
  const entries = latest.data?.entries ?? [];
  return (
    <LibrarySection
      title="Lately"
      action={
        entries.length ? (
          <Button shape="pill" size="xs" variant="ghost" onClick={onShowAll}>
            Full timeline
            <ArrowRightIcon />
          </Button>
        ) : null
      }
    >
      <LibraryErrorNotice error={latest.error} onRetry={latest.refresh} />
      {entries.length ? (
        <ol>
          {entries.map((entry) => (
            <li key={entry.sequence}>
              <TimelineRow
                entry={entry}
                link={libraryTimelineEntryLink(entry, hostConnected)}
                hostLabel={hostLabel}
              />
            </li>
          ))}
        </ol>
      ) : latest.error ? null : latest.data ? (
        <p className="text-xs text-muted-foreground">Nothing has happened in this project yet.</p>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {connected ? "Loading timeline..." : "Connect your Library to see the timeline."}
        </p>
      )}
    </LibrarySection>
  );
}

function TimelineFeed({
  projectId,
  authorityId,
  connected,
  kinds,
  hostLabel,
  hostConnected,
}: {
  readonly projectId: string;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly kinds: readonly LibraryTimelineKind[] | undefined;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
}) {
  const input = { projectId, limit: TIMELINE_PAGE, ...(kinds ? { kinds } : {}) };
  const [feed, setFeed] = useState(EMPTY_LIBRARY_TIMELINE_FEED);
  // The cursor of the older page being read, if any. One page at a time.
  const [reading, setReading] = useState<number | null>(null);
  const newest = useEnvironmentQuery(
    projectLibrary.timeline({ environmentId: authorityId, input }),
  );
  const older = useEnvironmentQuery(
    reading === null
      ? null
      : projectLibrary.timeline({
          environmentId: authorityId,
          input: { ...input, before: reading },
        }),
  );
  // Each page merges once, while rendering, as it arrives.
  const newestPage = newest.data;
  const [mergedNewest, setMergedNewest] = useState<typeof newestPage>(null);
  if (newestPage !== mergedNewest) {
    setMergedNewest(newestPage);
    if (newestPage) setFeed((current) => mergeLibraryTimelinePage(current, newestPage));
  }
  const olderPage = older.data;
  const [mergedOlder, setMergedOlder] = useState<{
    page: typeof olderPage;
    reading: typeof reading;
  }>({ page: null, reading: null });
  if (olderPage !== mergedOlder.page || reading !== mergedOlder.reading) {
    setMergedOlder({ page: olderPage, reading });
    if (olderPage && reading !== null)
      setFeed((current) => mergeLibraryTimelinePage(current, olderPage, reading));
  }

  const cursor = feed.nextBefore;
  const loadingOlder = reading !== null && reading === cursor && older.isPending;
  const canReadOlder = typeof cursor === "number" && reading !== cursor;
  const readOlder = () => {
    if (typeof cursor === "number") setReading(cursor);
  };
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Reading on as the end scrolls into view of the page. Re-armed per cursor, so a short page
  // that leaves the end in view reads the next one too.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!canReadOlder || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setReading(cursor);
      },
      { rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canReadOlder, cursor]);
  // Read once per visit, so day names stay pure while rendering.
  const [now] = useState(() => new Date());

  if (cursor === undefined) {
    return newest.error ? (
      <LibraryErrorNotice error={newest.error} onRetry={newest.refresh} />
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        {connected ? "Loading timeline..." : "Connect your Library to see the timeline."}
      </p>
    );
  }
  if (!feed.entries.length && cursor === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {kinds ? "Nothing of these kinds yet." : "Nothing has happened in this project yet."}
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <LibraryErrorNotice error={newest.error} onRetry={newest.refresh} />
      {groupTimelineByDay(feed.entries, now).map((day) => (
        <section key={day.key} aria-label={day.label} className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">{day.label}</h3>
          <ol>
            {day.entries.map((entry) => (
              <li key={entry.sequence}>
                <TimelineRow
                  entry={entry}
                  link={libraryTimelineEntryLink(entry, hostConnected)}
                  hostLabel={hostLabel}
                  clock
                />
              </li>
            ))}
          </ol>
        </section>
      ))}
      {cursor === null ? (
        <p className="text-xs text-muted-foreground">That's everything since the project began.</p>
      ) : (
        <div ref={sentinelRef}>
          {older.error && reading === cursor ? (
            <LibraryErrorNotice error={older.error} onRetry={older.refresh} />
          ) : (
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              disabled={loadingOlder}
              onClick={readOlder}
            >
              {loadingOlder ? "Loading..." : "Show older"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * One thing that happened. Under a day heading the time of day leads; on its own the row says
 * how long ago instead.
 */
function TimelineRow({
  entry,
  link,
  hostLabel,
  clock = false,
}: {
  readonly entry: LibraryTimelineEntry;
  readonly link: LibraryTimelineLink | null;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly clock?: boolean;
}) {
  const where = entry.environmentId ? hostLabel(entry.environmentId) : "Library";
  const folder = "copy" in entry ? libraryPathParts(entry.copy.rootPath).name : null;
  const body = (
    <>
      {clock ? (
        <span className="w-16 shrink-0 pt-px text-xs tabular-nums text-muted-foreground">
          {formatClock(entry.at)}
        </span>
      ) : null}
      <span
        aria-hidden
        className={cn(
          "mt-2 size-1.5 shrink-0 rounded-full",
          libraryTimelineEntryFailed(entry) ? "bg-warning" : "bg-muted-foreground/45",
        )}
      />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block break-words text-sm leading-snug">
          {libraryTimelineEntrySummary(entry)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[where, folder].filter(Boolean).join(" · ")}
          {clock ? null : <span className="ms-1.5">{formatRelativeTimeLabel(entry.at)}</span>}
          {entry.approximate ? <span className="ms-1.5">estimated time</span> : null}
        </span>
      </span>
    </>
  );
  const row = "-mx-2.5 flex gap-3 rounded-lg px-2.5 py-2";
  const linked = `${row} outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`;
  switch (link?.kind) {
    case "pull-request":
      return (
        <a href={link.url} target="_blank" rel="noopener noreferrer" className={linked}>
          {body}
        </a>
      );
    case "thread":
      return (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId: link.environmentId, threadId: link.threadId }}
          className={linked}
        >
          {body}
        </Link>
      );
    case "conversation":
      return (
        <Link
          to="/library/conversations/$conversationId"
          params={{ conversationId: link.conversationId }}
          className={linked}
        >
          {body}
        </Link>
      );
    case undefined:
      return <div className={row}>{body}</div>;
  }
}
