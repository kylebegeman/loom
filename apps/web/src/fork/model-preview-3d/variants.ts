import type { ScadParameter } from "@t3tools/contracts/fork";

/** Values one parameter may list. */
const MAX_VARIANT_VALUES = 6;
/** Variants one sweep makes, so two parameters form at most a 2 × 3 grid. */
export const MAX_VARIANTS = 6;

/** One parameter explored over a list of OpenSCAD literals. */
export type VariantAxis = { name: string; values: readonly string[] };
export type VariantCandidate = { name: string; values: Record<string, string> };
type Result<T> = T | { error: string };

/** A number as names show it: no float noise or trailing zeros. */
const variantValue = (value: number) => String(Number(value.toFixed(6)));

/** A literal as names show it: numbers through variantValue, text without quotes. */
function shownValue(literal: string) {
  if (literal.startsWith('"')) {
    try {
      const text: unknown = JSON.parse(literal);
      if (typeof text === "string") return text;
    } catch {
      return literal;
    }
  }
  const number = Number(literal);
  return literal.trim() && Number.isFinite(number) ? variantValue(number) : literal;
}

/** Stable for the same values, e.g. "width 40 · wall 2". */
export const variantName = (axes: readonly { name: string }[], literals: readonly string[]) =>
  axes.map((axis, index) => `${axis.name} ${shownValue(literals[index]!)}`).join(" · ");

/**
 * Reads a typed list such as "30, 40 50". An empty list is an error so a missing value never
 * silently drops a parameter.
 */
export function parseValues(text: string): Result<number[]> {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return { error: "List at least one value." };
  const values = tokens.map(Number);
  const bad = tokens.find((_, index) => !Number.isFinite(values[index]));
  return bad === undefined ? values : { error: `"${bad}" is not a number.` };
}

/**
 * Reads one parameter's typed list into OpenSCAD literals. Numbers and switches split on commas,
 * spaces or semicolons; text splits on commas or semicolons so words can contain spaces.
 */
export function sweepValues(parameter: ScadParameter, input: string): Result<string[]> {
  if (parameter.kind === "number") {
    const values = parseValues(input);
    return "error" in values ? values : values.map(String);
  }
  if (parameter.kind === "vector") return { error: "Use a saved set to explore vector values." };
  const tokens = input
    .split(parameter.kind === "string" ? /[,;]/ : /[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return { error: "List at least one value." };
  if (parameter.kind === "string") return tokens.map((token) => JSON.stringify(token));
  const bad = tokens.find((token) => token !== "true" && token !== "false");
  return bad === undefined ? tokens : { error: `"${bad}" is not true or false.` };
}

/**
 * Every combination of the axes' values on top of the base values. One or two distinct
 * parameters, each with unique values inside its range, and at most MAX_VARIANTS combinations.
 */
export function expandVariants(
  parameters: readonly ScadParameter[],
  base: Readonly<Record<string, string>>,
  axes: readonly VariantAxis[],
): Result<VariantCandidate[]> {
  if (axes.length < 1 || axes.length > 2) return { error: "Explore one or two parameters." };
  if (axes.length === 2 && axes[0]!.name === axes[1]!.name)
    return { error: "Choose two different parameters." };
  for (const axis of axes) {
    const parameter = parameters.find((item) => item.name === axis.name);
    if (!parameter) return { error: `No parameter is named ${axis.name}.` };
    if (!axis.values.length) return { error: `List at least one value for ${axis.name}.` };
    if (axis.values.length > MAX_VARIANT_VALUES)
      return { error: `List up to ${MAX_VARIANT_VALUES} values for ${axis.name}.` };
    if (new Set(axis.values.map(shownValue)).size !== axis.values.length)
      return { error: `Each value for ${axis.name} must be different.` };
    if (parameter.kind !== "number") continue;
    const range = parameter.range;
    const outside = axis.values.find((literal) => {
      const value = Number(literal);
      return (
        !Number.isFinite(value) || (range !== null && (value < range.min || value > range.max))
      );
    });
    if (outside !== undefined)
      return {
        error: range
          ? `${axis.name} ${shownValue(outside)} is outside ${variantValue(range.min)} to ${variantValue(range.max)}.`
          : `${axis.name} ${outside} is not a number.`,
      };
  }
  const count = axes.reduce((total, axis) => total * axis.values.length, 1);
  if (count > MAX_VARIANTS)
    return { error: `That makes ${count} variants; explore up to ${MAX_VARIANTS} at once.` };
  const combos = axes.reduce<string[][]>(
    (rows, axis) => rows.flatMap((row) => axis.values.map((value) => [...row, value])),
    [[]],
  );
  return combos.map((combo) => ({
    name: variantName(axes, combo),
    values: {
      ...base,
      ...Object.fromEntries(axes.map((axis, index) => [axis.name, combo[index]!])),
    },
  }));
}
