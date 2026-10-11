import {
  PCB_SWEEP_LIMIT,
  PCB_VARIANT_LIMIT,
  type PcbParameter,
  type PcbVariant,
} from "@t3tools/contracts/fork";
export const SWEEP_LIMIT = PCB_SWEEP_LIMIT;
export const VARIANT_LIMIT = PCB_VARIANT_LIMIT;
export type Value = string | number | boolean;
export type SweepInput =
  | { from: number; to: number; count: number }
  | readonly Value[]
  | string
  | undefined;
export function sweepValues(parameter: PcbParameter, input: SweepInput): Value[] {
  let values: Value[];
  if (parameter.type === "boolean") values = [false, true];
  else if (Array.isArray(input)) values = [...input];
  else if (parameter.type === "string" && typeof input === "string")
    values = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  else if (parameter.type === "number" && input && typeof input === "object" && "count" in input) {
    const { from, to, count } = input;
    if (
      ![from, to].every(Number.isFinite) ||
      !Number.isInteger(count) ||
      count < 2 ||
      count > SWEEP_LIMIT
    )
      throw new Error(`Choose 2 to ${SWEEP_LIMIT} finite steps.`);
    values = Array.from({ length: count }, (_, i) => {
      let value = from + ((to - from) * i) / (count - 1);
      if (parameter.step !== undefined && parameter.step > 0)
        value =
          (parameter.min ?? 0) +
          Math.round((value - (parameter.min ?? 0)) / parameter.step) * parameter.step;
      value = Math.max(parameter.min ?? -Infinity, Math.min(parameter.max ?? Infinity, value));
      return Number(value.toPrecision(12));
    });
  } else throw new Error("Choose values for each sweep parameter.");
  values = [...new Set(values)];
  if (
    !values.length ||
    values.length > SWEEP_LIMIT ||
    values.some(
      (v) =>
        typeof v !== parameter.type ||
        (typeof v === "number" &&
          (!Number.isFinite(v) ||
            (parameter.min !== undefined && v < parameter.min) ||
            (parameter.max !== undefined && v > parameter.max))) ||
        (parameter.choices && !parameter.choices.includes(v as number | string)),
    )
  )
    throw new Error("Choose valid values within the parameter's range and choices.");
  return values;
}
export type Axis = { parameter: PcbParameter; values: readonly Value[] };
export function candidateName(axes: readonly Axis[], values: Record<string, Value>) {
  return axes
    .map((a) => `${a.parameter.key} ${String(values[a.parameter.key])}`)
    .join(" / ")
    .slice(0, 200);
}
export function generateCandidates(base: Record<string, Value>, axes: readonly Axis[]) {
  if (
    !axes.length ||
    axes.length > 2 ||
    new Set(axes.map((a) => a.parameter.key)).size !== axes.length
  )
    throw new Error("Choose one or two different parameters.");
  let rows = [base];
  for (const axis of axes) {
    const values = sweepValues(axis.parameter, axis.values);
    if (rows.length * values.length > SWEEP_LIMIT)
      throw new Error(`A sweep can make at most ${SWEEP_LIMIT} variants.`);
    rows = rows.flatMap((row) => values.map((value) => ({ ...row, [axis.parameter.key]: value })));
  }
  return rows.map((values) => ({ name: candidateName(axes, values), values }));
}
export const BOARD_COLUMNS = {
  copperLayers: "Copper layers",
  frontComponents: "Front parts",
  backComponents: "Back parts",
  platedHoles: "Plated holes",
  nonPlatedHoles: "Unplated holes",
  throughVias: "Through vias",
  blindOrMicroVias: "Blind/micro vias",
  minDrillMm: "Min drill",
  minTrackMm: "Min track",
  minAnnularRingMm: "Min annular ring",
  minViaDiameterMm: "Min via diameter",
  maxHeightMm: "Max height",
};
export type SortKey =
  | "name"
  | "width"
  | "height"
  | "area"
  | "components"
  | "issues"
  | keyof typeof BOARD_COLUMNS;
export function variantStat(v: PcbVariant, key: Exclude<SortKey, "name">) {
  const s = v.stats;
  if (!s) return null;
  if (key === "width") return s.widthMm;
  if (key === "height") return s.heightMm;
  if (key === "area") return s.board.areaMm2 ?? s.widthMm * s.heightMm;
  if (key === "components") return s.components;
  if (key === "issues") return s.errors + s.warnings;
  return s.board[key] ?? null;
}
export function sortVariants(
  variants: readonly PcbVariant[],
  key: SortKey,
  direction: "asc" | "desc",
) {
  return [...variants].sort((a, b) => {
    if (!a.stats !== !b.stats) return a.stats ? -1 : 1;
    const av = key === "name" ? a.name : variantStat(a, key),
      bv = key === "name" ? b.name : variantStat(b, key);
    if (av === null || bv === null)
      return av === bv ? a.name.localeCompare(b.name) : av === null ? 1 : -1;
    const comparison =
      typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv)
        : Number(av) - Number(bv);
    return comparison * (direction === "asc" ? 1 : -1) || a.name.localeCompare(b.name);
  });
}
