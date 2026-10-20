// culori/fn registers no color spaces on its own; this registers every CSS one, as themePalette.ts does.
import "culori/css";
import {
  type Color,
  converter,
  formatCss,
  formatHex,
  formatHex8,
  formatHsl,
  formatRgb,
  parse,
  round,
  toGamut,
} from "culori/fn";

import {
  error,
  numberOption,
  ok,
  stringOption,
  type UtilityOutputField,
  type UtilityResult,
  type UtilityToolImpl,
} from "../types";
import { formatLocal, isValidTimeZone, zonedParts } from "./time";

const isSpace = (char: string | undefined) => char !== undefined && /\s/u.test(char);

const MIN_BASE = 2;
const MAX_BASE = 36;
// Converting is quadratic in the digit count, so a pasted megabyte of digits must not reach BigInt.
const MAX_NUMBER_DIGITS = 20_000;

// A Map, so an option value such as "constructor" cannot reach Object.prototype.
const FIXED_BASES = new Map([
  ["2", 2],
  ["8", 8],
  ["10", 10],
  ["16", 16],
]);
const PREFIX_BASES = new Map([
  ["b", 2],
  ["o", 8],
  ["x", 16],
]);

const clampBase = (base: number) => Math.min(MAX_BASE, Math.max(MIN_BASE, Math.round(base)));

/** 0 to 9, then a (or A) as 10 up to z as 35; -1 for anything else. */
function digitValue(char: string): number {
  if (char.length !== 1) return -1;
  const code = char.charCodeAt(0);
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  const lower = code | 0x20;
  return lower >= 0x61 && lower <= 0x7a ? lower - 0x61 + 10 : -1;
}

/**
 * An integer of any size, or the error message. Digits are validated one at a time so the
 * error can name the bad one, and folded into the BigInt in chunks that stay below 2^53, so
 * the Number holding a chunk is always exact.
 */
function parseInteger(text: string, from: number | "auto"): bigint | string {
  const chars = Array.from(text);
  let start = 0;
  let end = chars.length;
  while (start < end && isSpace(chars[start])) start++;
  while (end > start && isSpace(chars[end - 1])) end--;
  const negative = chars[start] === "-";
  if (negative) start++;

  let base = from === "auto" ? 10 : from;
  // A prefix only counts when it names the chosen base: in base 16, "0b1" is the number b1.
  const prefixBase =
    chars[start] === "0" ? PREFIX_BASES.get((chars[start + 1] ?? "").toLowerCase()) : undefined;
  if (prefixBase !== undefined && (from === "auto" || from === prefixBase)) {
    base = prefixBase;
    start += 2;
  }

  const chunkDigits = Math.floor(52 / Math.log2(base));
  const chunkScale = BigInt(base) ** BigInt(chunkDigits);
  let value = 0n;
  let chunk = 0;
  let chunkLength = 0;
  let digits = 0;
  for (let index = start; index < end; index++) {
    const char = chars[index] ?? "";
    if (char === "_" || isSpace(char)) continue;
    const digit = digitValue(char);
    if (digit < 0 || digit >= base) {
      return `Invalid digit "${char}" for base ${base} at position ${index + 1}.`;
    }
    digits++;
    if (digits > MAX_NUMBER_DIGITS) return "Numbers are limited to 20,000 digits.";
    chunk = chunk * base + digit;
    chunkLength++;
    if (chunkLength === chunkDigits) {
      value = value * chunkScale + BigInt(chunk);
      chunk = 0;
      chunkLength = 0;
    }
  }
  if (digits === 0) return "No digits to convert.";
  if (chunkLength > 0) value = value * BigInt(base) ** BigInt(chunkLength) + BigInt(chunk);
  return negative ? -value : value;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// The ECMAScript time value range.
const MAX_DATE_MS = 100_000_000 * DAY_MS;
const isInRange = (ms: number) => Number.isFinite(ms) && Math.abs(ms) <= MAX_DATE_MS;
// 1e11 seconds is past the year 5000, while 1e11 milliseconds is 1973.
const AUTO_MILLISECONDS_FROM = 1e11;

const OUT_OF_RANGE = "Out of range: dates must be within 100,000,000 days of 1970-01-01.";
const ISO_SAMPLE = "2026-10-20T14:03:05Z";

// The fraction needs its dot: with `\d+\.?\d*` every way of sharing the digits between the two
// runs is retried before a failure, which is quadratic on a long run of digits.
const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const ISO_LIKE = /^[-+]?\d{4,6}-\d/;
const ISO_DATE =
  /^([-+]\d{6}|\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)? ?(Z|[-+]\d{2}(?::?\d{2})?)?)?$/i;

const RELATIVE_UNITS = [
  { unit: "year", ms: 365.2425 * DAY_MS },
  { unit: "month", ms: 30.436875 * DAY_MS },
  { unit: "week", ms: 7 * DAY_MS },
  { unit: "day", ms: DAY_MS },
  { unit: "hour", ms: HOUR_MS },
  { unit: "minute", ms: MINUTE_MS },
  { unit: "second", ms: SECOND_MS },
] as const satisfies ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }>;

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeTime(diff: number): string {
  const step =
    RELATIVE_UNITS.find((candidate) => Math.abs(diff) >= candidate.ms) ?? RELATIVE_UNITS[6];
  return relativeFormat.format(Math.round(diff / step.ms), step.unit);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Days from 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's days_from_civil).
 * Date.UTC would read years 0 to 99 as 1900 to 1999, and gives NaN just past the Date range,
 * where a wall-clock time with an offset can still name an instant inside it.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  // Counting years from March puts the leap day at the end of one.
  const marchYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(marchYear / 400);
  const yearOfEra = marchYear - era * 400;
  const dayOfYear = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function utcFromFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): number {
  return (
    daysFromCivil(year, month, day) * DAY_MS +
    hour * HOUR_MS +
    minute * MINUTE_MS +
    second * SECOND_MS +
    millisecond
  );
}

const clampToRange = (ms: number) => Math.min(MAX_DATE_MS, Math.max(-MAX_DATE_MS, ms));

/** How far the zone's wall clock is ahead of UTC at an instant in range, to the second. */
function zoneOffset(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const wall = utcFromFields(p.year, p.month, p.day, p.hour, p.minute, p.second, 0);
  return wall - Math.floor(ms / SECOND_MS) * SECOND_MS;
}

/**
 * The instant a wall-clock time names in a zone, resolved the way Date and Temporal's
 * "compatible" mode do in every zone: a repeated time is its first occurrence, and a skipped
 * time moves forward by the length of the gap.
 */
function wallTimeToInstant(wall: number, timeZone: string): number {
  // A zone changes offset at most once in a day, so these are the only offsets that can apply.
  const before = zoneOffset(clampToRange(wall - DAY_MS), timeZone);
  const after = zoneOffset(clampToRange(wall + DAY_MS), timeZone);
  const matches = [wall - before, wall - after].filter(
    (ms) => isInRange(ms) && zoneOffset(ms, timeZone) === wall - ms,
  );
  return matches.length > 0 ? Math.min(...matches) : wall - before;
}

/** An ISO 8601 date or date-time as an instant, or the error message. */
function parseIsoDate(
  text: string,
  timeZone: string,
): { readonly ms: number; readonly hasOffset: boolean } | string {
  const match = ISO_DATE.exec(text);
  if (!match) return `Not a valid ISO 8601 date. Use a form such as ${ISO_SAMPLE}.`;
  const [, yearText = "", monthText = "", dayText = ""] = match;
  const [hourText = "0", minuteText = "0", secondText = "0", fraction = "", offset] =
    match.slice(4);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12) return `Month ${monthText} does not exist.`;
  if (day < 1 || day > daysInMonth(year, month)) {
    return `There is no day ${dayText} in ${yearText}-${monthText}.`;
  }
  if (Number(hourText) > 23) return "Hours must be 00 to 23.";
  if (Number(minuteText) > 59) return "Minutes must be 00 to 59.";
  if (Number(secondText) > 59) return "Seconds must be 00 to 59.";

  const wall = utcFromFields(
    year,
    month,
    day,
    Number(hourText),
    Number(minuteText),
    Number(secondText),
    Number(fraction.slice(0, 3).padEnd(3, "0")),
  );
  if (offset === undefined) return { ms: wallTimeToInstant(wall, timeZone), hasOffset: false };
  if (offset.toUpperCase() === "Z") return { ms: wall, hasOffset: true };

  const offsetDigits = offset.slice(1).replace(":", "");
  const offsetHours = Number(offsetDigits.slice(0, 2));
  const offsetMinutes = Number(offsetDigits.slice(2) || "0");
  if (offsetHours > 23 || offsetMinutes > 59) {
    return "The UTC offset must be between -23:59 and +23:59.";
  }
  const sign = offset.startsWith("-") ? -1 : 1;
  return { ms: wall - sign * (offsetHours * HOUR_MS + offsetMinutes * MINUTE_MS), hasOffset: true };
}

function describeInstant(ms: number, now: number, timeZone: string) {
  return {
    utc: { label: "UTC (ISO 8601)", value: new Date(ms).toISOString(), monospace: true },
    local: { label: `Local (${timeZone})`, value: formatLocal(ms, timeZone), monospace: true },
    relative: { label: "Relative", value: relativeTime(ms - now) },
    seconds: { label: "Seconds", value: String(Math.floor(ms / SECOND_MS)), monospace: true },
    milliseconds: { label: "Milliseconds", value: String(ms), monospace: true },
  } satisfies Record<string, UtilityOutputField>;
}

function convertTimestamp(
  text: string,
  unitOption: string,
  now: number,
  timeZone: string,
): UtilityResult {
  if (text.toLowerCase() === "now") {
    const time = describeInstant(now, now, timeZone);
    return ok([time.seconds, time.milliseconds, time.utc, time.local, time.relative]);
  }

  if (NUMBER.test(text)) {
    const value = Number(text);
    const detected = unitOption !== "seconds" && unitOption !== "milliseconds";
    const unit =
      unitOption === "milliseconds" || (detected && Math.abs(value) >= AUTO_MILLISECONDS_FROM)
        ? "Milliseconds"
        : "Seconds";
    const ms = Math.round(unit === "Seconds" ? value * SECOND_MS : value);
    if (!isInRange(ms)) return error(OUT_OF_RANGE);
    const time = describeInstant(ms, now, timeZone);
    const unitField = { label: "Unit", value: detected ? `${unit} (auto-detected)` : unit };
    return ok([unitField, time.utc, time.local, time.relative, time.seconds, time.milliseconds]);
  }

  if (!ISO_LIKE.test(text)) {
    return error(
      `Enter Unix seconds or milliseconds, an ISO 8601 date such as ${ISO_SAMPLE}, or now.`,
    );
  }
  const parsed = parseIsoDate(text, timeZone);
  if (typeof parsed === "string") return error(parsed);
  if (!isInRange(parsed.ms)) return error(OUT_OF_RANGE);
  const time = describeInstant(parsed.ms, now, timeZone);
  return ok(
    [time.seconds, time.milliseconds, time.utc, time.local, time.relative],
    parsed.hasOffset ? [] : [`No time zone given, so this is read as local time in ${timeZone}.`],
  );
}

const toRgb = converter("rgb");
const toOklch = converter("oklch");
// The CSS Color 4 gamut mapping: lower chroma in OKLCH until the color fits sRGB.
const toSrgbGamut = toGamut("rgb", "oklch");
// Conversion noise such as 1.0000000000000002 rounds to the same 8-bit value, so it is not
// reported as out of gamut.
const GAMUT_TOLERANCE = 0.5 / 255;

const round2 = round(2);
const round3 = round(3);
const round4 = round(4);

function isOutsideSrgb(color: Color): boolean {
  const { r, g, b } = toRgb(color);
  return [r, g, b].some((channel) => channel < -GAMUT_TOLERANCE || channel > 1 + GAMUT_TOLERANCE);
}

function formatOklch(color: Color): string {
  const { l, c, h, alpha } = toOklch(color);
  const chroma = round4(c);
  // Without chroma the hue is conversion noise; CSS writes a missing hue as none.
  const hue = chroma === 0 || h === undefined ? {} : { h: round2(h) };
  return formatCss({
    mode: "oklch",
    l: round4(l),
    c: chroma,
    ...hue,
    ...(alpha === undefined ? {} : { alpha: round3(alpha) }),
  });
}

/**
 * "rgb(1, 2, 3)" with an alpha as "rgba(1, 2, 3, 0.502)". culori writes alpha with two decimals,
 * which turns an alpha of 1/255 into 0 and 254/255 into 1; three keep every 8-bit level apart,
 * as the OKLCH field does.
 */
function withAlpha(opaque: string, alpha: number | undefined): string {
  if (alpha === undefined || alpha >= 1) return opaque;
  const open = opaque.indexOf("(");
  return `${opaque.slice(0, open)}a${opaque.slice(open, -1)}, ${round3(Math.max(0, alpha))})`;
}

function convertColor(text: string): UtilityResult {
  // CSS color syntax is case-insensitive, but culori only matches lowercase function names.
  const color = parse(text.trim().toLowerCase());
  if (!color) return error("Not a CSS color.");
  const outside = isOutsideSrgb(color);
  const srgb = outside ? toSrgbGamut(color) : toRgb(color);
  const hex = srgb.alpha === undefined || srgb.alpha >= 1 ? formatHex(srgb) : formatHex8(srgb);
  const rgb = withAlpha(formatRgb({ ...srgb, alpha: 1 }), srgb.alpha);
  const hsl = withAlpha(formatHsl({ ...srgb, alpha: 1 }), srgb.alpha);
  const oklch = formatOklch(color);
  return ok(
    [
      { label: "Hex", value: hex, monospace: true, color: hex },
      { label: "RGB", value: rgb, monospace: true, color: rgb },
      { label: "HSL", value: hsl, monospace: true, color: hsl },
      { label: "OKLCH", value: oklch, monospace: true, color: oklch },
    ],
    outside
      ? ["Outside the sRGB gamut, so hex, RGB and HSL show the nearest color sRGB can display."]
      : [],
  );
}

// An apostrophe inside a word ("don't") is dropped so the word stays whole in identifiers.
const IN_WORD_APOSTROPHE = /(?<=\p{L})['’](?=\p{L})/gu;
const WORD_RUN = /[\p{L}\p{M}\p{N}]+/gu;
// Before a capital that follows a lowercase letter or digit ("id2|Value"), and between an
// acronym and the capitalized word after it ("XML|Http"). The lookahead comes first so the
// lookbehind, which walks back over combining marks, only runs before a capital; tried at every
// position it is quadratic on a long run of marks.
const CASE_BOUNDARY = /(?=\p{Lu})(?<=[\p{Ll}\p{N}]\p{M}*)|(?=\p{Lu}\p{M}*\p{Ll})(?<=\p{Lu}\p{M}*)/u;

function splitWords(text: string): ReadonlyArray<string> {
  const runs = text.replace(IN_WORD_APOSTROPHE, "").match(WORD_RUN) ?? [];
  return runs.flatMap((run) => run.split(CASE_BOUNDARY));
}

const lower = (word: string) => word.toLowerCase();
const upper = (word: string) => word.toUpperCase();

// By code point, so a cased letter outside the BMP is not split in half.
function capitalize(word: string): string {
  const first = word.codePointAt(0);
  if (first === undefined) return word;
  const head = String.fromCodePoint(first);
  return head.toUpperCase() + word.slice(head.length).toLowerCase();
}

const CASE_STYLES: ReadonlyArray<{
  readonly label: string;
  readonly monospace: boolean;
  readonly convert: (words: ReadonlyArray<string>) => string;
}> = [
  {
    label: "camelCase",
    monospace: true,
    convert: (words) =>
      words.map((word, index) => (index === 0 ? lower(word) : capitalize(word))).join(""),
  },
  { label: "PascalCase", monospace: true, convert: (words) => words.map(capitalize).join("") },
  { label: "snake_case", monospace: true, convert: (words) => words.map(lower).join("_") },
  { label: "CONSTANT_CASE", monospace: true, convert: (words) => words.map(upper).join("_") },
  { label: "kebab-case", monospace: true, convert: (words) => words.map(lower).join("-") },
  { label: "Title Case", monospace: false, convert: (words) => words.map(capitalize).join(" ") },
  {
    label: "Sentence case",
    monospace: false,
    convert: (words) =>
      words.map((word, index) => (index === 0 ? capitalize(word) : lower(word))).join(" "),
  },
  { label: "lower case", monospace: false, convert: (words) => words.map(lower).join(" ") },
  { label: "UPPER CASE", monospace: false, convert: (words) => words.map(upper).join(" ") },
];

function convertCase(text: string): UtilityResult {
  // Line by line, so a pasted list of names converts as a list rather than one long name.
  const lines = text.split(/\r\n|\r|\n/).map(splitWords);
  if (lines.every((words) => words.length === 0)) return error("No letters or digits to convert.");
  return ok(
    CASE_STYLES.map((style) => ({
      label: style.label,
      value: lines.map((words) => style.convert(words)).join("\n"),
      monospace: style.monospace,
    })),
  );
}

export const CONVERT_TOOLS = {
  "number-base": {
    input: "text",
    inputLabel: "Number",
    placeholder: "255, 0xff, 0b1111_1111 or 0o377",
    options: [
      {
        kind: "select",
        id: "from",
        label: "Input base",
        choices: [
          { value: "auto", label: "Auto (prefix or decimal)" },
          { value: "2", label: "Binary" },
          { value: "8", label: "Octal" },
          { value: "10", label: "Decimal" },
          { value: "16", label: "Hexadecimal" },
          { value: "custom", label: "Custom base" },
        ],
        defaultValue: "auto",
      },
      {
        kind: "number",
        id: "customBase",
        label: "Custom base",
        min: MIN_BASE,
        max: MAX_BASE,
        defaultValue: MAX_BASE,
      },
    ],
    example: { text: "0xDEAD_BEEF" },
    run: ({ text, options }) => {
      const from = stringOption(options, "from", "auto");
      const customBase = clampBase(numberOption(options, "customBase", MAX_BASE));
      const base = from === "custom" ? customBase : (FIXED_BASES.get(from) ?? "auto");
      const value = parseInteger(text, base);
      if (typeof value === "string") return error(value);
      return ok([
        { label: "Decimal", value: value.toString(10), monospace: true },
        { label: "Hexadecimal", value: value.toString(16), monospace: true },
        { label: "Octal", value: value.toString(8), monospace: true },
        { label: "Binary", value: value.toString(2), monospace: true },
        { label: `Base ${customBase}`, value: value.toString(customBase), monospace: true },
      ]);
    },
  },
  timestamp: {
    input: "text",
    inputLabel: "Time",
    placeholder: "1700000000, 1700000000000, 2026-10-20T14:03:05Z or now",
    options: [
      {
        kind: "select",
        id: "unit",
        label: "Input unit",
        choices: [
          { value: "auto", label: "Auto" },
          { value: "seconds", label: "Seconds" },
          { value: "milliseconds", label: "Milliseconds" },
        ],
        defaultValue: "auto",
      },
    ],
    example: { text: "1700000000" },
    run: ({ text, options, now, timeZone }) => {
      const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
      try {
        return convertTimestamp(text.trim(), stringOption(options, "unit", "auto"), now(), zone);
      } catch {
        // Intl throws a RangeError for instants it cannot format, which only happens near the
        // ends of the range.
        return error(OUT_OF_RANGE);
      }
    },
  },
  color: {
    input: "text",
    inputLabel: "Color",
    placeholder: "#3b82f6, rgb(59 130 246), hsl(217 91% 60%) or oklch(0.62 0.19 260)",
    options: [],
    example: { text: "tomato" },
    run: ({ text }) => {
      try {
        return convertColor(text);
      } catch {
        return error("Not a CSS color.");
      }
    },
  },
  case: {
    input: "text",
    inputLabel: "Text",
    placeholder: "XMLHttpRequest, user_id or a few words",
    options: [],
    example: { text: "XMLHttpRequest id2Value" },
    run: ({ text }) => convertCase(text),
  },
} satisfies Record<string, UtilityToolImpl>;
