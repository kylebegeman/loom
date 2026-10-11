import { expect, it } from "vite-plus/test";
import { rotateStl } from "./prepare.ts";
import { readStl } from "../check/readStl.ts";
it("rotates ASCII STL vertices and rests the binary output at Z zero", () => {
  const bytes = new TextEncoder().encode(
    "solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 5\nvertex 10 0 5\nvertex 0 20 5\nendloop\nendfacet\nendsolid",
  );
  const output = rotateStl(bytes, [Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  const points = [...readStl([{ name: "rotated.stl", bytes: output }], { maxTriangles: 10 })];
  expect(points).toEqual([0, -5, 0, 10, -5, 0, 0, -5, 20]);
});
