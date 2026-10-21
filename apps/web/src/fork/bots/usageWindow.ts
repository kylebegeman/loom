import type { UsageSummaryInput } from "@t3tools/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BotsUsageWindow {
  readonly since: string;
  readonly until: string;
}

/** The last `days` rolling days up to the minute, so a refetch within a minute reuses the query. */
export const rollingWindow = (days: number, nowMs: number): BotsUsageWindow => {
  const until = Math.floor(nowMs / 60_000) * 60_000;
  return {
    since: new Date(until - days * DAY_MS).toISOString(),
    until: new Date(until).toISOString(),
  };
};

/** How far `timeZone`'s wall clock is ahead of UTC at `ms`. */
const zoneOffsetMs = (ms: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - Math.floor(ms / 1000) * 1000;
};

/** Midnight starting `day` (YYYY-MM-DD, plus `addDays`) in `timeZone`, as epoch milliseconds. */
const midnightIn = (day: string, timeZone: string, addDays = 0) => {
  const [year = 1970, month = 1, dayOfMonth = 1] = day.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, dayOfMonth + addDays);
  // A second pass settles days whose midnight is on the other side of a DST change.
  const first = wall - zoneOffsetMs(wall, timeZone);
  return wall - zoneOffsetMs(first, timeZone);
};

/**
 * The Usage page's window as instants: its hours as they are, or its calendar days from the first
 * day's midnight to the midnight after the last, in the page's time zone.
 */
export const usagePageWindow = (window: UsageSummaryInput): BotsUsageWindow => {
  if (
    window.resolution === "hour" &&
    window.sinceTime !== undefined &&
    window.untilTime !== undefined
  )
    return { since: window.sinceTime, until: window.untilTime };
  return {
    since: new Date(midnightIn(window.sinceDay, window.timeZone)).toISOString(),
    until: new Date(midnightIn(window.untilDay, window.timeZone, 1)).toISOString(),
  };
};
