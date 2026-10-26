/**
 * Dragging a parameter's name moves its value along the step grid. Steps count from the drag start
 * so the value stays on the grid, held inside the range so reversing at a limit responds at once.
 * Ported from the Loom 3D widget's `shared/scrub.ts`; a missing bound leaves that side open, with
 * the grid through zero.
 */
import type { ScadParameter } from "@t3tools/contracts/fork";
import { vectorParameterValue } from "./params";
import type { ScrubRange } from "./scrub";

export type ScrubModifiers = { fast: boolean; fine: boolean };

/** Pixels of drag per step at normal speed. */
export const SCRUB_PX_PER_STEP = 4;
/** Shift scrubs this many times faster; Alt as many times slower. */
export const SCRUB_FACTOR = 10;

/** Steps covered by `dx` pixels of drag. Fractions accumulate across moves. */
export function scrubSteps(dx: number, { fast, fine }: ScrubModifiers): number {
  const rate = fast ? SCRUB_FACTOR : fine ? 1 / SCRUB_FACTOR : 1;
  return (dx / SCRUB_PX_PER_STEP) * rate;
}

/**
 * A step count that float division left a hair off a whole number, such as 2.9999999999999996
 * for 0.3 / 0.1, snapped to it. Otherwise whole steps would stop one short of a limit.
 */
const STEP_EPSILON = 1e-9;
const wholeSteps = (steps: number) => {
  const nearest = Math.round(steps);
  return Math.abs(steps - nearest) < STEP_EPSILON ? nearest : steps;
};

/** Holds an accumulated step count to the steps the range allows. */
export function clampSteps(steps: number, start: number, range: ScrubRange): number {
  const low = range.min === null ? -Infinity : wholeSteps((range.min - start) / range.step),
    high = range.max === null ? Infinity : wholeSteps((range.max - start) / range.step);
  return Math.min(Math.max(steps, low), high);
}

/** Decimal places that show a step exactly, at most 6. */
const places = (step: number) => {
  for (let n = 0; n < 6; n++)
    if (Math.abs(Math.round(step * 10 ** n) - step * 10 ** n) < 1e-9) return n;
  return 6;
};

/**
 * The value after `steps` steps from `start`, on the grid through the minimum (or zero),
 * clamped to the range and rounded to the step's decimals.
 */
export function scrubValue(start: number, steps: number, range: ScrubRange): number {
  const { step } = range,
    min = range.min ?? -Infinity,
    max = range.max ?? Infinity,
    origin = range.min ?? 0,
    raw = start + Math.trunc(steps) * step,
    snapped = origin + Math.round((raw - origin) / step) * step,
    clamped = Math.min(Math.max(snapped, min), max);
  return Number(clamped.toFixed(places(step)));
}

/**
 * A parameter's scrub range: its declared range, or an open one stepping by 1 or 0.1. A declared
 * step of zero, as `[0:0:10]` gives, steps by 1 instead; dividing by it would write NaN. A
 * negative step counts by its size.
 */
export function parameterRange(parameter: ScadParameter): ScrubRange {
  if (parameter.range) {
    const step = Math.abs(parameter.range.step ?? 1);
    return { min: parameter.range.min, max: parameter.range.max, step: step > 0 ? step : 1 };
  }
  const sample = vectorParameterValue(parameter.defaultValue) ?? [Number(parameter.defaultValue)];
  return { min: null, max: null, step: sample.every(Number.isInteger) ? 1 : 0.1 };
}
