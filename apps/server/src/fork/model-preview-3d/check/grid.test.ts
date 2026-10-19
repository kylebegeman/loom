import { expect, it } from "vite-plus/test";
import { buildGrid, raycast } from "./grid.ts";
import { weld } from "./mesh.ts";
import { cubeSoup, joinSoup } from "./fixtures.ts";
it("casts each axis through a cube and rejects misses", () => {
  const grid = buildGrid(weld(cubeSoup()));
  for (let axis = 0; axis < 3; axis++) {
    const origin: [number, number, number] = [5, 5, 5],
      direction: [number, number, number] = [0, 0, 0];
    origin[axis] = 0;
    direction[axis] = 1;
    expect(raycast(grid, origin, direction, 20)?.distance).toBeCloseTo(10);
  }
  expect(raycast(grid, [20, 20, 20], [1, 0, 0], 100)).toBeNull();
});
it("mailboxes each triangle once and retries reference overflow", () => {
  const mesh = weld(cubeSoup()),
    normal = buildGrid(mesh),
    coarse = buildGrid(mesh, 20);
  expect(coarse.cellSize).toBeGreaterThan(normal.cellSize);
  const tested: number[] = [];
  raycast(normal, [-1, 5, 5], [1, 0, 0], 30, -1, { tested: (t) => tested.push(t) });
  expect(new Set(tested).size).toBe(tested.length);
  expect(() => buildGrid(mesh, 1)).toThrow("too dense");
});

it.each([
  ["cube", cubeSoup(), undefined],
  ["coarse retry", cubeSoup(), 20],
  [
    "offset boxes",
    joinSoup(cubeSoup([10, 4, 2], [-12, -5, -1]), cubeSoup([2, 3, 8], [3, 2, -4])),
    undefined,
  ],
  ["thin plate", cubeSoup([100, 100, 0.6]), undefined],
  ["empty mesh", new Float32Array(), undefined],
] as const)(
  "indexes exactly the triangles whose bounds overlap each cell for %s",
  (_, soup, limit) => {
    const mesh = weld(soup),
      grid = buildGrid(mesh, limit),
      expected: number[] = [],
      starts = [0];
    const bounds = Array.from({ length: mesh.triangles.length / 3 }, (_, t) =>
      Array.from({ length: 3 }, (_, axis) => {
        const coordinates = Array.from(
          { length: 3 },
          (_, corner) => mesh.vertices[mesh.triangles[t * 3 + corner]! * 3 + axis]!,
        );
        const cell = (value: number) =>
          Math.max(
            0,
            Math.min(
              grid.dimensions[axis]! - 1,
              Math.floor((value - grid.min[axis]!) / grid.cellSize),
            ),
          );
        return [cell(Math.min(...coordinates)), cell(Math.max(...coordinates))] as const;
      }),
    );
    for (let z = 0; z < grid.dimensions[2]; z++)
      for (let y = 0; y < grid.dimensions[1]; y++)
        for (let x = 0; x < grid.dimensions[0]; x++) {
          bounds.forEach((triangle, t) => {
            if (
              [x, y, z].every(
                (coordinate, axis) =>
                  coordinate >= triangle[axis]![0] && coordinate <= triangle[axis]![1],
              )
            )
              expected.push(t);
          });
          starts.push(expected.length);
        }
    expect(grid.start).toEqual(Uint32Array.from(starts));
    expect(grid.triangles).toEqual(Uint32Array.from(expected));
  },
);
