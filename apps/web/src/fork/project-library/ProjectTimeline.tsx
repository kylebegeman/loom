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
  groupTimelineByDay,
  timelineNewestFirst,
} from "@t3tools/client-runtime/fork";
import { Link } from "@tanstack/react-router";
import {
  AlarmClockCheckIcon,
  ArchiveIcon,
  ArrowRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CpuIcon,
  FolderIcon,
  GitCommitHorizontalIcon,
  HardDriveDownloadIcon,
  HistoryIcon,
  LayersIcon,
  LibraryBigIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  MonitorXIcon,
  PencilLineIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryErrorNotice, LibrarySection } from "./LibraryControls";
import { ComputerLabel } from "./ProjectIdentity";
import { projectLibrary } from "./state";

/** Entries per request. Small enough to arrive quickly, enough to fill the page. */
const TIMELINE_PAGE = 30;
/** The overview's glance at what happened most recently. */
const PREVIEW_ENTRIES = 5;

type Capabilities = Parameters<typeof supportsLoomFeature>[0];

const FILTER_ICONS: Record<LibraryTimelineFilter, LucideIcon> = {
  conversations: MessageSquareIcon,
  "pull-requests": PullRequestGlyph.pullRequest,
  brief: PencilLineIcon,
  copies: HardDriveDownloadIcon,
  commits: GitCommitHorizontalIcon,
  runs: AlarmClockCheckIcon,
};

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
    <section aria-label="Timeline" className="@container/timeline flex min-w-0 flex-col gap-6">
      <div role="group" aria-label="Show only" className="flex flex-wrap gap-1.5">
        <Toggle
          size="segmented"
          shape="pill"
          variant="outline"
          pressed={!filters.length}
          onPressedChange={() => setFilters([])}
        >
          <LayersIcon />
          Everything
        </Toggle>
        {shown.map((filter) => {
          const Icon = FILTER_ICONS[filter];
          return (
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
              <Icon />
              {LIBRARY_TIMELINE_FILTER_LABELS[filter]}
            </Toggle>
          );
        })}
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
  className,
}: {
  readonly projectId: string;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly capabilities: Capabilities;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  readonly onShowAll: () => void;
  readonly className?: string;
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
  const entries = timelineNewestFirst(latest.data?.entries ?? []);
  return (
    <LibrarySection
      title="Lately"
      icon={HistoryIcon}
      className={cn("@container/timeline", className)}
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
        <TimelineList
          entries={entries}
          hostLabel={hostLabel}
          hostConnected={hostConnected}
          clock={false}
          plain
        />
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- intersection observer on the end sentinel that reads the next older page as it scrolls into view
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
    <div className="flex min-w-0 flex-col gap-8">
      <LibraryErrorNotice error={newest.error} onRetry={newest.refresh} />
      {groupTimelineByDay(feed.entries, now).map((day) => (
        <section
          key={day.key}
          aria-label={day.label}
          className="flex flex-col gap-1 @3xl/timeline:flex-row @3xl/timeline:gap-6"
        >
          <DayHeading label={day.label} detail={day.detail} entries={day.entries} />
          <TimelineList
            entries={day.entries}
            hostLabel={hostLabel}
            hostConnected={hostConnected}
            clock
          />
        </section>
      ))}
      {cursor === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground @3xl/timeline:ps-46">
          <span aria-hidden className="size-1.5 rounded-full bg-border" />
          That's everything since the project began.
        </p>
      ) : (
        <div ref={sentinelRef} className="@3xl/timeline:ps-46">
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

/**
 * A day's name and date, with how its events break down by kind. On a wide page it holds the
 * left of the day while its entries scroll past.
 */
function DayHeading({
  label,
  detail,
  entries,
}: {
  readonly label: string;
  readonly detail: string | null;
  readonly entries: readonly LibraryTimelineEntry[];
}) {
  const mix = new Map<LibraryTimelineKind, number>();
  for (const entry of entries) mix.set(entry.kind, (mix.get(entry.kind) ?? 0) + 1);
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5 @3xl/timeline:sticky @3xl/timeline:top-4 @3xl/timeline:w-40 @3xl/timeline:shrink-0 @3xl/timeline:flex-col @3xl/timeline:items-start @3xl/timeline:self-start">
      <div className="flex items-baseline gap-2 @3xl/timeline:flex-col @3xl/timeline:gap-0.5">
        <h3 className="text-sm font-semibold tracking-tight @3xl/timeline:text-lg">{label}</h3>
        <span className="text-xs text-muted-foreground">
          {detail ? `${detail} · ` : null}
          {entries.length === 1 ? "1 event" : `${entries.length} events`}
        </span>
      </div>
      <span aria-hidden className="flex flex-wrap gap-1">
        {[...mix].map(([kind, count]) => {
          const display = KIND_DISPLAY[kind];
          return (
            <span
              key={kind}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
                TONE_CLASSES[display.tone],
              )}
            >
              <display.icon className="size-3" />
              {count}
            </span>
          );
        })}
      </span>
    </header>
  );
}

type Tone = "project" | "success" | "warning" | "quiet";

const TONE_CLASSES: Record<Tone, string> = {
  project: "bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16",
  success: "bg-success/12 text-success-foreground",
  warning: "bg-warning/14 text-warning-foreground",
  quiet: "bg-muted text-muted-foreground dark:bg-accent",
};

/** The same inks without their fill, for icons that stand on their own. */
const TONE_INK: Record<Tone, string> = {
  project: "text-(--project-color)",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  quiet: "text-muted-foreground",
};

/** Starts, merges and new work carry the project's color; endings and removals stay quiet. */
const KIND_DISPLAY: Record<
  LibraryTimelineKind,
  { readonly icon: LucideIcon; readonly tone: Tone }
> = {
  "conversation-started": { icon: MessageSquarePlusIcon, tone: "project" },
  "conversation-settled": { icon: CircleCheckIcon, tone: "quiet" },
  "conversation-failed": { icon: CircleAlertIcon, tone: "warning" },
  "conversation-archived": { icon: ArchiveIcon, tone: "quiet" },
  "pull-request-linked": { icon: PullRequestGlyph.pullRequest, tone: "project" },
  "pull-request-merged": { icon: PullRequestGlyph.merged, tone: "success" },
  "pull-request-closed": { icon: PullRequestGlyph.closed, tone: "quiet" },
  "pull-request-checks-failed": { icon: CircleAlertIcon, tone: "warning" },
  "brief-revised": { icon: PencilLineIcon, tone: "project" },
  "brief-proposed": { icon: SparklesIcon, tone: "project" },
  "copy-added": { icon: HardDriveDownloadIcon, tone: "quiet" },
  "copy-released": { icon: MonitorXIcon, tone: "quiet" },
  "copy-failed": { icon: MonitorXIcon, tone: "warning" },
  commits: { icon: GitCommitHorizontalIcon, tone: "project" },
  "scheduled-run": { icon: AlarmClockCheckIcon, tone: "quiet" },
  "mini-job": { icon: CpuIcon, tone: "quiet" },
};

/**
 * Entries joined by a thin rail through their icons, so a day reads as one run of events. The
 * rail sits under the icon column, which moves right when the time of day leads each row.
 */
function TimelineList({
  entries,
  hostLabel,
  hostConnected,
  clock,
  plain = false,
}: {
  readonly entries: readonly LibraryTimelineEntry[];
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  readonly clock: boolean;
  /** Icons without their tinted discs, for previews that sit among plain lists. */
  readonly plain?: boolean;
}) {
  return (
    <ol className="min-w-0 flex-1">
      {entries.map((entry, index) => (
        <li key={entry.sequence} className="relative">
          {index < entries.length - 1 ? (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute top-10 -bottom-2 w-px -translate-x-1/2 bg-border",
                clock ? "start-[5.625rem]" : "start-3.5",
              )}
            />
          ) : null}
          <TimelineRow
            entry={entry}
            link={libraryTimelineEntryLink(entry, hostConnected)}
            hostLabel={hostLabel}
            clock={clock}
            plain={plain}
          />
        </li>
      ))}
    </ol>
  );
}

/** An estimated time reads as "~3:27 PM", with what the mark means one hover away. */
function EntryTime({
  approximate,
  children,
}: {
  readonly approximate: boolean | undefined;
  readonly children: string;
}) {
  if (!approximate) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>
        <span aria-hidden>~</span>
        <span className="sr-only">About </span>
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">Estimated time</TooltipPopup>
    </Tooltip>
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
  plain = false,
}: {
  readonly entry: LibraryTimelineEntry;
  readonly link: LibraryTimelineLink | null;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly clock?: boolean;
  readonly plain?: boolean;
}) {
  const folder = "copy" in entry ? libraryPathParts(entry.copy.rootPath).name : null;
  const display = KIND_DISPLAY[entry.kind];
  const tone = libraryTimelineEntryFailed(entry) ? "warning" : display.tone;
  const body = (
    <>
      {clock ? (
        <span className="w-16 shrink-0 pt-1.5 text-right text-xs tabular-nums text-muted-foreground">
          <EntryTime approximate={entry.approximate}>{formatClock(entry.at)}</EntryTime>
        </span>
      ) : null}
      <span
        aria-hidden
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center",
          plain ? TONE_INK[tone] : ["rounded-full ring-4 ring-background", TONE_CLASSES[tone]],
        )}
      >
        <display.icon className={plain ? "size-4" : "size-3.5"} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1 @3xl/timeline:flex-row @3xl/timeline:items-baseline @3xl/timeline:gap-6">
        <span className="min-w-0 break-words text-sm leading-snug font-medium @3xl/timeline:flex-1">
          {libraryTimelineEntrySummary(entry)}
        </span>
        <span className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground @3xl/timeline:shrink-0 @3xl/timeline:justify-end">
          {entry.environmentId ? (
            <ComputerLabel
              environmentId={entry.environmentId}
              label={hostLabel(entry.environmentId)}
              className="shrink"
            />
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <LibraryBigIcon aria-hidden className="size-3.5" />
              Library
            </span>
          )}
          {folder ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <FolderIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="max-w-40 truncate">{folder}</span>
            </span>
          ) : null}
          {clock ? null : (
            <span className="shrink-0 tabular-nums @3xl/timeline:w-14 @3xl/timeline:text-right">
              <EntryTime approximate={entry.approximate}>
                {formatRelativeTimeLabel(entry.at)}
              </EntryTime>
            </span>
          )}
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
