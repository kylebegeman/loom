import { expect, it } from "vite-plus/test";
import { weld, rotatePoint } from "./mesh.ts";
import { topologyOf } from "./topology.ts";
import { cubeSoup, joinSoup } from "./fixtures.ts";
it("welds a cube, drops degenerate faces and rotates about X", () => {
  const mesh = weld(joinSoup(cubeSoup(), new Float32Array(9)));
  expect(mesh.vertices.length / 3).toBe(8);
  expect(mesh.triangles.length / 3).toBe(12);
  expect(mesh.degenerate).toBe(1);
  expect(rotatePoint([0, 1, 0], [Math.SQRT1_2, 0, 0, Math.SQRT1_2])).toEqual([
    0, -2.220446049250313e-16, 1.0000000000000002,
  ]);
});
it("classifies watertight cubes, holes, reversed faces and separate bodies", () => {
  const cube = cubeSoup(),
    closed = topologyOf(weld(cube));
  expect(closed).toMatchObject({ watertight: true, open: 0, flipped: 0, nonManifold: 0 });
  expect(closed.shells).toHaveLength(1);
  expect(closed.volume).toBeCloseTo(1000);
  const hole = topologyOf(weld(cube.slice(18)));
  expect(hole).toMatchObject({ open: 4, watertight: false, volume: null });
  const reversed = cube.slice();
  reversed.set(cube.slice(6, 9), 3);
  reversed.set(cube.slice(3, 6), 6);
  expect(topologyOf(weld(reversed)).flipped).toBe(3);
  expect(topologyOf(weld(joinSoup(cube, cubeSoup([10, 10, 10], [20, 0, 0])))).shells).toHaveLength(
    2,
  );
});
