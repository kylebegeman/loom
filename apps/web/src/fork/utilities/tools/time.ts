const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** 0 is Sunday. */
  readonly weekday: number;
  /** Short name such as "EDT" or "GMT+2", as the platform prints it. */
  readonly zoneName: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

// en-US with an explicit h23 cycle keeps the parts stable whatever the user's locale is.
function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      timeZoneName: "short",
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

/** Wall-clock fields of an instant in an IANA zone. Throws RangeError for an unknown zone. */
export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(ms)) parts[part.type] = part.value;
  const number = (type: string) => Number(parts[type] ?? 0);
  const month = number("month");
  return {
    year: yearInZone(ms, month),
    month,
    day: number("day"),
    hour: number("hour") % 24,
    minute: number("minute"),
    second: number("second"),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? ""),
    zoneName: parts.timeZoneName ?? timeZone,
  };
}

/**
 * Intl prints 1 BCE as year 1 with no era, so the year comes from the UTC year, moved by one
 * when the zone's wall clock is across New Year from UTC.
 */
function yearInZone(ms: number, zonedMonth: number): number {
  const utc = new Date(ms);
  const utcMonth = utc.getUTCMonth() + 1;
  const crossed =
    zonedMonth === 1 && utcMonth === 12 ? 1 : zonedMonth === 12 && utcMonth === 1 ? -1 : 0;
  return utc.getUTCFullYear() + crossed;
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

// As toISOString writes years: four digits, or a sign and six digits outside 0 to 9999.
const formatYear = (year: number) =>
  year >= 0 && year <= 9999 ? pad(year, 4) : `${year < 0 ? "-" : "+"}${pad(Math.abs(year), 6)}`;

/** `2026-10-20 14:03:05 PDT`: every tool prints local time this one way. */
export function formatLocal(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${formatYear(p.year)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ${p.zoneName}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}
