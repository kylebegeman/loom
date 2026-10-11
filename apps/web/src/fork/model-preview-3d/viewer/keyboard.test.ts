import { expect, it } from "vite-plus/test";
import { nudgeFor, ORBIT_STEP, PAN_STEP } from "./keyboard";
it("maps arrows to the standard orbit directions and shifted arrows to viewport-relative pan", () => {
  for (const [key, x, y] of [
    ["ArrowLeft", 1, 0],
    ["ArrowRight", -1, 0],
    ["ArrowUp", 0, 1],
    ["ArrowDown", 0, -1],
  ] as const) {
    expect(nudgeFor(key, false)).toEqual({
      kind: "orbit",
      left: x * ORBIT_STEP,
      up: y * ORBIT_STEP,
    });
    expect(nudgeFor(key, true)).toEqual({ kind: "pan", x: x * PAN_STEP, y: y * PAN_STEP });
  }
  expect(nudgeFor("Left", false)).toBeNull();
  expect(nudgeFor("f", true)).toBeNull();
});
