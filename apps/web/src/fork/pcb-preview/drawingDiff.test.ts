import { it, expect } from "vite-plus/test";
import { diffRegions } from "./drawingDiff";
const image = (width = 32, height = 32) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
});
it("ignores identical pixels and isolated antialias noise, merges a trace", () => {
  const a = image(),
    b = image();
  expect(diffRegions(a, b).regions).toEqual([]);
  b.data[0] = 255;
  expect(diffRegions(a, b).regions).toEqual([]);
  for (let x = 4; x < 24; x++) b.data[(16 * 32 + x) * 4] = 255;
  expect(diffRegions(a, b).regions).toHaveLength(1);
  expect(diffRegions(a, b).regions[0]).toMatchObject({ x: 0, y: 12, width: 28, height: 12 });
});
it("checks dimensions and caps separate regions", () => {
  expect(() => diffRegions(image(), image(16, 16))).toThrow();
  const a = image(80, 80),
    b = image(80, 80);
  for (const [x, y] of [
    [4, 4],
    [60, 60],
  ])
    for (let dx = 0; dx < 3; dx++) b.data[(y! * 80 + x! + dx) * 4] = 255;
  const result = diffRegions(a, b, { maxRegions: 1 });
  expect(result.regions).toHaveLength(1);
  expect(result.truncated).toBe(true);
});
