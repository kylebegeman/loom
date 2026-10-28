import { useState } from "react";
import { View } from "react-native";
import { Button } from "../../components/ui/Button";
import type { SiteAnalytics } from "@t3tools/contracts/fork";
import {
  siteTrafficDays,
  siteTrafficBreakdowns,
  siteTrafficRatios,
} from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { ago, siteHost } from "./SiteHealth";

/** Hex alpha for the soft share bar behind ranked rows, about 12% opacity. */
const SHARE_ALPHA = "1F";
const CHART_HEIGHT = 128;

/** Exact up to five digits, compact past that, so a figure never wraps. */
export function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 100_000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString();
}

const DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayLabel = (day: string) => DAY_LABEL.format(new Date(`${day}T00:00:00Z`));

const plural = (count: number, noun: string) =>
  `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;

/** A site's traffic inside its section's group: figures, one daily series, and ranked breakdowns. */
export function SiteTraffic({
  analytics,
  origins,
  color,
}: {
  readonly analytics: SiteAnalytics;
  readonly origins: readonly string[];
  /** The site's color, so its chart reads as part of the projects it serves. */
  readonly color: string;
}) {
  const days = siteTrafficDays(analytics);
  const quiet = !analytics.pageviews && !analytics.events;
  const ratios = siteTrafficRatios(analytics);
  return (
    <View className="gap-5 p-4">
      <View className="flex-row">
        <Figure label="Page views" value={analytics.pageviews} first />
        <Figure label="Visitors" value={analytics.visitors} />
        <Figure label="Events" value={analytics.events} />
      </View>
      {quiet || !days.length ? (
        <View className="items-center justify-center gap-1 px-4" style={{ height: CHART_HEIGHT }}>
          <Text className="text-sm font-t3-medium text-foreground">
            No visits in the last {analytics.days} days
          </Text>
          <Text className="text-center text-xs text-foreground-muted">
            Visits from this site's analytics origins appear here as they arrive.
          </Text>
        </View>
      ) : (
        <DailyChart days={days} analytics={analytics} color={color} />
      )}
      {quiet ? null : (
        <>
          <RankedList
            title="Top pages"
            empty="No page views in this period."
            color={color}
            rows={analytics.pages.map((page) => ({
              key: page.path,
              label: page.path,
              value: page.pageviews,
            }))}
          />
          <RankedList
            title="Clicks and events"
            empty="No clicks or named events in this period."
            color={color}
            rows={analytics.named.map((event) => ({
              key: JSON.stringify([event.name, event.label, event.target]),
              label: event.name,
              ...(event.label || event.target
                ? { detail: [event.label, event.target].filter(Boolean).join(" · ") }
                : {}),
              value: event.count,
            }))}
          />
          {analytics.pageviews > 0 ? (
            <>
              <Text className="text-xs text-foreground-muted">
                {ratios.viewsPerVisitor?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ??
                  "Not available"}{" "}
                views per daily visitor.{" "}
                {ratios.actionsPerHundredViews?.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                }) ?? "Not available"}{" "}
                actions per 100 views. Activity averages, not unique-person conversion rates.
              </Text>
              {siteTrafficBreakdowns(analytics).map((group) => (
                <View key={group.id} className="gap-1.5">
                  <RankedList
                    title={group.title}
                    rows={group.rows}
                    color={color}
                    empty={
                      group.available
                        ? "No page views with this breakdown in this period."
                        : "Update the connected Loom server to see this breakdown."
                    }
                  />
                  <Text className="text-2xs text-foreground-muted">{group.note}</Text>
                </View>
              ))}
            </>
          ) : null}
        </>
      )}
      <Text className="border-t border-border-subtle pt-3 text-xs text-foreground-muted">
        Visitors are counted once per day; a return on another day counts again
        {analytics.lastEventAt
          ? `, and the latest visit arrived ${ago(analytics.lastEventAt)}`
          : ""}
        . Counting visits from {origins.map(siteHost).join(", ")}.
      </Text>
    </View>
  );
}

/** One figure in a row divided by hairlines, so the numbers read without boxes around them. */
function Figure({
  label,
  value,
  first = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly first?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      className={cn("min-w-0 flex-1 gap-0.5", !first && "border-l border-border-subtle ps-3")}
    >
      <Text numberOfLines={1} className="text-2xs text-foreground-muted">
        {label}
      </Text>
      <Text numberOfLines={1} className="text-xl font-t3-semibold tabular-nums text-foreground">
        {formatCount(value)}
      </Text>
    </View>
  );
}

function DailyChart({
  days,
  analytics,
  color,
}: {
  readonly days: ReturnType<typeof siteTrafficDays>;
  readonly analytics: SiteAnalytics;
  readonly color: string;
}) {
  const busiest = days.reduce((peak, day) => (day.pageviews > peak.pageviews ? day : peak));
  const max = Math.max(1, busiest.pageviews);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Daily page views for the last ${analytics.days} days. ${plural(analytics.pageviews, "page view")} and ${plural(analytics.visitors, "visitor")} in total. Busiest day ${dayLabel(busiest.day)} with ${plural(busiest.pageviews, "page view")}.`}
      className="gap-1.5"
    >
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-2xs text-foreground-muted">Daily page views</Text>
        <Text className="text-2xs tabular-nums text-foreground-muted">
          Busiest {dayLabel(busiest.day)}, {formatCount(busiest.pageviews)}
        </Text>
      </View>
      <View
        className="flex-row items-end gap-0.5 border-b border-border-subtle"
        style={{ height: CHART_HEIGHT }}
      >
        {days.map((day) => (
          <View
            key={day.day}
            className="flex-1 rounded-sm"
            style={{
              height: (day.pageviews / max) * CHART_HEIGHT,
              // A quiet day next to a busy one still shows it had visits.
              minHeight: day.pageviews > 0 ? 2 : 0,
              backgroundColor: color,
            }}
          />
        ))}
      </View>
      <View className="flex-row justify-between">
        <Text className="text-2xs tabular-nums text-foreground-muted">
          {dayLabel(days[0]!.day)}
        </Text>
        <Text className="text-2xs tabular-nums text-foreground-muted">
          {dayLabel(days[days.length - 1]!.day)}
        </Text>
      </View>
    </View>
  );
}

/** A ranked list whose rows carry their share as a soft bar behind the text. */
function RankedList({
  title,
  rows,
  empty,
  color,
}: {
  readonly title: string;
  readonly rows: readonly { key: string; label: string; detail?: string; value: number }[];
  readonly empty: string;
  readonly color: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, 8);
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <View className="gap-1.5">
      <Text accessibilityRole="header" className="text-xs font-t3-medium text-foreground-muted">
        {title}
      </Text>
      {rows.length ? (
        visibleRows.map((row) => (
          <View
            key={row.key}
            accessible
            accessibilityLabel={`${row.label}${row.detail ? `, ${row.detail}` : ""}: ${row.value}`}
            className="min-h-9 flex-row items-center gap-3 overflow-hidden rounded-md px-2.5 py-1.5"
          >
            <View
              className="absolute inset-y-0 left-0 rounded-md"
              style={{
                width: `${(row.value / max) * 100}%`,
                backgroundColor: `${color}${SHARE_ALPHA}`,
              }}
            />
            <Text className="min-w-0 flex-1 text-sm text-foreground">
              {row.label}
              {row.detail ? (
                <Text className="text-xs text-foreground-muted"> {row.detail}</Text>
              ) : null}
            </Text>
            <Text className="text-xs font-t3-medium tabular-nums text-foreground">
              {formatCount(row.value)}
            </Text>
          </View>
        ))
      ) : (
        <Text className="py-1 text-xs text-foreground-muted">{empty}</Text>
      )}
      {rows.length > 8 ? (
        <Button
          tone="text"
          label={expanded ? "Show fewer" : `Show all ${rows.length}`}
          onPress={() => setExpanded((value) => !value)}
        />
      ) : null}
    </View>
  );
}

/** Column heights for the loading shape, varied so it reads as a chart rather than a block. */
const SKELETON_COLUMNS = Array.from({ length: 30 }, (_, index) => ({
  id: `column-${index}`,
  height: Math.round(35 + 25 * Math.sin(index / 3) + index),
}));

/** The traffic group's shape while its numbers load, so nothing jumps when they arrive. */
export function SiteTrafficSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading traffic" className="gap-5 p-4">
      <View className="flex-row gap-3">
        {[0, 1, 2].map((index) => (
          <View key={index} className="flex-1 gap-2">
            <View className="h-3 w-16 rounded-md bg-row-hover" />
            <View className="h-6 w-20 rounded-md bg-row-hover" />
          </View>
        ))}
      </View>
      <View className="flex-row items-end gap-0.5" style={{ height: CHART_HEIGHT }}>
        {SKELETON_COLUMNS.map((column) => (
          <View
            key={column.id}
            className="flex-1 rounded-sm bg-row-hover"
            style={{ height: `${column.height}%` }}
          />
        ))}
      </View>
      <View className="gap-2">
        <View className="h-3 w-24 rounded-md bg-row-hover" />
        <View className="h-7 w-full rounded-md bg-row-hover" />
        <View className="h-7 w-3/4 rounded-md bg-row-hover" />
      </View>
    </View>
  );
}
