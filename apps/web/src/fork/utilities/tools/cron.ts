import { error, ok, type UtilityToolImpl } from "../types";
import { formatLocal, isValidTimeZone, zonedParts } from "./time";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const RUN_COUNT = 5;
/**
 * Bounds the gap between consecutive runs rather than the whole search, so a February 29
 * schedule still lists five leap days while one that can never match stops after 4 years
 * of days instead of hanging.
 */
const MAX_GAP_DAYS = 4 * 365 + 1;
/** Real-world UTC offsets run from -12 to +14 hours. */
const MAX_OFFSET_BEHIND_MS = 12 * HOUR_MS;
const MAX_OFFSET_AHEAD_MS = 14 * HOUR_MS;

const STANDARD_ONLY = "Only standard 5-field cron is supported";
const FIELD_LIST = "(minute, hour, day of month, month, day of week)";
const MAX_QUOTED = 40;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Keeps a megabyte of pasted text out of an error message, without halving an emoji. */
function clip(value: string): string {
  if (value.length <= MAX_QUOTED) return value;
  const end = isHighSurrogate(value.charCodeAt(MAX_QUOTED - 1)) ? MAX_QUOTED - 1 : MAX_QUOTED;
  return `${value.slice(0, end)}...`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const abbreviations = (names: ReadonlyArray<string>) =>
  names.map((name) => name.slice(0, 3).toUpperCase());

const MACROS = new Map([
  ["@yearly", "0 0 1 1 *"],
  ["@annually", "0 0 1 1 *"],
  ["@monthly", "0 0 1 * *"],
  ["@weekly", "0 0 * * 0"],
  ["@daily", "0 0 * * *"],
  ["@midnight", "0 0 * * *"],
  ["@hourly", "0 * * * *"],
]);

/**
 * Quartz (`?`, `L`, `W`, `#`) and Jenkins (`H`) extensions, matched per list item so they get
 * a dialect message instead of "not a number". Month and weekday names never match: none
 * starts with H and the L and W forms need a digit or a fourth letter.
 */
const DIALECT_ITEM = /[?#]|^H(?:$|[/(])|^(?:L|LW|L-\d+|\d+[LW]|[A-Z]{3}L)$/i;

interface FieldSpec {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /**
   * The last distinct value, where `*` stops: below `max` only for day of week, whose 7
   * repeats Sunday. `a/n` still runs to `max`, so day of week `1/2` matches `1-7/2`.
   */
  readonly last: number;
  /** Three-letter names, the first standing for `min`. */
  readonly names?: { readonly kind: string; readonly codes: ReadonlyArray<string> };
}

const MINUTE: FieldSpec = { label: "Minute", min: 0, max: 59, last: 59 };
const HOUR: FieldSpec = { label: "Hour", min: 0, max: 23, last: 23 };
const DAY_OF_MONTH: FieldSpec = { label: "Day of month", min: 1, max: 31, last: 31 };
const MONTH: FieldSpec = {
  label: "Month",
  min: 1,
  max: 12,
  last: 12,
  names: { kind: "month", codes: abbreviations(MONTHS) },
};
const DAY_OF_WEEK: FieldSpec = {
  label: "Day of week",
  min: 0,
  max: 7,
  last: 6,
  names: { kind: "weekday", codes: abbreviations(WEEKDAYS) },
};

interface Field {
  /** Sorted, unique, with day of week 7 already folded to 0. */
  readonly values: ReadonlyArray<number>;
  /** Vixie cron and cronie treat a day field as unrestricted when its text starts with `*`. */
  readonly star: boolean;
  readonly full: boolean;
  /** Set when the field is a single stepped item, for "every 2nd hour" style wording. */
  readonly step: {
    readonly every: number;
    readonly whole: boolean;
    readonly tiles: boolean;
  } | null;
}

interface Schedule {
  readonly minute: Field;
  readonly hour: Field;
  readonly dayOfMonth: Field;
  readonly month: Field;
  readonly dayOfWeek: Field;
  readonly expansion: string | null;
}

class CronSyntaxError extends Error {}

function fail(message: string): never {
  throw new CronSyntaxError(message);
}

function parseValue(token: string, spec: FieldSpec): number {
  if (/^\d+$/.test(token)) {
    const value = Number(token);
    if (value < spec.min || value > spec.max)
      fail(`${spec.label}: ${clip(token)} is out of range ${spec.min} to ${spec.max}.`);
    return value;
  }
  if (spec.names) {
    const index = spec.names.codes.indexOf(token.toUpperCase());
    if (index >= 0) return index + spec.min;
    return fail(`${spec.label}: ${clip(token)} is not a number or ${spec.names.kind} name.`);
  }
  return fail(`${spec.label}: ${clip(token)} is not a number.`);
}

/** A bound as the user wrote it, minus leading zeros, for use in a suggested fix. */
const boundText = (text: string, value: number) => (/^\d+$/.test(text) ? String(value) : text);

function parseItem(item: string, spec: FieldSpec) {
  const [rangeText = "", stepText, ...extra] = item.split("/");
  if (extra.length > 0) fail(`${spec.label}: ${clip(item)} has more than one step.`);
  let every = 1;
  if (stepText !== undefined) {
    if (!/^\d+$/.test(stepText))
      fail(`${spec.label}: the step in ${clip(item)} must be a whole number.`);
    every = Number(stepText);
    if (every < 1) fail(`${spec.label}: the step in ${clip(item)} must be at least 1.`);
  }
  if (rangeText === "*") return { start: spec.min, end: spec.last, every };
  const bounds = rangeText.split("-");
  const [startText = "", endText] = bounds;
  if (bounds.length > 2 || bounds.some((bound) => bound === ""))
    fail(`${spec.label}: ${clip(rangeText)} is not a valid range.`);
  const start = parseValue(startText, spec);
  if (endText === undefined) {
    // `a/n` means `a-max/n`.
    return { start, end: stepText === undefined ? start : spec.max, every };
  }
  let end = parseValue(endText, spec);
  // Like cronie, a day-of-week range that ends on Sunday 0 ends on Sunday 7, so FRI-SUN works.
  if (start > end && end === spec.min && spec.max > spec.last) end = spec.max;
  if (start > end) {
    const to = boundText(endText, end);
    // Day of week 7 is Sunday again, so 7-3 already means 0-3 rather than a wrapped range.
    const suggestion =
      start > spec.last
        ? `${spec.min}-${to}`
        : `${boundText(startText, start)}-${spec.last},${spec.min}-${to}`;
    fail(
      `${spec.label}: ${clip(rangeText)} runs backwards. Ranges cannot wrap around; use ${suggestion} instead.`,
    );
  }
  return { start, end, every };
}

function parseField(text: string, spec: FieldSpec): Field {
  const items = text.split(",");
  if (items.some((item) => item === ""))
    fail(`${spec.label}: ${clip(text)} has an empty list item.`);
  // Repeats would be expanded again, which a pasted megabyte of `*,*,...` makes slow.
  const unique = new Set(items);
  const allowed = new Set<number>();
  let stepped: { start: number; end: number; every: number } | null = null;
  for (const item of unique) {
    if (DIALECT_ITEM.test(item))
      fail(`${spec.label}: ${clip(item)} is not standard cron syntax. ${STANDARD_ONLY}.`);
    const range = parseItem(item, spec);
    // Day of week 7 is the only value above `last`, and it means Sunday.
    for (let value = range.start; value <= range.end; value += range.every)
      allowed.add(value > spec.last ? spec.min : value);
    if (unique.size === 1 && item.includes("/")) stepped = range;
  }
  const values = [...allowed].sort((a, b) => a - b);
  const size = spec.last - spec.min + 1;
  const whole = stepped !== null && stepped.start === spec.min && stepped.end === spec.last;
  return {
    values,
    star: text.startsWith("*"),
    full: values.length === size,
    step:
      stepped && values.length > 1
        ? { every: stepped.every, whole, tiles: whole && size % stepped.every === 0 }
        : null,
  };
}

function parseExpression(text: string): Schedule {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const [first] = tokens;
  if (first === undefined) return fail("Enter a cron expression, such as 30 9 * * 1-5.");
  if (first.startsWith("@")) {
    const name = first.toLowerCase();
    if (name === "@reboot") return fail("Not a time-based schedule.");
    if (name === "@every") return fail(`${first} is not standard cron syntax. ${STANDARD_ONLY}.`);
    const expansion = MACROS.get(name);
    if (expansion === undefined) {
      return fail(
        `Unknown macro ${clip(first)}. Use @yearly, @annually, @monthly, @weekly, @daily, @midnight or @hourly.`,
      );
    }
    if (tokens.length > 1) fail(`${first} stands for all 5 fields; remove the text after it.`);
    return { ...parseFields(expansion.split(" ")), expansion };
  }
  if (tokens.length === 6 || tokens.length === 7) {
    return fail(
      `${STANDARD_ONLY}; got ${tokens.length} fields. Remove any seconds or year field, or the command after the schedule.`,
    );
  }
  if (tokens.length !== 5) fail(`Expected 5 fields ${FIELD_LIST}; got ${tokens.length}.`);
  return { ...parseFields(tokens), expansion: null };
}

function parseFields(tokens: ReadonlyArray<string>) {
  const [minute = "", hour = "", dayOfMonth = "", month = "", dayOfWeek = ""] = tokens;
  return {
    minute: parseField(minute, MINUTE),
    hour: parseField(hour, HOUR),
    dayOfMonth: parseField(dayOfMonth, DAY_OF_MONTH),
    month: parseField(month, MONTH),
    dayOfWeek: parseField(dayOfWeek, DAY_OF_WEEK),
  };
}

function parseCron(text: string): Schedule | string {
  try {
    return parseExpression(text);
  } catch (cause) {
    if (cause instanceof CronSyntaxError) return cause.message;
    throw cause;
  }
}

const pad = (value: number) => String(value).padStart(2, "0");

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = ["th", "st", "nd", "rd"][value % 10] ?? "th";
  return `${value}${suffix}`;
}

function joinList(parts: ReadonlyArray<string>, conjunction = "and"): string {
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${conjunction} ${parts.at(-1) ?? ""}`;
}

/** Consecutive values as runs; two neighbors read better as "9 and 10" than "9 through 10". */
function valueRuns(values: ReadonlyArray<number>) {
  const runs: Array<{ start: number; end: number }> = [];
  for (const value of values) {
    const previous = runs.at(-1);
    if (previous !== undefined && previous.end === value - 1) previous.end = value;
    else runs.push({ start: value, end: value });
  }
  return runs.flatMap((run) =>
    run.end - run.start === 1
      ? [
          { start: run.start, end: run.start },
          { start: run.end, end: run.end },
        ]
      : [run],
  );
}

function listPhrase(
  values: ReadonlyArray<number>,
  label: (value: number) => string = String,
  conjunction = "and",
): string {
  const parts = valueRuns(values).map((run) =>
    run.start === run.end ? label(run.start) : `${label(run.start)} through ${label(run.end)}`,
  );
  return joinList(parts, conjunction);
}

const monthName = (value: number) => MONTHS[value - 1] ?? String(value);
const weekdayName = (value: number) => WEEKDAYS[value] ?? String(value);
const plural = (values: ReadonlyArray<number>, word: string) =>
  values.length === 1 ? word : `${word}s`;
const span = (field: Field) => `${field.values[0] ?? ""} through ${field.values.at(-1) ?? ""}`;

/** Up to this many clock times are listed as times rather than minute and hour phrases. */
const MAX_CLOCK_TIMES = 6;

function describeTime(
  minute: Field,
  hour: Field,
): { readonly text: string; readonly clock: boolean } {
  if (!minute.full && !hour.full && minute.values.length * hour.values.length <= MAX_CLOCK_TIMES) {
    const times = hour.values.flatMap((h) => minute.values.map((m) => `${pad(h)}:${pad(m)}`));
    return { text: `At ${joinList(times)}`, clock: true };
  }
  // "Every n minutes" phrases cover the whole hour; specific minutes read as "past" an hour.
  let text: string;
  let everyMinute = true;
  if (minute.full) text = "Every minute";
  else if (minute.step?.tiles) text = `Every ${minute.step.every} minutes`;
  else {
    everyMinute = false;
    text = minute.step
      ? `Every ${minute.step.every} minutes from minute ${span(minute)}`
      : `At ${plural(minute.values, "minute")} ${listPhrase(minute.values)}`;
  }
  const joiner = everyMinute ? "during" : "past";
  if (hour.full) return { text: everyMinute ? text : `${text} past every hour`, clock: false };
  if (hour.step) {
    const every = `every ${ordinal(hour.step.every)} hour`;
    return {
      text: `${text} ${joiner} ${hour.step.tiles ? every : `${every} from ${span(hour)}`}`,
      clock: false,
    };
  }
  return {
    text: `${text} ${joiner} ${plural(hour.values, "hour")} ${listPhrase(hour.values)}`,
    clock: false,
  };
}

function describeDayOfMonth(field: Field): string {
  if (field.step) {
    const every = `on every ${ordinal(field.step.every)} day of the month`;
    return field.step.whole ? every : `${every} from day ${span(field)}`;
  }
  return `on ${plural(field.values, "day")} ${listPhrase(field.values)} of the month`;
}

/** The man 5 crontab rule: both day fields restricted means either one matching is enough. */
const eitherDayMatches = (schedule: Schedule) =>
  !schedule.dayOfMonth.star && !schedule.dayOfWeek.star;

function describeDays(schedule: Schedule): string | null {
  const { dayOfMonth, dayOfWeek } = schedule;
  if (eitherDayMatches(schedule)) {
    if (dayOfMonth.full || dayOfWeek.full) return null;
    return `${describeDayOfMonth(dayOfMonth)} or on ${listPhrase(dayOfWeek.values, weekdayName)}`;
  }
  if (!dayOfMonth.full && !dayOfWeek.full) {
    const weekdays = listPhrase(dayOfWeek.values, weekdayName, "or");
    return `${describeDayOfMonth(dayOfMonth)} if it falls on ${weekdays}`;
  }
  if (!dayOfMonth.full) return describeDayOfMonth(dayOfMonth);
  if (dayOfWeek.full) return null;
  const days = listPhrase(dayOfWeek.values, weekdayName);
  return valueRuns(dayOfWeek.values).every((run) => run.start === run.end)
    ? `only on ${days}`
    : days;
}

function describe(schedule: Schedule): string {
  const time = describeTime(schedule.minute, schedule.hour);
  const days = describeDays(schedule);
  const months = schedule.month.full ? null : `in ${listPhrase(schedule.month.values, monthName)}`;
  if (days === null && months === null) return time.clock ? `${time.text}, every day` : time.text;
  return [time.text, days, months].filter((part) => part !== null).join(", ");
}

function dayMatches(schedule: Schedule, month: number, day: number, weekday: number): boolean {
  if (!schedule.month.values.includes(month)) return false;
  const byMonthDay = schedule.dayOfMonth.values.includes(day);
  const byWeekday = schedule.dayOfWeek.values.includes(weekday);
  return eitherDayMatches(schedule) ? byMonthDay || byWeekday : byMonthDay && byWeekday;
}

/** The instant's wall-clock time in the zone, written as if it were a UTC timestamp. */
function wallClock(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

const offsetAt = (instant: number, timeZone: string) => wallClock(instant, timeZone) - instant;

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Turns one local day's matching wall times into instants after `now`. Offsets are read
 * just before and just after the day; when they agree the conversion is arithmetic. On a
 * transition day each time is checked against both offsets: a time in the spring-forward
 * gap matches neither and is skipped, and a time the fall-back repeats matches both and
 * runs once, at the earlier instant. Vixie cron and cronie instead run a skipped job right
 * after the jump and repeat wildcard jobs in the repeated hour, so a real daemon can differ
 * from this list on a transition day.
 */
function collectRuns(
  schedule: Schedule,
  wallDay: number,
  now: number,
  timeZone: string,
  runs: Array<number>,
): void {
  const before = offsetAt(wallDay - MAX_OFFSET_AHEAD_MS, timeZone);
  const after = offsetAt(wallDay + 24 * HOUR_MS + MAX_OFFSET_BEHIND_MS, timeZone);
  const offsets = [Math.max(before, after), Math.min(before, after)] as const;
  for (const hour of schedule.hour.values) {
    for (const minute of schedule.minute.values) {
      const wall = wallDay + hour * HOUR_MS + minute * MINUTE_MS;
      if (wall - offsets[1] <= now) continue;
      const instant =
        before === after
          ? wall - before
          : offsets.map((offset) => wall - offset).find((at) => wallClock(at, timeZone) === wall);
      if (instant === undefined || instant <= now) continue;
      runs.push(instant);
      if (runs.length === RUN_COUNT) return;
    }
  }
}

/** Walks local calendar days, so the work is per day, not per minute. */
function nextRuns(schedule: Schedule, now: number, timeZone: string): Array<number> {
  const runs: Array<number> = [];
  let { year, month, day, weekday } = zonedParts(now, timeZone);
  for (let idleDays = 0; runs.length < RUN_COUNT && idleDays <= MAX_GAP_DAYS; idleDays++) {
    if (dayMatches(schedule, month, day, weekday)) {
      const found = runs.length;
      collectRuns(schedule, Date.UTC(year, month - 1, day), now, timeZone, runs);
      if (runs.length > found) idleDays = 0;
    }
    weekday = (weekday + 1) % 7;
    day += 1;
    if (day > daysInMonth(year, month)) {
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }
  return runs;
}

export const CRON_TOOLS = {
  cron: {
    input: "text",
    inputLabel: "Cron expression",
    placeholder: "0 9 * * MON-FRI",
    options: [],
    example: { text: "30 9 * * 1-5" },
    // Explains a schedule only; nothing is installed or executed.
    run: ({ text, now, timeZone }) => {
      const schedule = parseCron(text);
      if (typeof schedule === "string") return error(schedule);
      const warnings: Array<string> = [];
      let zone = timeZone;
      if (!isValidTimeZone(zone)) {
        warnings.push(`Unknown time zone ${zone}; showing UTC.`);
        zone = "UTC";
      }
      if (eitherDayMatches(schedule) && !schedule.dayOfMonth.full && !schedule.dayOfWeek.full) {
        warnings.push(
          "Both day fields are set, so this runs when either the day of month or the day of week matches.",
        );
      }
      const runs = nextRuns(schedule, now(), zone);
      if (runs.length > 0 && runs.length < RUN_COUNT) {
        warnings.push(
          runs.length === 1
            ? "Only 1 run found; the schedule does not run again within 4 years of it."
            : `Only ${runs.length} runs found; the schedule does not run again within 4 years of the last one.`,
        );
      }
      return ok(
        [
          { label: "Description", value: describe(schedule) },
          ...(schedule.expansion === null
            ? []
            : [{ label: "Expands to", value: schedule.expansion, monospace: true }]),
          {
            label: `Next runs (${zone})`,
            value:
              runs.length === 0
                ? "None within the next 4 years."
                : runs.map((run) => formatLocal(run, zone)).join("\n"),
            monospace: true,
          },
        ],
        warnings,
      );
    },
  },
} satisfies Record<string, UtilityToolImpl>;
