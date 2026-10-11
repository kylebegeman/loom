import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { DEFAULT_MODEL_PREVIEW_SETTINGS, ModelPreviewSettings } from "./model-preview-3d.ts";
import { ModelCamera } from "./model-workspace.ts";
import { BED_BAND_MM, OverhangStats, overhangStats } from "./model-overhangs.ts";

const decodeStats = Schema.decodeUnknownSync(OverhangStats);
const decodeSettings = Schema.decodeUnknownSync(ModelPreviewSettings);
const decodeCamera = Schema.decodeUnknownSync(ModelCamera);

type Point = readonly [number, number, number];
const triangle = (a: Point, b: Point, c: Point) => [...a, ...b, ...c];
function box(min: Point, max: Point) {
  const [x, y, z] = min;
  const [X, Y, Z] = max;
  const points: Point[] = [
    [x, y, z],
    [X, y, z],
    [X, Y, z],
    [x, Y, z],
    [x, y, Z],
    [X, y, Z],
    [X, Y, Z],
    [x, Y, Z],
  ];
  return [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [3, 7, 6],
    [3, 6, 2],
    [0, 4, 7],
    [0, 7, 3],
    [1, 2, 6],
    [1, 6, 5],
  ].flatMap(([a, b, c]) => triangle(points[a!]!, points[b!]!, points[c!]!));
}
const stats = (positions: number[], thresholdDegrees = 45, up?: Point) =>
  overhangStats(new Float32Array(positions), { thresholdDegrees, ...(up ? { up } : {}) });

it("excludes a cube's base on the bed and counts all surface area", () => {
  const result = stats(box([0, 0, 0], [10, 10, 10]));
  expect(result).toMatchObject({
    totalAreaMm2: 600,
    overhangAreaMm2: 0,
    overhangPercent: 0,
    facets: 12,
    oriented: false,
    regions: [],
  });
  expect(decodeStats(result)).toEqual(result);
});
it("finds a lifted cube's underside while excluding the stem's bed face", () => {
  const result = stats([...box([0, 0, 1], [10, 10, 11]), ...box([4, 4, 0], [6, 6, 1])]);
  expect(result.totalAreaMm2).toBe(616);
  expect(result.overhangAreaMm2).toBe(100);
  expect(result.overhangPercent).toBeCloseTo((100 / 616) * 100);
  expect(result.regions).toEqual([{ areaMm2: 100, centre: [5, 5, 1], heightMm: [1, 1] }]);
});
it("uses degrees from vertical and never labels vertical walls", () => {
  const floor = triangle([0, 0, 0], [0, 0, 0], [0, 0, 0]);
  const chamfer = triangle([0, 0, 2], [0, 2, 2], [2, 0, 4]);
  const wall = triangle([0, 0, 2], [0, 2, 2], [0, 0, 4]);
  expect(stats([...floor, ...chamfer, ...wall], 40).overhangAreaMm2).toBeCloseTo(Math.sqrt(8));
  expect(stats([...floor, ...chamfer, ...wall], 50).overhangAreaMm2).toBe(0);
  expect(stats([...floor, ...chamfer, ...wall], 45).overhangAreaMm2).toBe(0);
});
it("uses oriented up for the normals and bed, keeping centres in model coordinates", () => {
  const result = stats(
    [...box([1, 0, 0], [11, 10, 10]), ...box([0, 4, 4], [1, 6, 6])],
    45,
    [1, 0, 0],
  );
  expect(result).toMatchObject({ oriented: true, overhangAreaMm2: 100 });
  expect(result.regions).toEqual([{ areaMm2: 100, centre: [1, 5, 5], heightMm: [1, 1] }]);
});
it("joins shared vertices at one micron precision and splits detached ledges", () => {
  const result = stats([
    ...triangle([0, 0, 0], [0, 0, 0], [0, 0, 0]),
    ...triangle([0, 0, 2], [0, 2, 2], [2, 0, 2]),
    ...triangle([2 + 0.0000001, 0, 2], [0, 2, 2], [2, 2, 2]),
    ...triangle([10, 0, 2], [10, 1, 2], [11, 0, 2]),
  ]);
  expect(result.regions).toHaveLength(2);
  expect(result.regions[0]).toMatchObject({ areaMm2: 4, centre: [1, 1, 2] });
  expect(result.regions[1]).toMatchObject({ areaMm2: 0.5 });
});
it("returns only the ten largest regions in stable area order", () => {
  const ledges = Array.from({ length: 12 }, (_, i) =>
    triangle([i * 20, 0, 2], [i * 20, i + 1, 2], [i * 20 + 1, 0, 2]),
  );
  const result = stats([...triangle([0, 0, 0], [0, 0, 0], [0, 0, 0]), ...ledges.flat()]);
  expect(result.regions.map((region) => region.areaMm2)).toEqual([
    6, 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5,
  ]);
  expect(result.overhangAreaMm2).toBe(39);
});
it("clips overhang area at the bed band instead of discarding a crossing face", () => {
  const result = stats(triangle([0, 0, 0], [0, 1, 0], [1, 0, 1]));
  // This face is at 45 degrees; 80% of each edge above the band remains, so 64% of its area.
  const lowerThreshold = stats(triangle([0, 0, 0], [0, 1, 0], [1, 0, 1]), 40);
  expect(result.overhangAreaMm2).toBe(0);
  expect(lowerThreshold.overhangAreaMm2).toBeCloseTo((Math.sqrt(2) / 2) * (1 - BED_BAND_MM) ** 2);
  expect(lowerThreshold.regions[0]?.heightMm[0]).toBeCloseTo(BED_BAND_MM);
});
it("handles empty and degenerate meshes, and rejects invalid inputs", () => {
  expect(stats([]).overhangPercent).toBe(0);
  expect(stats(triangle([0, 0, 0], [0, 0, 0], [0, 0, 0])).totalAreaMm2).toBe(0);
  for (const degrees of [29, 71, 45.5, NaN]) expect(() => stats([], degrees)).toThrow(RangeError);
  expect(() => stats([1, 2, 3])).toThrow(RangeError);
  expect(() => stats(triangle([NaN, 0, 0], [1, 0, 0], [0, 1, 0]))).toThrow(RangeError);
  expect(() => stats([], 45, [0, 0, 0])).toThrow(RangeError);
});

it("defaults legacy settings and cameras while validating saved angles", () => {
  const { overhangAngleDegrees: _oldAngle, ...legacy } = DEFAULT_MODEL_PREVIEW_SETTINGS;
  expect(decodeSettings(legacy).overhangAngleDegrees).toBe(45);
  expect(() => decodeSettings({ ...legacy, overhangAngleDegrees: 29 })).toThrow();
  expect(() => decodeSettings({ ...legacy, overhangAngleDegrees: 71 })).toThrow();
  expect(
    decodeCamera({
      position: [1, 2, 3],
      target: [0, 0, 0],
      near: 0.1,
      far: 100,
      wireframe: false,
      gridVisible: true,
      axesVisible: false,
      navigationMode: "orbit",
      section: { enabled: false, axis: "z", offset: 0, flipped: false },
    }).overhangs,
  ).toBe(false);
});
