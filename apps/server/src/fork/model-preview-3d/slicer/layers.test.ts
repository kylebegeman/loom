import { expect, it } from "vite-plus/test";
import { createLayerBuffer } from "./layers.ts";
it("thins uniformly at a fixed segment cap and retains layer boundaries", () => {
  const buffer = createLayerBuffer(10);
  const first = buffer.layer(0.2, 0.2);
  for (let index = 0; index < 20; index++) buffer.add(first, index, 0, index + 1, 0, "outer-wall");
  const second = buffer.layer(0.4, 0.2);
  for (let index = 20; index < 60; index++) buffer.add(second, index, 0, index + 1, 0, "support");
  const result = buffer.finish(),
    view = new DataView(result.data.buffer);
  expect(result.segmentCount).toBeLessThanOrEqual(10);
  expect(result.decimated).toBe(true);
  expect(new TextDecoder().decode(result.data.subarray(0, 4))).toBe("LLY1");
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(result.segmentCount);
  expect(view.getUint32(44, true)).toBeGreaterThan(0);
});
it("quantizes negative positions and large beds without wrapping u16 coordinates", () => {
  const buffer = createLayerBuffer();
  buffer.add(buffer.layer(1, 0.2), -50, -100, 1950, 1000, "infill");
  const result = buffer.finish(),
    view = new DataView(result.data.buffer);
  const origin = view.getFloat32(12, true),
    step = view.getFloat32(20, true),
    end = view.getUint16(40, true) * step + origin;
  expect(step).toBeGreaterThanOrEqual(Math.fround(0.04));
  expect(end).toBeCloseTo(1950, 2);
});
