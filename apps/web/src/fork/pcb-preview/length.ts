import * as Schema from "effect/Schema";

export const PcbLengthUnit = Schema.Literals(["mm", "mil", "in"]);
export type PcbLengthUnit = typeof PcbLengthUnit.Type;
const MM_PER_INCH = 25.4;
const MM_PER_MIL = 0.0254;
const MM_PER = { mm: 1, mil: MM_PER_MIL, in: MM_PER_INCH } as const;
export const toMm = (value: number, unit: PcbLengthUnit) => value * MM_PER[unit];
export const fromMm = (mm: number, unit: PcbLengthUnit) => mm / MM_PER[unit];
export const unitName = (unit: PcbLengthUnit) =>
  ({ mm: "millimetres", mil: "mils", in: "inches" })[unit];

/** A missing report unit uses KiCad's millimetre default. Unknown units cannot be located. */
export function reportUnit(raw: string | undefined): PcbLengthUnit | null {
  if (raw === undefined || raw === "mm") return "mm";
  if (raw === "mil" || raw === "mils") return "mil";
  return raw === "in" ? "in" : null;
}
export type LengthOptions = {
  /** Millimetre decimals, default two. Mils get one fewer and inches one more. */
  digits?: number;
  unit?: boolean;
  trim?: boolean;
};

/** Formats millimetres for reading without changing saved or tool values. */
export function formatLength(mm: number, unit: PcbLengthUnit, options: LengthOptions = {}) {
  const digits = Math.max(0, (options.digits ?? 2) + (unit === "mil" ? -1 : unit === "in" ? 1 : 0));
  let value = fromMm(mm, unit).toFixed(digits);
  if (Number(value) === 0) value = value.replace(/^-/, "");
  if (options.trim) value = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return value + (options.unit === false ? "" : ` ${unit}`);
}

/** Several dimensions share one unit suffix; unknown dimensions are omitted. */
export function formatLengths(
  values: readonly (number | null)[],
  unit: PcbLengthUnit,
  options: LengthOptions = {},
) {
  const lengths = values
    .filter((value) => value !== null)
    .map((value) => formatLength(value, unit, { ...options, unit: false }));
  return lengths.join(" × ") + (lengths.length && options.unit !== false ? ` ${unit}` : "");
}

/** Areas use square inches for both mil and inch length preferences. */
export function formatArea(mm2: number, unit: PcbLengthUnit, digits = 2) {
  const inches = unit !== "mm";
  let value = (inches ? mm2 / MM_PER_INCH ** 2 : mm2).toFixed(digits);
  if (Number(value) === 0) value = value.replace(/^-/, "");
  return `${value} ${inches ? "in" : "mm"}²`;
}

/** Parses a nonnegative hardware length. An explicit suffix overrides the display unit. */
export function parseLength(text: string, unit: PcbLengthUnit): number | null {
  const match = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(mm|mils?|in|")?\s*$/i.exec(text);
  if (!match) return null;
  const suffix = match[2]?.toLowerCase();
  const from = suffix === '"' ? "in" : suffix ? reportUnit(suffix) : unit;
  if (!from) return null;
  const mm = toMm(Number(match[1]), from);
  return Number.isFinite(mm) ? mm : null;
}
