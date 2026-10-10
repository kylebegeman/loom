import { expect, it } from "vite-plus/test";
import {
  formatScrub,
  scrubFill,
  scrubValue,
  snapScrub,
  stepDecimals,
  stepScrub,
  typedScrub,
} from "./scrub";

const bounded = { min: 2, max: 12, step: 0.5 };
const unbounded = { min: null, max: null, step: 1 };

it("snaps to the step grid from the minimum and clamps to the range", () => {
  expect(stepDecimals(0.25)).toBe(2);
  expect(stepDecimals(1e-7)).toBe(7);
  expect(snapScrub(4.3, bounded)).toBe(4.5);
  expect(snapScrub(40, bounded)).toBe(12);
  expect(snapScrub(0.1 + 0.2, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
  expect(snapScrub(3, { min: 1, max: 10, step: 3 })).toBe(4);
});

it("drags across the full range over the field width, with a fine mode", () => {
  expect(scrubValue(2, 100, 100, bounded, false)).toBe(12);
  expect(scrubValue(2, 50, 100, bounded, false)).toBe(7);
  expect(scrubValue(2, 50, 100, bounded, true)).toBe(2.5);
  expect(scrubValue(10, -40, 0, unbounded, false)).toBe(-30);
  expect(scrubValue(10, 25, 160, unbounded, false)).toBe(35);
});

it("steps with arrows, keeps typed precision and reports fill only for ranges", () => {
  expect(stepScrub(4, 1, bounded, false)).toBe(4.5);
  expect(stepScrub(4, -1, bounded, true)).toBe(2);
  expect(typedScrub(3.45678, bounded)).toBe(3.457);
  expect(typedScrub(99, bounded)).toBe(12);
  expect(formatScrub(3, 0.5)).toBe("3.0");
  expect(formatScrub(3.25, 0.5)).toBe("3.25");
  expect(scrubFill(7, bounded)).toBe(0.5);
  expect(scrubFill(7, unbounded)).toBeNull();
});
