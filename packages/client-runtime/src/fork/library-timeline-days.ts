// @effect-diagnostics globalDate:off - Groups by the viewer's local calendar day for display, outside an Effect runtime.
export type TimelineDay<T> = {
  readonly key: string;
  readonly label: string;
  /** The calendar date, when the label names the day without one. */
  readonly detail: string | null;
  readonly entries: readonly T[];
};

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Days are the reader's local calendar days, not UTC ones. */
export function timelineDayLabel(date: Date, now: Date, locale?: string) {
  // Rounding absorbs the 23 and 25 hour days around daylight saving changes.
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < WEEK_DAYS) return date.toLocaleDateString(locale, { weekday: "long" });
  return date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** The date behind a relative day name. Labels for older days already carry their date. */
export function timelineDayDetail(date: Date, now: Date, locale?: string) {
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (daysAgo >= WEEK_DAYS) return null;
  return date.toLocaleDateString(locale, { month: "long", day: "numeric" });
}

const entryTime = (entry: { readonly at: string }) => {
  const time = Date.parse(entry.at);
  return Number.isNaN(time) ? -Infinity : time;
};

/**
 * Newest first by the time each entry shows; equal times keep their order. The feed arrives in
 * the order entries were recorded, and computers can report commits, scheduled runs and Mini
 * jobs days after they happen.
 */
export function timelineNewestFirst<T extends { readonly at: string }>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index, time: entryTime(entry) }))
    .sort((a, b) => b.time - a.time || a.index - b.index)
    .map(({ entry }) => entry);
}

/** One group per local day, newest first. */
export function groupTimelineByDay<T extends { readonly at: string }>(
  entries: readonly T[],
  now: Date,
  locale?: string,
): TimelineDay<T>[] {
  const days = new Map<
    string,
    { key: string; label: string; detail: string | null; entries: T[] }
  >();
  for (const entry of timelineNewestFirst(entries)) {
    const date = new Date(entry.at);
    const key = String(startOfDay(date));
    const day = days.get(key);
    if (day) day.entries.push(entry);
    else
      days.set(key, {
        key,
        label: timelineDayLabel(date, now, locale),
        detail: timelineDayDetail(date, now, locale),
        entries: [entry],
      });
  }
  return [...days.values()];
}
