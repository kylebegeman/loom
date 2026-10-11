import type { PcbChangeRegion } from "@t3tools/contracts/fork";
import type { DrawingSnapshot } from "./changeMemory";
type Pixels = { width: number; height: number; data: Uint8ClampedArray };
export function diffRegions(
  a: Pixels,
  b: Pixels,
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
  const regions: PcbChangeRegion[] = [];
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
export async function drawingRegions(before: DrawingSnapshot, after: DrawingSnapshot) {
  if (
    before.view !== after.view ||
    before.sheetId !== after.sheetId ||
    before.layersKey !== after.layersKey
  )
    return null;
  const x = Math.min(before.frame.x, after.frame.x),
    y = Math.min(before.frame.y, after.frame.y);
  const width =
    Math.max(before.frame.x + before.frame.width, after.frame.x + after.frame.width) - x;
  const height =
    Math.max(before.frame.y + before.frame.height, after.frame.y + after.frame.height) - y;
  const scale = Math.min(8, 1024 / Math.max(width, height));
  const raster = async (snapshot: DrawingSnapshot) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    for (const { svg, opacity } of snapshot.images) {
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        ctx.globalAlpha = opacity;
        ctx.drawImage(
          img,
          (snapshot.frame.x - x) * scale,
          (snapshot.frame.y - y) * scale,
          snapshot.frame.width * scale,
          snapshot.frame.height * scale,
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };
  try {
    const [a, b] = await Promise.all([raster(before), raster(after)]),
      result = diffRegions(a, b);
    return {
      ...result,
      regions: result.regions.map((r) => ({
        x: x + r.x / scale - 0.5,
        y: y + r.y / scale - 0.5,
        width: r.width / scale + 1,
        height: r.height / scale + 1,
      })),
    };
  } catch {
    return null;
  }
}
