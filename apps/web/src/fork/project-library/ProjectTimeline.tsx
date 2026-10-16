import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_TIMELINE_FEATURE,
  type LibraryTimelineEntry,
  type LibraryTimelineKind,
} from "@t3tools/contracts/fork";
import {
  EMPTY_LIBRARY_TIMELINE_FEED,
  LIBRARY_TIMELINE_FILTER_LABELS,
  LIBRARY_TIMELINE_FILTERS,
  libraryPathParts,
  libraryTimelineEntryFailed,
  libraryTimelineEntryLink,
  libraryTimelineEntrySummary,
  libraryTimelineKinds,
  mergeLibraryTimelinePage,
  supportsLoomFeature,
  toggleLibraryTimelineFilter,
  type LibraryTimelineFilter,
  type LibraryTimelineLink,
} from "@t3tools/client-runtime/fork";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryErrorNotice, LibraryPanel } from "./LibraryControls";
import { projectLibrary } from "./state";

/** Entries per request. Small enough to arrive quickly, enough to fill the panel. */
const TIMELINE_PAGE = 30;

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
  const kinds = libraryTimelineKinds(filters);
  return (
    <LibraryPanel title="Timeline">
      <div
        role="group"
        aria-label="Show only"
        className="flex flex-wrap gap-1.5 border-t border-border px-3.5 py-2.5"
      >
        {LIBRARY_TIMELINE_FILTERS.map((filter) => (
          <Toggle
            key={filter}
            size="xs"
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
    </LibraryPanel>
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
  useEffect(() => {
    const page = newest.data;
    if (page) setFeed((current) => mergeLibraryTimelinePage(current, page));
  }, [newest.data]);
  useEffect(() => {
    const page = older.data;
    if (page && reading !== null)
      setFeed((current) => mergeLibraryTimelinePage(current, page, reading));
  }, [older.data, reading]);

  const cursor = feed.nextBefore;
  const loadingOlder = reading !== null && reading === cursor && older.isPending;
  const canReadOlder = typeof cursor === "number" && reading !== cursor;
  const readOlder = () => {
    if (typeof cursor === "number") setReading(cursor);
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Reading on as the end scrolls into view. Re-armed per cursor, so a short page that leaves
  // the end in view reads the next one too.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!canReadOlder || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setReading(cursor);
      },
      { root: scrollRef.current, rootMargin: "0px 0px 120px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canReadOlder, cursor]);

  if (cursor === undefined) {
    return (
      <div className="border-t border-border px-3.5 py-3">
        {newest.error ? (
          <LibraryErrorNotice error={newest.error} onRetry={newest.refresh} />
        ) : (
          <p role="status" className="text-xs text-muted-foreground">
            {connected ? "Loading timeline..." : "Connect your Library to see the timeline."}
          </p>
        )}
      </div>
    );
  }
  if (!feed.entries.length && cursor === null) {
    return (
      <p className="border-t border-border px-3.5 py-3 text-xs text-muted-foreground">
        {kinds ? "Nothing of these kinds yet." : "Nothing has happened in this project yet."}
      </p>
    );
  }
  return (
    <div ref={scrollRef} className="max-h-96 overflow-y-auto border-t border-border">
      {newest.error ? (
        <div className="px-3.5">
          <LibraryErrorNotice error={newest.error} onRetry={newest.refresh} />
        </div>
      ) : null}
      <ol className="space-y-1 px-3.5 py-2">
        {feed.entries.map((entry) => (
          <li key={entry.sequence}>
            <TimelineRow
              entry={entry}
              link={libraryTimelineEntryLink(entry, hostConnected)}
              hostLabel={hostLabel}
            />
          </li>
        ))}
      </ol>
      {cursor === null ? null : (
        <div ref={sentinelRef} className="px-3.5 pb-3">
          {older.error && reading === cursor ? (
            <LibraryErrorNotice error={older.error} onRetry={older.refresh} />
          ) : (
            <Button size="xs" variant="ghost" disabled={loadingOlder} onClick={readOlder}>
              {loadingOlder ? "Loading..." : "Show older"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineRow({
  entry,
  link,
  hostLabel,
}: {
  readonly entry: LibraryTimelineEntry;
  readonly link: LibraryTimelineLink | null;
  readonly hostLabel: (id: EnvironmentId) => string;
}) {
  const where = entry.environmentId ? hostLabel(entry.environmentId) : "Library";
  const folder = "copy" in entry ? libraryPathParts(entry.copy.rootPath).name : null;
  const when = formatRelativeTimeLabel(entry.at);
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          libraryTimelineEntryFailed(entry) ? "bg-warning" : "bg-muted-foreground/45",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-xs leading-relaxed">
          {libraryTimelineEntrySummary(entry)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[where, folder].filter(Boolean).join(" · ")}
          <span className="ms-1.5">{when}</span>
          {entry.approximate ? <span className="ms-1.5">estimated time</span> : null}
        </span>
      </span>
    </>
  );
  const row = "-mx-2 flex gap-2.5 rounded-lg px-2 py-1.5";
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
