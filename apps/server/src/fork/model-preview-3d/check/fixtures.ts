import type { TriangleSoup, Vec3 } from "./mesh.ts";
/** Tiny shapes for contract tests and the standalone benchmark; no binary fixtures needed. */
export const cubeSoup = (size: Vec3 = [10, 10, 10], offset: Vec3 = [0, 0, 0]): TriangleSoup => {
  const points = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    faces = [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
    ];
  return Float32Array.from(
    faces.flatMap((face) =>
      face.flatMap((i) => points[i]!.map((value, axis) => value * size[axis]! + offset[axis]!)),
    ),
  );
};
export const joinSoup = (...soups: TriangleSoup[]): TriangleSoup => {
  const combined = new Float32Array(soups.reduce((sum, s) => sum + s.length, 0));
  let offset = 0;
  for (const soup of soups) {
    combined.set(soup, offset);
    offset += soup.length;
  }
  return combined;
};
export const binaryStl = (soup: TriangleSoup) => {
  const bytes = new Uint8Array(84 + (soup.length / 9) * 50),
    view = new DataView(bytes.buffer);
  view.setUint32(80, soup.length / 9, true);
  for (let t = 0; t < soup.length / 9; t++)
    for (let i = 0; i < 9; i++) view.setFloat32(84 + t * 50 + 12 + i * 4, soup[t * 9 + i]!, true);
  return bytes;
};
