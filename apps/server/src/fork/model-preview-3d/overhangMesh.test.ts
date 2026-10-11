import { expect, it } from "vite-plus/test";
import { parseBinaryStl } from "./overhangMesh.ts";

function fixture() {
  const bytes = new Uint8Array(84 + 2 * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 2, true);
  for (let triangle = 0; triangle < 2; triangle++) {
    const offset = 84 + triangle * 50;
    view.setFloat32(offset, NaN, true); // Stored normals do not control the geometric normal.
    for (let coordinate = 0; coordinate < 9; coordinate++)
      view.setFloat32(offset + 12 + coordinate * 4, triangle * 10 + coordinate, true);
  }
  return bytes;
}
it("reads vertices, ignores stored normals and respects a buffer view's offset", () => {
  const bytes = fixture();
  const padded = new Uint8Array(bytes.byteLength + 10);
  padded.set(bytes, 5);
  expect([...parseBinaryStl(padded.subarray(5, -5))]).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  ]);
});
it("rejects short headers, mismatched counts, truncated records and trailing bytes", () => {
  expect(() => parseBinaryStl(new Uint8Array(83))).toThrow(RangeError);
  const bytes = fixture();
  expect(() => parseBinaryStl(bytes.subarray(0, -1))).toThrow(RangeError);
  expect(() => parseBinaryStl(new Uint8Array(bytes.byteLength + 1))).toThrow(RangeError);
  new DataView(bytes.buffer).setUint32(80, 3, true);
  expect(() => parseBinaryStl(bytes)).toThrow(RangeError);
});
it("rejects nonfinite vertices and accepts an empty binary STL", () => {
  const bytes = fixture();
  new DataView(bytes.buffer).setFloat32(96, Infinity, true);
  expect(() => parseBinaryStl(bytes)).toThrow(RangeError);
  expect(parseBinaryStl(new Uint8Array(84))).toEqual(new Float32Array());
});
