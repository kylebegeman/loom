/** Range for a scrubbable number field. Unbounded fields scrub by one step per pixel. */
export type ScrubRange = { min: number | null; max: number | null; step: number };

/** Pointer travel before a press becomes a drag instead of a click-to-type. */
export const SCRUB_DRAG_THRESHOLD = 3;

export function stepDecimals(step: number) {
  const [, fraction = "", exponent] = /^-?\d*\.?(\d*)(?:e-(\d+))?$/i.exec(String(step)) ?? [];
  return exponent ? Number(exponent) + fraction.length : fraction.length;
}

const clamp = (value: number, range: ScrubRange) =>
  Math.min(range.max ?? Infinity, Math.max(range.min ?? -Infinity, value));

/** Round to the step grid, anchored at the minimum, then clamp to the range. */
export function snapScrub(value: number, range: ScrubRange) {
  const origin = range.min ?? 0;
  const stepped = origin + Math.round((value - origin) / range.step) * range.step;
  return Number(clamp(stepped, range).toFixed(stepDecimals(range.step)));
}

/** Value after dragging `dx` pixels across a field `width` pixels wide. Fine mode moves ten times slower. */
export function scrubValue(
  start: number,
  dx: number,
  width: number,
  range: ScrubRange,
  fine: boolean,
) {
  const scale = fine ? 0.1 : 1;
  const span =
    range.min !== null && range.max !== null
      ? (dx / Math.max(1, width)) * (range.max - range.min)
      : dx * range.step;
  return snapScrub(start + span * scale, range);
}

/** Arrow keys move one step, or ten with Shift. */
export const stepScrub = (value: number, direction: 1 | -1, range: ScrubRange, coarse: boolean) =>
  snapScrub(value + direction * range.step * (coarse ? 10 : 1), range);

/** Typed values keep their precision but stay inside the range. */
export const typedScrub = (value: number, range: ScrubRange) =>
  Number(clamp(value, range).toFixed(Math.max(3, stepDecimals(range.step))));

export function formatScrub(value: number, step: number) {
  const precision = Math.max(stepDecimals(step), stepDecimals(Math.abs(value)));
  return value.toFixed(Math.min(precision, 6));
}

/** Fill fraction for a bounded field, or null when the field has no range. */
export function scrubFill(value: number, range: ScrubRange) {
  if (range.min === null || range.max === null || range.max <= range.min) return null;
  return (clamp(value, range) - range.min) / (range.max - range.min);
}
