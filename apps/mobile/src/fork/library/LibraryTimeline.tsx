import { LegendList } from "@legendapp/list/react-native";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  EMPTY_LIBRARY_TIMELINE_FEED,
  LIBRARY_TIMELINE_FILTER_LABELS,
  groupTimelineByDay,
  libraryPathParts,
  libraryProjectColor,
  libraryTimelineEntryFailed,
  libraryTimelineEntryLink,
  libraryTimelineEntrySummary,
  libraryTimelineFilters,
  libraryTimelineKinds,
  mergeLibraryTimelinePage,
  supportsLoomFeature,
  toggleLibraryTimelineFilter,
  type LibraryTimelineFilter,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_TIMELINE_ACTIVITY_FEATURE,
  LIBRARY_TIMELINE_FEATURE,
  type LibraryTimelineEntry,
  type LibraryTimelineKind,
} from "@t3tools/contracts/fork";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useScaledTextRole } from "../../features/settings/appearance/useScaledTextRole";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useEnvironmentQuery } from "../../state/query";
import { LibraryNotice, LibraryPage } from "./LibraryScreens";
import { useLibraryProjectColorValue } from "./libraryProjectColors";
import { library } from "./libraryState";
import { useLibraryActivity, useOpenLibraryTimelineLink } from "./useLibraryActivity";

/** Entries per request. Small enough to arrive quickly, enough to fill the screen. */
const TIMELINE_PAGE = 30;
/** The project screen's glance at what happened most recently. */
const PREVIEW_ENTRIES = 5;
/** The time column's width in multiples of its font size, enough for "~12:00 PM" on one line. */
const TIME_COLUMN_EMS = 5.5;
/** From this system text scale the time joins the detail line, as list rows stack their detail. */
const STACK_TIME_FONT_SCALE = 1.5;

/** Shared by the route and the feeds, so an offline Library reads the same wherever it shows. */
const timelineOfflineDetail = (label: string) =>
  `Library offline. Reconnect ${label} to see the timeline.`;

const FILTER_ICONS: Record<LibraryTimelineFilter, AppSymbolName> = {
  conversations: "text.bubble",
  "pull-requests": "arrow.triangle.pull",
  brief: "pencil",
  copies: "internaldrive",
  commits: "git.commit",
  runs: "clock",
};

type Tone = "project" | "success" | "warning" | "quiet";

/** Starts, merges and new work carry the project's color; endings and removals stay quiet. */
const KIND_DISPLAY: Record<
  LibraryTimelineKind,
  { readonly icon: AppSymbolName; readonly tone: Tone }
> = {
  "conversation-started": { icon: "plus.bubble", tone: "project" },
  "conversation-settled": { icon: "checkmark.circle", tone: "quiet" },
  "conversation-failed": { icon: "exclamationmark.circle", tone: "warning" },
  "conversation-archived": { icon: "archivebox", tone: "quiet" },
  "pull-request-linked": { icon: "arrow.triangle.pull", tone: "project" },
  "pull-request-merged": { icon: "arrow.triangle.merge", tone: "success" },
  "pull-request-closed": { icon: "git.pull-request.closed", tone: "quiet" },
  "pull-request-checks-failed": { icon: "exclamationmark.circle", tone: "warning" },
  "brief-revised": { icon: "pencil", tone: "project" },
  "brief-proposed": { icon: "sparkles", tone: "project" },
  "copy-added": { icon: "internaldrive", tone: "quiet" },
  "copy-released": { icon: "desktopcomputer", tone: "quiet" },
  "copy-failed": { icon: "exclamationmark.triangle", tone: "warning" },
  commits: { icon: "git.commit", tone: "project" },
  "scheduled-run": { icon: "clock", tone: "quiet" },
  "mini-job": { icon: "server.rack", tone: "quiet" },
};

const TONE_INK: Record<Exclude<Tone, "project">, string> = {
  success: "accent-adaptive-emerald-600-400",
  warning: "accent-warning-foreground",
  quiet: "accent-icon-muted",
};

const TONE_FILL: Record<Exclude<Tone, "project">, string> = {
  success: "bg-adaptive-emerald-500-a12-a16",
  warning: "bg-adaptive-amber-500-a12-a16",
  quiet: "bg-subtle",
};

/** Hex alpha for the project's own fill, matching its tile. */
const PROJECT_FILL_ALPHA = "24";

/** The project's color for its tone, falling back to quiet before the project has loaded. */
function useProjectInk(projectId: string, authorityId: EnvironmentId | null) {
  const project = useEnvironmentQuery(
    authorityId ? library.project({ environmentId: authorityId, input: { projectId } }) : null,
  );
  const resolve = useLibraryProjectColorValue();
  return project.data ? resolve(libraryProjectColor(project.data)) : null;
}

/** The newest few entries, for the project screen. Renders nothing for a Library without a timeline. */
export function LibraryTimelinePreview({ projectId }: { readonly projectId: string }) {
  const navigation = useNavigation();
  const { authority, capabilities, hostLabel, hostConnected } = useLibraryActivity();
  const authorityId = authority.environmentId;
  const supported = supportsLoomFeature(capabilities, LIBRARY_TIMELINE_FEATURE);
  const latest = useEnvironmentQuery(
    supported && authorityId
      ? library.timeline({
          environmentId: authorityId,
          input: { projectId, limit: PREVIEW_ENTRIES },
        })
      : null,
  );
  const ink = useProjectInk(projectId, authorityId);
  const open = useOpenLibraryTimelineLink(projectId);
  if (!supported || !authorityId) return null;
  const entries = latest.data?.entries ?? [];
  return (
    <SettingsSection title="Lately">
      {entries.map((entry, index) => (
        <TimelineRow
          key={entry.sequence}
          entry={entry}
          hostLabel={hostLabel}
          hostConnected={hostConnected}
          ink={ink}
          onOpen={open}
          clock={false}
          className={cn("bg-grouped-card", index > 0 && "border-t border-border-subtle")}
        />
      ))}
      {/* A failed refresh keeps the last entries, which may no longer be the latest. */}
      {entries.length && latest.error ? (
        <View className="border-t border-border-subtle p-4">
          <LibraryNotice error={latest.error} onRetry={latest.refresh} />
        </View>
      ) : null}
      {entries.length ? (
        <View className="border-t border-border-subtle">
          <SettingsActionRow
            icon="clock"
            label="Full timeline"
            onPress={() => navigation.navigate("LibraryTimeline", { projectId })}
          />
        </View>
      ) : (
        <View className="p-4">
          <LibraryNotice
            error={latest.error}
            onRetry={latest.error ? latest.refresh : undefined}
            detail={
              latest.error
                ? null
                : latest.data
                  ? "Nothing has happened in this project yet."
                  : authority.connected
                    ? "Loading timeline..."
                    : timelineOfflineDetail(authority.label)
            }
          />
        </View>
      )}
    </SettingsSection>
  );
}

export function LibraryTimelineRouteScreen({
  route,
}: StaticScreenProps<{ readonly projectId: string }>) {
  const { projectId } = route.params;
  const { authority, capabilities, featureState } = useLibraryActivity();
  const [filters, setFilters] = useState<readonly LibraryTimelineFilter[]>([]);
  const authorityId = authority.environmentId;
  const state = featureState(LIBRARY_TIMELINE_FEATURE);
  if (!authorityId || state !== "supported")
    return (
      <LibraryPage title="Timeline" back>
        <LibraryNotice
          detail={
            state === "loading"
              ? "Loading timeline..."
              : state === "offline"
                ? timelineOfflineDetail(authority.label)
                : state === "unsupported"
                  ? "Your Library does not keep a timeline yet. Update it to see what happened on this project."
                  : "Connect your Library to see the timeline."
          }
        />
      </LibraryPage>
    );
  // Commits and runs chips appear only for a Library that records them.
  const shown = libraryTimelineFilters(
    supportsLoomFeature(capabilities, LIBRARY_TIMELINE_ACTIVITY_FEATURE),
  );
  const kinds = libraryTimelineKinds(filters, shown);
  return (
    <LibraryPage title="Timeline" back scroll={false}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel="Kinds of events to show"
        className="grow-0"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}
      >
        <Chip
          label="Everything"
          icon="square.3.layers.3d"
          selected={!filters.length}
          onPress={() => setFilters([])}
        />
        {shown.map((filter) => (
          <Chip
            key={filter}
            label={LIBRARY_TIMELINE_FILTER_LABELS[filter]}
            icon={FILTER_ICONS[filter]}
            selected={filters.includes(filter)}
            onPress={() => setFilters((current) => toggleLibraryTimelineFilter(current, filter))}
          />
        ))}
      </ScrollView>
      {/* A new choice of kinds starts reading from the newest entry again. */}
      <TimelineFeed
        key={kinds?.join(",") ?? "all"}
        projectId={projectId}
        authorityId={authorityId}
        kinds={kinds}
      />
    </LibraryPage>
  );
}

type FeedRow =
  | {
      readonly type: "day";
      readonly key: string;
      readonly label: string;
      readonly detail: string | null;
      readonly count: number;
    }
  | { readonly type: "entry"; readonly key: string; readonly entry: LibraryTimelineEntry };

function TimelineFeed({
  projectId,
  authorityId,
  kinds,
}: {
  readonly projectId: string;
  readonly authorityId: EnvironmentId;
  readonly kinds: readonly LibraryTimelineKind[] | undefined;
}) {
  const { authority, hostLabel, hostConnected, hostsKey } = useLibraryActivity();
  const insets = useSafeAreaInsets();
  const ink = useProjectInk(projectId, authorityId);
  const open = useOpenLibraryTimelineLink(projectId);
  const input = { projectId, limit: TIMELINE_PAGE, ...(kinds ? { kinds } : {}) };
  const [feed, setFeed] = useState(EMPTY_LIBRARY_TIMELINE_FEED);
  // The cursor of the older page being read, if any. One page at a time.
  const [reading, setReading] = useState<number | null>(null);
  const newest = useEnvironmentQuery(library.timeline({ environmentId: authorityId, input }));
  const older = useEnvironmentQuery(
    reading === null
      ? null
      : library.timeline({ environmentId: authorityId, input: { ...input, before: reading } }),
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
  // Read once per visit, so day names stay pure while rendering.
  const [now] = useState(() => new Date());
  // Stable rows let the list skip rows that did not change when the feed renders again.
  const rows = useMemo(
    () =>
      groupTimelineByDay(feed.entries, now).flatMap((day): FeedRow[] => [
        {
          type: "day",
          key: `day:${day.key}`,
          label: day.label,
          detail: day.detail,
          count: day.entries.length,
        },
        ...day.entries.map((entry): FeedRow => ({
          type: "entry",
          key: `entry:${entry.sequence}`,
          entry,
        })),
      ]),
    [feed.entries, now],
  );

  const cursor = feed.nextBefore;
  const loadingOlder = reading !== null && reading === cursor && older.isPending;
  const canReadOlder = typeof cursor === "number" && reading !== cursor;
  const readOlder = () => {
    if (typeof cursor === "number") setReading(cursor);
  };

  if (cursor === undefined)
    return (
      <View className="p-4">
        <LibraryNotice
          error={newest.error}
          onRetry={newest.error ? newest.refresh : undefined}
          detail={
            newest.error
              ? null
              : authority.connected
                ? "Loading timeline..."
                : timelineOfflineDetail(authority.label)
          }
        />
      </View>
    );
  if (!feed.entries.length && cursor === null)
    return (
      <Text className="p-4 text-sm text-foreground-muted">
        {kinds ? "Nothing of these kinds yet." : "Nothing has happened in this project yet."}
      </Text>
    );
  return (
    <LegendList
      className="flex-1"
      data={rows}
      // Rows read the project's color and which computers are connected from outside their data.
      extraData={`${ink ?? ""}|${hostsKey}`}
      keyExtractor={(row) => row.key}
      getItemType={(row) => row.type}
      recycleItems={false}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 24) + 24 }}
      onEndReached={() => {
        if (canReadOlder) readOlder();
      }}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={
        newest.error ? <LibraryNotice error={newest.error} onRetry={newest.refresh} /> : null
      }
      renderItem={({ item }) =>
        item.type === "day" ? (
          <View className="flex-row flex-wrap items-baseline gap-2 pt-5 pb-1">
            <Text accessibilityRole="header" className="text-base font-t3-medium text-foreground">
              {item.label}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {item.detail ? `${item.detail} · ` : null}
              {item.count === 1 ? "1 event" : `${item.count} events`}
            </Text>
          </View>
        ) : (
          <TimelineRow
            entry={item.entry}
            hostLabel={hostLabel}
            hostConnected={hostConnected}
            ink={ink}
            onOpen={open}
            clock
            className="-mx-2 rounded-xl"
          />
        )
      }
      ListFooterComponent={
        <View className="pt-4">
          {cursor === null ? (
            <Text className="text-xs text-foreground-muted">
              That's everything since the project began.
            </Text>
          ) : older.error && reading === cursor ? (
            <LibraryNotice error={older.error} onRetry={older.refresh} />
          ) : (
            <Button
              label={loadingOlder ? "Loading..." : "Show older"}
              tone="secondary"
              loading={loadingOlder}
              onPress={readOlder}
            />
          )}
        </View>
      }
    />
  );
}

const CLOCK_FORMATTER = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const formatClock = (iso: string) => CLOCK_FORMATTER.format(new Date(iso));

/**
 * One thing that happened. Under a day heading the time of day leads and the icon sits on its
 * tone's fill; on its own the row says how long ago instead, with a plain icon.
 */
function TimelineRow({
  entry,
  hostLabel,
  hostConnected,
  ink,
  onOpen,
  clock,
  className,
}: {
  readonly entry: LibraryTimelineEntry;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  /** The project's color, once its project has loaded. */
  readonly ink: string | null;
  readonly onOpen: ReturnType<typeof useOpenLibraryTimelineLink>;
  readonly clock: boolean;
  readonly className?: string;
}) {
  const { fontScale } = useWindowDimensions();
  const timeFont = useScaledTextRole("label");
  // One width for every row keeps the icons in a column; it grows with both text size settings.
  const timeWidth =
    clock && fontScale < STACK_TIME_FONT_SCALE
      ? Math.ceil(timeFont.fontSize * fontScale * TIME_COLUMN_EMS)
      : null;
  const link = libraryTimelineEntryLink(entry, hostConnected);
  const display = KIND_DISPLAY[entry.kind];
  const tone = libraryTimelineEntryFailed(entry)
    ? "warning"
    : display.tone === "project" && !ink
      ? "quiet"
      : display.tone;
  const folder = "copy" in entry ? libraryPathParts(entry.copy.rootPath).name : null;
  const summary = libraryTimelineEntrySummary(entry);
  const where = entry.environmentId ? hostLabel(entry.environmentId) : "Library";
  const time = clock ? formatClock(entry.at) : `${relativeTime(entry.at)} ago`;
  // An estimated time reads as "~3:27 PM" and is spoken as "about".
  const shownTime = entry.approximate ? `~${time}` : time;
  const spokenTime = entry.approximate ? `about ${time}` : time;
  const body = (
    <>
      {timeWidth !== null ? (
        <Text
          numberOfLines={1}
          style={{ width: timeWidth }}
          className="shrink-0 pt-1.5 text-right text-xs tabular-nums text-foreground-muted"
        >
          {shownTime}
        </Text>
      ) : null}
      <View
        className={cn(
          "size-7 items-center justify-center",
          clock && "rounded-full",
          clock && tone !== "project" && TONE_FILL[tone],
        )}
        style={
          clock && tone === "project" && ink
            ? { backgroundColor: `${ink}${PROJECT_FILL_ALPHA}` }
            : undefined
        }
      >
        <SymbolView
          name={display.icon}
          size={clock ? 15 : 18}
          {...(tone === "project" && ink
            ? { tintColor: ink }
            : { tintColorClassName: TONE_INK[tone === "project" ? "quiet" : tone] })}
        />
      </View>
      <View className="min-w-0 flex-1 gap-0.5 pt-1">
        <Text className="text-sm font-t3-medium text-foreground">{summary}</Text>
        {/* At accessibility sizes one line would cut off the time, which ends the line. */}
        <Text
          numberOfLines={fontScale < STACK_TIME_FONT_SCALE ? 1 : undefined}
          className="text-xs text-foreground-muted"
        >
          {[where, folder, timeWidth === null ? shownTime : null].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </>
  );
  const label = [summary, where, folder, spokenTime].filter(Boolean).join(", ");
  const row = cn("flex-row gap-3 px-4 py-2.5", className);
  if (!link)
    return (
      <View accessible accessibilityLabel={label} className={row}>
        {body}
      </View>
    );
  return (
    <Pressable
      accessibilityRole={link.kind === "pull-request" ? "link" : "button"}
      accessibilityLabel={label}
      accessibilityHint={
        link.kind === "pull-request"
          ? "Opens the pull request"
          : link.kind === "thread"
            ? "Opens the conversation"
            : "Opens the saved conversation"
      }
      onPress={() => onOpen(link)}
      className={cn(row, "active:opacity-70")}
    >
      {body}
    </Pressable>
  );
}
