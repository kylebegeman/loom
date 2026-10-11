import { expect, it } from "vite-plus/test";
import { decodeLayers, layerDrawRange } from "./layers";
const encoded = () => {
  const bytes = new ArrayBuffer(24 + 24 + 18),
    view = new DataView(bytes);
  new Uint8Array(bytes, 0, 4).set(new TextEncoder().encode("LLY1"));
  view.setUint32(4, 2, true);
  view.setUint32(8, 2, true);
  view.setFloat32(12, -5, true);
  view.setFloat32(16, -10, true);
  view.setFloat32(20, 0.01, true);
  for (let i = 0; i < 2; i++) {
    view.setFloat32(24 + i * 12, 0.2 * (i + 1), true);
    view.setFloat32(28 + i * 12, 0.2, true);
    view.setUint32(32 + i * 12, i, true);
    view.setUint16(48 + i * 8, 100, true);
    view.setUint16(50 + i * 8, 200, true);
    view.setUint16(52 + i * 8, 300, true);
    view.setUint16(54 + i * 8, 400, true);
  }
  new Uint8Array(bytes, 64, 2).set([0, 7]);
  return bytes;
};
it("decodes quantized positions and only draws through the selected layer", () => {
  const data = decodeLayers(encoded());
  expect(data.segmentCount).toBe(2);
  expect([...data.roles]).toEqual([0, 7]);
  expect(data.positions[0]).toBeCloseTo(-4);
  expect(data.positions[1]).toBeCloseTo(-8);
  expect(data.positions[2]).toBeCloseTo(0.2);
  expect(data.positions[8]).toBeCloseTo(0.4);
  expect(layerDrawRange(data, 0)).toBe(2);
  expect(layerDrawRange(data, 99)).toBe(4);
});
it("rejects damaged lengths, missing first segments and invalid roles", () => {
  const bytes = encoded();
  new DataView(bytes).setUint32(32, 1, true);
  expect(() => decodeLayers(bytes)).toThrow("damaged");
  const roles = encoded();
  new Uint8Array(roles)[64] = 255;
  expect(() => decodeLayers(roles)).toThrow("roles");
  expect(() => decodeLayers(encoded().slice(0, 40))).toThrow("bounds");
});
