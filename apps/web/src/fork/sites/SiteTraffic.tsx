import { useState } from "react";
import type { SiteAnalytics } from "@t3tools/contracts/fork";
import { siteTrafficDays } from "@t3tools/client-runtime/fork";
import { AppWindowIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryFigure, LibraryGroupHeading } from "../project-library/LibraryControls";
import { LIBRARY_CELL, LibraryBar, LibraryTable, Sparkline } from "../project-library/LibraryData";

const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat();

/** Exact up to five digits, compact past that, so a headline never wraps. */
export function formatCount(value: number) {
  return value >= 100_000 ? COMPACT.format(value) : WHOLE.format(value);
}

const DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayLabel = (day: string) => DAY_LABEL.format(new Date(`${day}T00:00:00Z`));

/** The day nearest a pointer `offset` pixels into a chart `width` wide that spans `count` days. */
export function trafficDayAt(offset: number, width: number, count: number) {
  if (count <= 1 || width <= 0) return 0;
  const share = Math.min(1, Math.max(0, offset / width));
  return Math.round(share * (count - 1));
}

/**
 * Where `Sparkline` draws the point for `index`, as percentages of its box. It mirrors that
 * component's 100 by 24 view box, whose line runs from 2 units below the top to 2 above the foot.
 */
export function sparklinePoint(values: readonly number[], index: number) {
  const top = Math.max(1, ...values);
  const value = values[index] ?? 0;
  return {
    x: values.length > 1 ? (index / (values.length - 1)) * 100 : 50,
    y: ((22 - (value / top) * 20) / 24) * 100,
  };
}

const quietWindow = (analytics: SiteAnalytics) => !analytics.pageviews && !analytics.events;

/**
 * A site's traffic over the window, in one outline. The figures double as the chart's readout:
 * they show the window's totals, and the day under the pointer or keyboard while one is focused.
 * One series, so no legend; every value is also in the table screen readers get.
 */
export function SiteTraffic({ analytics }: { readonly analytics: SiteAnalytics }) {
  const days = siteTrafficDays(analytics);
  const [focused, setFocused] = useState<number | null>(null);
  const current = focused === null ? null : (days[focused] ?? null);
  const quiet = quietWindow(analytics) || !days.length;
  return (
    <section
      aria-label="Traffic over time"
      className="flex min-w-0 flex-col rounded-xl border border-border"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 pt-4">
        <dl aria-live="polite" className="flex min-w-0 flex-wrap gap-x-5 gap-y-3">
          <LibraryFigure
            label="Page views"
            value={formatCount(current ? current.pageviews : analytics.pageviews)}
          />
          <LibraryFigure
            label="Visitors"
            value={formatCount(current ? current.visitors : analytics.visitors)}
          />
          <LibraryFigure
            label={current ? `Events, all ${analytics.days} days` : "Events"}
            value={formatCount(analytics.events)}
          />
        </dl>
        <p className="pt-0.5 text-xs tabular-nums text-muted-foreground">
          {current ? dayLabel(current.day) : `Last ${analytics.days} days`}
        </p>
      </div>
      {quiet ? (
        <div className="m-4 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm font-medium">No visits in the last {analytics.days} days</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Visits from this site's analytics origins appear here as they arrive.
          </p>
        </div>
      ) : (
        <TrafficChart
          days={days}
          windowDays={analytics.days}
          focused={focused}
          onFocus={setFocused}
        />
      )}
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        Visitors are counted once per day
        {analytics.lastEventAt
          ? `. The latest visit arrived ${formatRelativeTimeLabel(analytics.lastEventAt)}.`
          : "."}
      </p>
    </section>
  );
}

type TrafficDay = ReturnType<typeof siteTrafficDays>[number];

/** Daily page views as the Library's sparkline, made readable a day at a time. */
function TrafficChart({
  days,
  windowDays,
  focused,
  onFocus,
}: {
  readonly days: readonly TrafficDay[];
  readonly windowDays: number;
  readonly focused: number | null;
  readonly onFocus: (index: number | null) => void;
}) {
  const values = days.map((day) => day.pageviews);
  const point = focused === null ? null : sparklinePoint(values, focused);
  const peak = days.reduce((best, day) => (day.pageviews > best.pageviews ? day : best), days[0]!);
  const move = (delta: number) =>
    onFocus(Math.min(days.length - 1, Math.max(0, (focused ?? days.length) + delta)));
  return (
    <figure className="flex flex-col gap-1.5 px-4 pt-5 pb-3">
      <div
        role="img"
        aria-label={`Daily page views for the last ${windowDays} days. Use the arrow keys to read each day.`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") move(-1);
          else if (event.key === "ArrowRight") move(1);
          else if (event.key === "Home") onFocus(0);
          else if (event.key === "End") onFocus(days.length - 1);
          else return;
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onFocus(trafficDayAt(event.clientX - box.left, box.width, days.length));
        }}
        onPointerLeave={() => onFocus(null)}
        onBlur={() => onFocus(null)}
        className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Sparkline size="chart" values={values} label="Daily page views" />
        {point ? (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-foreground/20"
              style={{ left: `${point.x}%` }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--project-color) ring-2 ring-card"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            />
          </>
        ) : null}
      </div>
      <div
        aria-hidden
        className="flex justify-between gap-3 text-2xs tabular-nums text-muted-foreground/80"
      >
        <span>{dayLabel(days[0]!.day)}</span>
        {peak.pageviews ? (
          <span className="truncate">
            Busiest {dayLabel(peak.day)}, {formatCount(peak.pageviews)} views
          </span>
        ) : null}
        <span>{dayLabel(days.at(-1)!.day)}</span>
      </div>
      <table className="sr-only">
        <caption>Daily page views and visitors</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Page views</th>
            <th scope="col">Visitors</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <th scope="row">{dayLabel(day.day)}</th>
              <td>{day.pageviews}</td>
              <td>{day.visitors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * The window in one glance for a site's overview: the totals, the shape of the month and the
 * pages most read.
 */
export function SiteTrafficSummary({ analytics }: { readonly analytics: SiteAnalytics }) {
  const days = siteTrafficDays(analytics);
  const pages = analytics.pages.slice(0, SUMMARY_PAGES);
  const max = Math.max(1, ...pages.map((page) => page.pageviews));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="font-semibold tabular-nums">{formatCount(analytics.pageviews)}</span>{" "}
          <span className="text-muted-foreground">page views</span>
        </span>
        <span>
          <span className="font-semibold tabular-nums">{formatCount(analytics.visitors)}</span>{" "}
          <span className="text-muted-foreground">visitors</span>
        </span>
        <span className="text-xs text-muted-foreground">
          Last {analytics.days} days
          {analytics.lastEventAt
            ? `, latest visit ${formatRelativeTimeLabel(analytics.lastEventAt)}`
            : ""}
        </span>
      </p>
      {quietWindow(analytics) ? (
        <p className="text-xs text-muted-foreground">
          No visits in the last {analytics.days} days.
        </p>
      ) : (
        <Sparkline
          size="fill"
          values={days.map((day) => day.pageviews)}
          label={`Daily page views over the last ${analytics.days} days`}
        />
      )}
      {pages.length ? (
        <ol aria-label="Most read pages" className="flex flex-col gap-1.5">
          {pages.map((page) => (
            <li
              key={page.path}
              className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3 text-xs"
            >
              <span className="truncate font-mono text-foreground/85">{page.path}</span>
              <LibraryBar share={page.pageviews / max}>{formatCount(page.pageviews)}</LibraryBar>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

const SUMMARY_PAGES = 3;
const BREAKDOWN_ROWS = 8;

/** Where the window's views went: the pages read and the clicks and named events recorded. */
export function SiteTrafficBreakdown({
  analytics,
  onPreview,
}: {
  readonly analytics: SiteAnalytics;
  /** Opens a page in the site's preview. */
  readonly onPreview?: (path: string) => void;
}) {
  return (
    <div className="grid items-start gap-x-8 gap-y-8 xl:grid-cols-2">
      <TopPages pages={analytics.pages} onPreview={onPreview} />
      <TopEvents events={analytics.named} />
    </div>
  );
}

function ShowAll({
  total,
  expanded,
  onToggle,
}: {
  readonly total: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  if (total <= BREAKDOWN_ROWS) return null;
  return (
    <div>
      <Button shape="pill" size="xs" variant="ghost" onClick={onToggle}>
        {expanded ? "Show fewer" : `Show all ${total}`}
      </Button>
    </div>
  );
}

function TopPages({
  pages,
  onPreview,
}: {
  readonly pages: SiteAnalytics["pages"];
  readonly onPreview: ((path: string) => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? pages : pages.slice(0, BREAKDOWN_ROWS);
  const max = Math.max(1, ...pages.map((page) => page.pageviews));
  const columns = [
    { key: "page", label: "Page", className: "w-full" },
    { key: "visitors", label: "Visitors", align: "end", className: "hidden w-20 sm:table-cell" },
    { key: "views", label: "Page views", className: "w-36" },
    ...(onPreview
      ? [{ key: "preview", label: "Preview", hideLabel: true, className: "w-10" }]
      : []),
  ] as const;
  return (
    <section aria-label="Top pages" className="flex min-w-0 flex-col gap-2">
      <LibraryGroupHeading title="Top pages" count={pages.length || undefined} />
      {pages.length ? (
        <LibraryTable label="Top pages" columns={columns}>
          {shown.map((page) => (
            <tr key={page.path} className="transition-colors duration-150 hover:bg-accent/40">
              <td className={cn(LIBRARY_CELL, "max-w-0 py-2")}>
                <span className="block truncate font-mono text-xs">{page.path}</span>
              </td>
              <td
                className={cn(
                  LIBRARY_CELL,
                  "hidden py-2 text-end text-xs tabular-nums text-muted-foreground sm:table-cell",
                )}
              >
                {formatCount(page.visitors)}
              </td>
              <td className={cn(LIBRARY_CELL, "py-2 text-xs")}>
                <LibraryBar share={page.pageviews / max}>{formatCount(page.pageviews)}</LibraryBar>
              </td>
              {onPreview ? (
                <td className={cn(LIBRARY_CELL, "py-1.5 text-end")}>
                  <Button
                    shape="pill"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Preview ${page.path}`}
                    onClick={() => onPreview(page.path)}
                  >
                    <AppWindowIcon />
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </LibraryTable>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
          No page views in this period.
        </p>
      )}
      <ShowAll
        total={pages.length}
        expanded={expanded}
        onToggle={() => setExpanded((open) => !open)}
      />
    </section>
  );
}

const EVENT_COLUMNS = [
  { key: "event", label: "Click or event", className: "w-full" },
  { key: "count", label: "Count", className: "w-36" },
] as const;

function TopEvents({ events }: { readonly events: SiteAnalytics["named"] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? events : events.slice(0, BREAKDOWN_ROWS);
  const max = Math.max(1, ...events.map((event) => event.count));
  return (
    <section aria-label="Clicks and events" className="flex min-w-0 flex-col gap-2">
      <LibraryGroupHeading title="Clicks and events" count={events.length || undefined} />
      {events.length ? (
        <LibraryTable label="Clicks and events" columns={EVENT_COLUMNS}>
          {shown.map((event) => (
            <tr
              key={JSON.stringify([event.name, event.label, event.target])}
              className="transition-colors duration-150 hover:bg-accent/40"
            >
              <td className={cn(LIBRARY_CELL, "max-w-0 py-2")}>
                <span className="block truncate text-xs font-medium">
                  {event.label || event.name}
                </span>
                {event.target ? (
                  <span className="block truncate font-mono text-2xs text-muted-foreground">
                    {event.target}
                  </span>
                ) : null}
              </td>
              <td className={cn(LIBRARY_CELL, "py-2 text-xs")}>
                <LibraryBar share={event.count / max}>{formatCount(event.count)}</LibraryBar>
              </td>
            </tr>
          ))}
        </LibraryTable>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
          No clicks or named events in this period.
        </p>
      )}
      <ShowAll
        total={events.length}
        expanded={expanded}
        onToggle={() => setExpanded((open) => !open)}
      />
    </section>
  );
}

const SKELETON_ROWS = ["first", "second", "third"];

/** The traffic view's shape while its numbers load, so nothing jumps when they arrive. */
export function SiteTrafficSkeleton() {
  return (
    <div role="status" aria-label="Loading traffic" className="flex flex-col gap-8">
      <div className="flex flex-col gap-5 rounded-xl border border-border p-4">
        <div className="flex gap-5">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
        <Skeleton shape="card" className="h-16 w-full" />
      </div>
      <div className="grid gap-x-8 gap-y-8 xl:grid-cols-2">
        {["pages", "events"].map((table) => (
          <div key={table} className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-24" />
            <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {SKELETON_ROWS.map((row) => (
                <div key={row} className="flex items-center gap-3 px-3 py-2.5">
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
