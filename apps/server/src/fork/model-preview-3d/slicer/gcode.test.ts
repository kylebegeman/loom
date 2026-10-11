import { expect, it } from "vite-plus/test";
import { createGcodeParser, parseDuration } from "./gcode.ts";
it("parses Bambu and Prusa totals with long durations", () => {
  expect(parseDuration("1d 2h 3m 4s")).toBe(93784);
  const parser = createGcodeParser();
  [
    "; model printing time: 1h; total estimated time: 1d 2h 3m 4s",
    "; total layer number: 2",
    "; total filament length [mm] : 100,200",
    "; total filament weight [g] : 2,3",
  ].forEach(parser.feed);
  expect(parser.finish().estimate).toMatchObject({
    printSeconds: 93784,
    layerCount: 2,
    totalGrams: 5,
    filaments: [
      { slot: 0, lengthMm: 100, grams: 2 },
      { slot: 1, lengthMm: 200, grams: 3 },
    ],
  });
  const prusa = createGcodeParser();
  [
    "; filament used [mm] = 1000",
    "; filament used [g] = 12.3",
    "; estimated printing time (normal mode) = 2h 4m",
    "; filament cost = 0.24",
  ].forEach(prusa.feed);
  expect(prusa.finish().estimate).toMatchObject({
    printSeconds: 7440,
    totalGrams: 12.3,
    cost: 0.24,
  });
});
it("tracks absolute and relative extrusion, resets, tools, roles and layers without travel lines", () => {
  const parser = createGcodeParser();
  [
    "G90",
    "M82",
    "; CHANGE_LAYER",
    "G1 Z0.2",
    "; FEATURE: Support",
    "G1 X10 E1",
    "G1 X20 E2",
    "G92 E0",
    "G1 X30 E1",
    "T1",
    "M83",
    ";LAYER_CHANGE",
    ";Z:0.4",
    ";TYPE:Support material interface",
    "G1 X40 E2",
    "G1 X50",
    ";TYPE:Unknown",
    "G1 X60 E1",
  ].forEach(parser.feed);
  const result = parser.finish();
  expect(result.supportLength).toEqual([3, 2]);
  expect(result.layers.layerCount).toBe(2);
  expect(result.layers.segmentCount).toBe(5);
});
it("converts arcs to chords no longer than two millimetres", () => {
  const parser = createGcodeParser();
  ["M83", "G1 X10", "; CHANGE_LAYER", "G2 X-10 Y0 I-10 J0 E2"].forEach(parser.feed);
  const result = parser.finish(),
    data = new DataView(result.layers.data.buffer),
    start = 24 + result.layers.layerCount * 12,
    step = data.getFloat32(20, true);
  expect(result.layers.segmentCount).toBe(16);
  for (let segment = 0; segment < result.layers.segmentCount; segment++) {
    const x0 = data.getUint16(start + segment * 8, true),
      y0 = data.getUint16(start + segment * 8 + 2, true),
      x1 = data.getUint16(start + segment * 8 + 4, true),
      y1 = data.getUint16(start + segment * 8 + 6, true);
    expect(Math.hypot(x1 - x0, y1 - y0) * step).toBeLessThan(2.02);
  }
});

it("discards startup purge paths before the first explicit print layer", () => {
  const parser = createGcodeParser();
  [
    "M83",
    "G1 X10 E2",
    "; CHANGE_LAYER",
    "G1 Z0.2",
    "; FEATURE: Outer wall",
    "G1 X20 E1",
    "; CHANGE_LAYER",
    "G1 Z0.4",
    "G1 X30 E1",
  ].forEach(parser.feed);
  const result = parser.finish();
  expect(result.layers.layerCount).toBe(2);
  expect(result.layers.segmentCount).toBe(2);
});
