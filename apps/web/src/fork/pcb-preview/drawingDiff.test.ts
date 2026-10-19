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

it.each([0, 1, 2, 3])("uses a strict threshold for channel %s, including alpha", (channel) => {
  const a = image(),
    b = image();
  for (let x = 0; x < 3; x++) b.data[x * 4 + channel] = 48;
  expect(diffRegions(a, b).regions).toEqual([]);
  for (let x = 0; x < 3; x++) b.data[x * 4 + channel] = 49;
  expect(diffRegions(a, b)).toEqual({
    regions: [{ x: 0, y: 0, width: 8, height: 8 }],
    truncated: false,
  });
});

it("clips dilated regions to partial cells at image edges", () => {
  const a = image(17, 10),
    b = image(17, 10);
  b.data[(8 * 17 + 16) * 4 + 3] = 255;
  b.data[(9 * 17 + 16) * 4 + 3] = 255;
  expect(diffRegions(a, b, { minPixels: 2 })).toEqual({
    regions: [{ x: 12, y: 4, width: 5, height: 6 }],
    truncated: false,
  });
});

it("keeps the first discovered region when equal areas exceed the output limit", () => {
  const a = image(80, 80),
    b = image(80, 80);
  b.data[60 * 4] = 255;
  b.data[4 * 80 * 4] = 255;
  expect(diffRegions(a, b, { minPixels: 1, maxRegions: 1 })).toEqual({
    regions: [{ x: 56, y: 0, width: 12, height: 8 }],
    truncated: true,
  });
});

it("merges nested change bounds even when their changed pixels are disconnected", () => {
  const a = image(64, 64),
    b = image(64, 64);
  const mark = (x: number, y: number) => {
    b.data[(y * 4 * 64 + x * 4) * 4] = 255;
  };
  for (let i = 1; i <= 13; i++) {
    mark(i, 1);
    mark(i, 13);
    mark(1, i);
    mark(13, i);
  }
  mark(7, 7);
  expect(diffRegions(a, b, { minPixels: 1 })).toEqual({
    regions: [{ x: 0, y: 0, width: 60, height: 60 }],
    truncated: false,
  });
});

it("matches the Set reference across varied rasters, cell sizes and output limits", () => {
  let state = 0x706362;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  const densities = [0, 1, 3, 8, 20, 80];
  const cells = [1, 2, 4, 6, 3, 1.5];
  for (let sample = 0; sample < 120; sample++) {
    const width = 17 + (random() % 64),
      height = 13 + (random() % 56),
      a = image(width, height),
      b = image(width, height);
    for (let pixel = 0; pixel < width * height; pixel++)
      if (random() % 100 < densities[sample % densities.length]!)
        b.data[pixel * 4 + (random() % 4)] = random() % 256;
    const options = {
      threshold: random() % 128,
      cell: cells[sample % cells.length]!,
      minPixels: 1 + (random() % 4),
      maxRegions: 1 + (random() % 20),
    };
    expect(diffRegions(a, b, options), `sample ${sample}`).toEqual(
      setReferenceRegions(a, b, options),
    );
  }
});

// Retain the pre-optimization algorithm to check region ordering as well as bounds.
function setReferenceRegions(
  a: ReturnType<typeof image>,
  b: ReturnType<typeof image>,
  options: { threshold?: number; cell?: number; minPixels?: number; maxRegions?: number } = {},
) {
  if (
    a.width !== b.width ||
    a.height !== b.height ||
    a.data.length !== b.data.length ||
    a.data.length !== a.width * a.height * 4
  )
    throw new Error("Drawing buffers must have the same dimensions.");
  const { threshold = 48, cell = 4, minPixels = 3, maxRegions = 50 } = options;
  if (cell < 1 || maxRegions < 1 || minPixels < 1) throw new Error("Invalid drawing diff limits.");
  const w = Math.ceil(a.width / cell),
    h = Math.ceil(a.height / cell),
    counts = new Uint32Array(w * h);
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if ([0, 1, 2, 3].some((c) => Math.abs(a.data[i + c]! - b.data[i + c]!) > threshold))
        counts[Math.floor(y / cell) * w + Math.floor(x / cell)]!++;
    }
  const marked = new Set<number>();
  for (let i = 0; i < counts.length; i++)
    if (counts[i]! >= minPixels) {
      const x = i % w,
        y = Math.floor(i / w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h)
            marked.add((y + dy) * w + x + dx);
    }
  const regions: ReturnType<typeof diffRegions>["regions"] = [];
  while (marked.size) {
    const first = marked.values().next().value!;
    marked.delete(first);
    const queue = [first];
    let x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!,
        x = i % w,
        y = Math.floor(i / w);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) {
            const n = (y + dy) * w + x + dx;
            if (marked.delete(n)) queue.push(n);
          }
    }
    regions.push({
      x: x0 * cell,
      y: y0 * cell,
      width: Math.min(a.width, (x1 + 1) * cell) - x0 * cell,
      height: Math.min(a.height, (y1 + 1) * cell) - y0 * cell,
    });
  }
  // Connected groups can have overlapping bounding boxes. Merge until stable.
  for (let i = 0; i < regions.length; i++)
    for (let j = i + 1; j < regions.length; j++) {
      const r = regions[i]!,
        s = regions[j]!;
      if (
        r.x <= s.x + s.width &&
        s.x <= r.x + r.width &&
        r.y <= s.y + s.height &&
        s.y <= r.y + r.height
      ) {
        const x = Math.min(r.x, s.x),
          y = Math.min(r.y, s.y);
        regions[i] = {
          x,
          y,
          width: Math.max(r.x + r.width, s.x + s.width) - x,
          height: Math.max(r.y + r.height, s.y + s.height) - y,
        };
        regions.splice(j, 1);
        i = -1;
        break;
      }
    }
  regions.sort((a, b) => b.width * b.height - a.width * a.height);
  return { regions: regions.slice(0, maxRegions), truncated: regions.length > maxRegions };
}
