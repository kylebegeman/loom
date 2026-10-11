import { expect, it } from "vite-plus/test";
import { buildGrid, raycast } from "./grid.ts";
import { weld } from "./mesh.ts";
import { cubeSoup } from "./fixtures.ts";
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
