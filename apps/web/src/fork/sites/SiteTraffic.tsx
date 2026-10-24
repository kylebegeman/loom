import { useState } from "react";
import type { SiteAnalytics } from "@t3tools/contracts/fork";
import { siteTrafficDays } from "@t3tools/client-runtime/fork";
import { FileTextIcon, MousePointerClickIcon } from "lucide-react";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LIBRARY_OUTLINE, LibraryFigure } from "../project-library/LibraryControls";
import { siteHost } from "./SiteHealth";

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

/** Rounds an axis top up to 1, 2 or 5 times a power of ten, so its one label reads cleanly. */
function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

/**
 * A site's traffic in one outlined panel. The figures double as the chart's readout: they show
 * the window's totals, and the day under the pointer or keyboard while one is focused. One
 * series, so no legend; every value is also in the table screen readers get.
 */
export function SiteTraffic({
  analytics,
  origins,
}: {
  readonly analytics: SiteAnalytics;
  readonly origins: readonly string[];
}) {
  const days = siteTrafficDays(analytics);
  const [focused, setFocused] = useState<number | null>(null);
  const top = niceCeiling(Math.max(0, ...days.map((day) => day.pageviews)));
  const current = focused === null ? null : days[focused];
  const move = (delta: number) =>
    setFocused((index) => Math.min(days.length - 1, Math.max(0, (index ?? days.length) + delta)));
  const quiet = !analytics.pageviews && !analytics.events;
  return (
    <div className={cn(LIBRARY_OUTLINE, "flex min-w-0 flex-col gap-6 p-4 sm:p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
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
      {quiet || !days.length ? (
        <div className="flex h-36 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border px-4 text-center">
          <p className="text-sm font-medium">No visits in the last {analytics.days} days</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Visits from this site's analytics origins appear here as they arrive.
          </p>
        </div>
      ) : (
        <figure className="flex flex-col">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
            <div
              aria-hidden
              className="flex h-36 flex-col justify-between text-end text-2xs tabular-nums text-muted-foreground/80"
            >
              <span className="-translate-y-1/2">{formatCount(top)}</span>
              <span className="translate-y-1/2">0</span>
            </div>
            <div
              role="img"
              aria-label={`Daily page views for the last ${analytics.days} days. Use the arrow keys to read each day.`}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") move(-1);
                else if (event.key === "ArrowRight") move(1);
                else if (event.key === "Home") setFocused(0);
                else if (event.key === "End") setFocused(days.length - 1);
                else return;
                event.preventDefault();
              }}
              onPointerLeave={() => setFocused(null)}
              onBlur={() => setFocused(null)}
              className="relative flex h-36 items-end gap-0.5 rounded-md border-y border-border/70 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {days.map((day, index) => (
                <div
                  key={day.day}
                  onPointerEnter={() => setFocused(index)}
                  className="flex h-full min-w-0 flex-1 items-end justify-center"
                >
                  <span
                    className={cn(
                      "block w-full max-w-6 rounded-t-sm bg-(--project-color) transition-opacity duration-150",
                      focused !== null && focused !== index && "opacity-35",
                      // A quiet day next to a busy one still shows it had visits.
                      day.pageviews > 0 && "min-h-0.5",
                    )}
                    style={{ height: `${(day.pageviews / top) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <span />
            <div
              aria-hidden
              className="mt-1.5 flex justify-between text-2xs tabular-nums text-muted-foreground/80"
            >
              <span>{dayLabel(days[0]!.day)}</span>
              <span>{dayLabel(days.at(-1)!.day)}</span>
            </div>
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
      )}
      {quiet ? null : <SiteTrafficBreakdown analytics={analytics} />}
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        Visitors are counted once per day
        {analytics.lastEventAt
          ? `, and the latest visit arrived ${formatRelativeTimeLabel(analytics.lastEventAt)}`
          : ""}
        . Counting visits from{" "}
        {origins.map((origin, index) => (
          <span key={origin}>
            {index ? ", " : null}
            <span className="font-mono text-foreground/80">{siteHost(origin)}</span>
          </span>
        ))}
        .
      </p>
    </div>
  );
}

/** Column heights for the loading shape, varied so it reads as a chart rather than a bar. */
const SKELETON_COLUMNS = Array.from({ length: 30 }, (_, index) => ({
  id: `column-${index}`,
  height: Math.round(35 + 25 * Math.sin(index / 3) + index),
}));

/** The traffic panel's shape while its numbers load, so nothing jumps when they arrive. */
export function SiteTrafficSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading traffic"
      className={cn(LIBRARY_OUTLINE, "flex flex-col gap-6 p-4 sm:p-5")}
    >
      <div className="flex gap-5">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex h-36 items-end gap-0.5 ps-8">
        {SKELETON_COLUMNS.map((column) => (
          <Skeleton
            key={column.id}
            className="max-w-6 flex-1"
            style={{ height: `${column.height}%` }}
          />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {[0, 1].map((column) => (
          <div key={column} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-7 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A ranked list whose rows carry their share as a soft bar behind the text. */
function RankedList({
  title,
  icon: Icon,
  rows,
  empty,
}: {
  readonly title: string;
  readonly icon: typeof FileTextIcon;
  readonly rows: readonly { key: string; label: string; detail?: string; value: number }[];
  readonly empty: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
        {title}
      </h3>
      {rows.length ? (
        <ol className="flex flex-col gap-1">
          {rows.map((row) => (
            <li
              key={row.key}
              className="relative isolate flex min-w-0 items-center gap-3 overflow-hidden rounded-md px-2.5 py-1.5 text-sm"
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 -z-10 rounded-md bg-(--project-color)/10 dark:bg-(--project-color)/14"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
              <span className="min-w-0 flex-1 break-all">
                {row.label}
                {row.detail ? (
                  <span className="ms-1.5 text-xs text-muted-foreground">{row.detail}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs font-medium tabular-nums">
                {formatCount(row.value)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-1.5 text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

export function SiteTrafficBreakdown({ analytics }: { readonly analytics: SiteAnalytics }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <RankedList
        title="Top pages"
        icon={FileTextIcon}
        empty="No page views in this period."
        rows={analytics.pages.map((page) => ({
          key: page.path,
          label: page.path,
          value: page.pageviews,
        }))}
      />
      <RankedList
        title="Clicks and events"
        icon={MousePointerClickIcon}
        empty="No clicks or named events in this period."
        rows={analytics.named.map((event) => ({
          key: JSON.stringify([event.name, event.label, event.target]),
          label: event.label || event.name,
          ...(event.target ? { detail: event.target } : {}),
          value: event.count,
        }))}
      />
    </div>
  );
}
