import { describe, expect, it } from "vite-plus/test";
import type { ScadParameter } from "@t3tools/contracts/fork";
import {
  SCRUB_FACTOR,
  SCRUB_PX_PER_STEP,
  clampSteps,
  parameterRange,
  scrubSteps,
  scrubValue,
} from "./nameScrub";

const plain = { fast: false, fine: false },
  width = { min: 1, max: 300, step: 1 },
  wall = { min: 1, max: 5, step: 0.1 };

describe("Parameter scrubbing", () => {
  it("moves one step per few pixels, faster with Shift and slower with Alt", () => {
    expect(scrubSteps(SCRUB_PX_PER_STEP * 10, plain)).toBe(10);
    expect(scrubSteps(SCRUB_PX_PER_STEP, { fast: true, fine: false })).toBe(SCRUB_FACTOR);
    expect(scrubSteps(SCRUB_PX_PER_STEP * SCRUB_FACTOR, { fast: false, fine: true })).toBeCloseTo(
      1,
    );
    expect(scrubSteps(-SCRUB_PX_PER_STEP * 3, plain)).toBe(-3);
  });

  it("lands on the step grid and only counts whole steps", () => {
    expect(scrubValue(20, 10, width)).toBe(30);
    expect(scrubValue(20, 2.9, width)).toBe(22);
    expect(scrubValue(20, -2.9, width)).toBe(18);
    expect(scrubValue(3, 4, wall)).toBe(3.4);
    // An off-grid start joins the grid through the minimum.
    expect(scrubValue(2.35, 1, wall)).toBe(2.5);
  });

  it("clamps to the range without drifting past it", () => {
    expect(scrubValue(20, 1000, width)).toBe(300);
    expect(scrubValue(20, -1000, width)).toBe(1);
    expect(scrubValue(4.9, 5, wall)).toBe(5);
    const held = clampSteps(1000, 20, width);
    expect(held).toBe(280);
    // Reversing at the limit responds at once.
    expect(scrubValue(20, held - 1, width)).toBe(299);
    expect(clampSteps(-50, 3, wall)).toBeCloseTo(-20);
  });

  it("leaves an open side unclamped, on the grid through zero", () => {
    const open = { min: null, max: null, step: 0.5 };
    expect(clampSteps(1e6, 0, open)).toBe(1e6);
    expect(scrubValue(1.2, 3, open)).toBe(2.5);
    expect(scrubValue(0, -40, { min: null, max: 10, step: 1 })).toBe(-40);
    expect(clampSteps(50, 0, { min: null, max: 10, step: 1 })).toBe(10);
  });

  it("steps a declared zero or negative step by a usable size instead of writing NaN", () => {
    const declared = (step: number | null): ScadParameter => ({
      name: "height",
      group: "",
      description: null,
      kind: "number",
      defaultValue: "4",
      range: { min: 0, max: 10, step },
      options: null,
    });
    // `[0:0:10]` in the customizer comment parses to a step of zero.
    const zero = parameterRange(declared(0));
    expect(zero.step).toBe(1);
    expect(scrubValue(4, clampSteps(2, 4, zero), zero)).toBe(6);
    expect(clampSteps(100, 4, zero)).toBe(6);
    expect(parameterRange(declared(-0.5)).step).toBe(0.5);
    expect(parameterRange(declared(null)).step).toBe(1);
  });

  it("reaches both limits when float division leaves the step count a hair short", () => {
    const tenths = { min: 1, max: 5, step: 0.1 };
    expect(scrubValue(1.2, clampSteps(-1000, 1.2, tenths), tenths)).toBe(1);
    expect(scrubValue(1.2, clampSteps(1000, 1.2, tenths), tenths)).toBe(5);
    const signed = { min: -0.3, max: 0.3, step: 0.1 };
    expect(scrubValue(0, clampSteps(1000, 0, signed), signed)).toBe(0.3);
    expect(scrubValue(0, clampSteps(-1000, 0, signed), signed)).toBe(-0.3);
  });
});
