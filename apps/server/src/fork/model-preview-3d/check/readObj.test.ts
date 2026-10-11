import { expect, it } from "vite-plus/test";
import { readObj } from "./readObj.ts";
const files = (source: string) => [{ name: "part.obj", bytes: new TextEncoder().encode(source) }];
const points = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n";
it("triangulates polygon fans and supports every face reference shape and negative indices", () => {
  const expected = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
  expect([...readObj(files(points + "f 1/1 2//2 3/3/3 4"), { maxTriangles: 2 })]).toEqual(expected);
  expect([...readObj(files(points + "f -4 -3 -2 -1\nv 99 99 99"), { maxTriangles: 2 })]).toEqual(
    expected,
  );
  expect(() => readObj(files(points + "f 1 2 3 4"), { maxTriangles: 1 })).toThrow(
    "Too many triangles",
  );
});
it("ignores non-face records and rejects bad references and coordinates with line numbers", () => {
  expect(
    readObj(files(points + "l 1 2\np 1\ng part\nusemtl red"), { maxTriangles: 10 }),
  ).toHaveLength(0);
  for (const face of ["f 0 2 3", "f 1 2 5", "f -5 2 3", "f 1 2 2.5", "f 1 2"])
    expect(() => readObj(files(points + face), { maxTriangles: 10 })).toThrow("line 5");
  expect(() => readObj(files("v NaN 0 0"), { maxTriangles: 10 })).toThrow("line 1");
});
