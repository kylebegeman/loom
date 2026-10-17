export type TimelineDay<T> = {
  readonly key: string;
  readonly label: string;
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

/**
 * One group per local day, in the order days first appear. Estimated times can land an entry
 * out of order, so a day seen again joins its earlier group instead of repeating.
 */
export function groupTimelineByDay<T extends { readonly at: string }>(
  entries: readonly T[],
  now: Date,
  locale?: string,
): TimelineDay<T>[] {
  const days = new Map<string, { key: string; label: string; entries: T[] }>();
  for (const entry of entries) {
    const date = new Date(entry.at);
    const key = String(startOfDay(date));
    const day = days.get(key);
    if (day) day.entries.push(entry);
    else days.set(key, { key, label: timelineDayLabel(date, now, locale), entries: [entry] });
  }
  return [...days.values()];
}
