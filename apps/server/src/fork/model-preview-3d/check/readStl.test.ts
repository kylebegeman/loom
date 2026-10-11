import { expect, it } from "vite-plus/test";
import { readStl } from "./readStl.ts";
const limits = { maxTriangles: 10 };
const ascii = (source: string) => [{ name: "part.stl", bytes: new TextEncoder().encode(source) }];
it("reads a binary STL whose header begins with solid and respects transferred byte offsets", () => {
  const bytes = new Uint8Array(134);
  bytes.set(new TextEncoder().encode("solid misleading"));
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  expected.forEach((number, index) => view.setFloat32(96 + index * 4, number, true));
  const containing = new Uint8Array(140);
  containing.set(bytes, 3);
  expect([...readStl([{ name: "part.stl", bytes: containing.subarray(3, 137) }], limits)]).toEqual(
    expected,
  );
  expect(() => readStl([{ name: "part.stl", bytes }], { maxTriangles: 0 })).toThrow(
    "Too many triangles",
  );
});
it("reads ASCII facet vertices and reports malformed facets with the offending line", () => {
  const source =
    "solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid";
  expect([...readStl(ascii(source), limits)]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(() => readStl(ascii(source.replace("vertex 0 1 0\n", "")), limits)).toThrow("line 7");
  expect(() => readStl(ascii(source.replace("vertex 0 1 0", "vertex NaN 1 0")), limits)).toThrow(
    "line 6",
  );
  expect(() => readStl(ascii("not an stl"), limits)).toThrow("damaged");
  expect(() => readStl(ascii(source), { maxTriangles: 0 })).toThrow("Too many triangles");
});
