import { BoxGeometry, CylinderGeometry } from "three";
import { expect, it } from "vite-plus/test";
import {
  buildTopology,
  circleAt,
  faceCenter,
  fitCircle,
  SNAP_PRIORITY,
  snapNear,
  snapNearPoint,
  snapToRimCenter,
  topologyPoint,
  type Point,
} from "./snap";
import { weld } from "./weld";
const input = (geometry: BoxGeometry | CylinderGeometry) =>
  new Float32Array(geometry.toNonIndexed().getAttribute("position").array);
const polygon = (count: number, radius = 1.7, z = 0): Point[] =>
  Array.from({ length: count }, (_, i) => [
    radius * Math.cos((i * Math.PI * 2) / count),
    radius * Math.sin((i * Math.PI * 2) / count),
    z,
  ]);
function ring(count: number) {
  const inner = polygon(count),
    outer = polygon(count, 8),
    bottom = polygon(count, 1.7, -4),
    positions: number[] = [];
  const tri = (...points: Point[]) => positions.push(...points.flat());
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    tri(inner[i]!, outer[i]!, inner[next]!);
    tri(inner[next]!, outer[i]!, outer[next]!);
  }
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    tri(inner[i]!, inner[next]!, bottom[i]!);
    tri(bottom[i]!, inner[next]!, bottom[next]!);
  }
  return buildTopology(new Float32Array(positions), null);
}
it("welds a non-indexed cube and separates face diagonals from sharp edges", () => {
  const geometry = new BoxGeometry(20, 20, 20).toNonIndexed(),
    welded = weld(geometry);
  expect(welded.positions.length / 3).toBe(8);
  expect(weld(geometry)).toBe(welded);
  const topology = buildTopology(new Float32Array(geometry.getAttribute("position").array), null);
  expect(topology.region.length).toBe(12);
  expect([...topology.across].every((t) => t >= 0)).toBe(true);
  expect([...topology.sharp].filter(Boolean)).toHaveLength(24);
  expect(new Set(topology.region).size).toBe(6);
});
it("joins cylinder wall facets while preserving both sharp rims", () => {
  const topology = buildTopology(input(new CylinderGeometry(2, 2, 10, 32)), null);
  expect(new Set(topology.region.slice(0, 64)).size).toBe(1);
  expect(new Set(topology.region).size).toBe(3);
});
it("marks non-manifold edges sharp and unpaired", () => {
  const topology = buildTopology(
    new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]),
    null,
  );
  for (const e of [0, 3, 6]) {
    expect(topology.sharp[e]).toBe(1);
    expect(topology.across[e]).toBe(-1);
  }
});
it.each([6, 64, 200])("fits an exact %i-sided circle in its own plane", (count) => {
  const loop = polygon(count).map(([x, y, z]): Point => [10 + z, 20 + x, 30 + y]);
  const fit = fitCircle(loop)!;
  expect(fit.diameter).toBeCloseTo(3.4, 6);
  fit.center.forEach((value, axis) => expect(value).toBeCloseTo([10, 20, 30][axis]!, 6));
  expect(fit.sides).toBe(count <= 128 ? count : null);
  expect(Math.abs(fit.normal[0])).toBeCloseTo(1);
  if (count === 6) expect(fit.diameter * Math.cos(Math.PI / fit.sides!)).toBeCloseTo(2.944486, 5);
});
it("rejects rectangles with extra edge vertices, too few vertices and non-planar rims", () => {
  expect(
    fitCircle([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [2, 1, 0],
      [2, 2, 0],
      [0, 2, 0],
      [0, 1, 0],
    ]),
  ).toBeNull();
  expect(fitCircle(polygon(4))).toBeNull();
  expect(fitCircle(polygon(12).map((p, i): Point => [p[0], p[1], i % 2]))).toBeNull();
});
it("finds a six-sided hole from its rim and the nearest smooth-wall rim", () => {
  const hex = ring(6),
    a = hex.corners[0]!,
    b = hex.corners[2]!;
  const fit = circleAt(hex, 0, topologyPoint(hex, a), [a, b])!;
  expect(fit.diameter).toBeCloseTo(3.4, 6);
  expect(fit.sides).toBe(6);
  const smooth = ring(32),
    wallTriangle = 64;
  expect(circleAt(smooth, wallTriangle, [1.7, 0, -0.2], null)!.center[2]).toBe(0);
  expect(circleAt(smooth, wallTriangle, [1.7, 0, -3.8], null)!.center[2]).toBe(-4);
});
it("uses screen-space priority, section filtering and a depth occlusion guard", () => {
  const topology = buildTopology(input(new BoxGeometry(20, 20, 20)), null);
  const hit: Point = [10, 9.6, 9.6],
    ray = { origin: [50, 9.6, 9.6] as Point, direction: [-1, 0, 0] as Point },
    screen = (p: Point): [number, number] => [p[1] * 10, p[2] * 10];
  const snap = snapNear(topology, 0, hit, ray, screen, 10, () => true);
  expect(snap.kind).toBe("vertex");
  expect(snap.point).toEqual([10, 10, 10]);
  expect(snapNear(topology, 0, hit, ray, screen, 10, () => false).kind).toBe("face");
  expect(snapNear(topology, 0, [10, 5, 5], ray, screen, 1, () => true).kind).toBe("face");
  expect(snapNear(topology, 0, [10, 0.05, 0], ray, screen, 1, () => true)).toMatchObject({
    kind: "faceCenter",
    point: [expect.closeTo(10, 9), expect.closeTo(0, 9), expect.closeTo(0, 9)],
  });
  const behind = buildTopology(
    new Float32Array([10, 9, 9, 10, 11, 9, 10, 9, 11, -10, 9.6, 9.6, -10, 9.6, 11, -10, 11, 9.6]),
    null,
  );
  expect(snapNear(behind, 1, hit, ray, screen, 10, () => true).kind).toBe("face");
});
it("snaps agent points without a camera and leaves distant points unchanged", () => {
  const topology = buildTopology(input(new BoxGeometry(20, 20, 20)), null);
  expect(snapNearPoint(topology, [9.7, 10.2, 10.1], 1)).toMatchObject({
    kind: "vertex",
    point: [10, 10, 10],
  });
  expect(snapNearPoint(topology, [10.2, 0, 10.1], 1)).toMatchObject({
    kind: "edge",
    point: [10, 0, 10],
  });
  expect(snapNearPoint(topology, [100, 100, 100], 1).kind).toBe("face");
});
it("ranks feature snaps corner, hole center, midpoint, face center, edge", () => {
  expect(SNAP_PRIORITY).toEqual(["vertex", "center", "midpoint", "faceCenter", "edge"]);
  // Looking down on a 20 mm cube at 2 px/mm: the top face center is 2 px away and the edge
  // midpoints 18 px, so the face center wins.
  const cube = buildTopology(input(new BoxGeometry(20, 20, 20)), null),
    down = { origin: [1, 1, 50] as Point, direction: [0, 0, -1] as Point },
    top = (p: Point): [number, number] => [p[0] * 2, -p[1] * 2],
    face = [...cube.region].findIndex(
      (region) => Math.abs((faceCenter(cube, region)?.[2] ?? 0) - 10) < 1e-6,
    );
  expect(snapNear(cube, face, [1, 1, 10], down, top, 14, () => true)).toMatchObject({
    kind: "faceCenter",
    point: [expect.closeTo(0, 9), expect.closeTo(0, 9), expect.closeTo(10, 9)],
  });
  // At 1 px/mm the edge midpoints come within reach and outrank it.
  expect(
    snapNear(
      cube,
      face,
      [1, 1, 10],
      down,
      (p) => [p[0], -p[1]],
      12,
      () => true,
    ).kind,
  ).toBe("midpoint");
});
it("gives flat faces a center and curved walls none", () => {
  const cube = buildTopology(input(new BoxGeometry(20, 10, 4)), null),
    centers = [...new Set(cube.region)].map((r) => faceCenter(cube, r));
  expect(centers).toHaveLength(6);
  expect(centers).toContainEqual([
    expect.closeTo(0, 9),
    expect.closeTo(0, 9),
    expect.closeTo(2, 9),
  ]);
  expect(centers).toContainEqual([
    expect.closeTo(-10, 9),
    expect.closeTo(0, 9),
    expect.closeTo(0, 9),
  ]);
  const tube = ring(32);
  // The annulus top is flat; the hole wall is curved.
  expect(faceCenter(tube, tube.region[0]!)![2]).toBeCloseTo(0, 9);
  expect(faceCenter(tube, tube.region[64]!)).toBeNull();
});
it("snaps to a hole center near it and wakes rims for through holes", () => {
  const plate = ring(32),
    down = (x: number, y: number) => ({
      origin: [x, y, 50] as Point,
      direction: [0, 0, -1] as Point,
    });
  // At 3 px/mm the whole 3.4 mm hole is in reach of a pick on the plate, but its rim vertices
  // are nearer still and outrank the center.
  const small = (p: Point): [number, number] => [p[0] * 3, -p[1] * 3];
  expect(snapNear(plate, 0, [2.2, 0.3, 0], down(2.2, 0.3), small, 14, () => true).kind).toBe(
    "vertex",
  );
  // At 10 px/mm a pick just outside the rim reaches only the rim, and wakes it.
  const near = (p: Point): [number, number] => [p[0] * 10, -p[1] * 10],
    passed = snapNear(plate, 0, [2.1, 0.3, 0], down(2.1, 0.3), near, 6, () => true);
  expect(passed.kind).not.toBe("center");
  // The rim at the top and the one at the bottom of the hole, each once.
  expect(passed.rims?.map((fit) => fit.center[2]).sort()).toEqual([
    expect.closeTo(-4, 6),
    expect.closeTo(0, 6),
  ]);
  // Over the empty middle of the hole, the nearer woken rim's center is picked.
  const centered = snapToRimCenter(
    passed.rims!,
    down(0.2, 0.1),
    near,
    near([0.2, 0.1, 0]),
    6,
    () => true,
  );
  expect(centered).toMatchObject({ kind: "center" });
  centered!.point.forEach((value) => expect(value).toBeCloseTo(0, 6));
  expect(centered!.circle!.diameter).toBeCloseTo(3.4, 6);
  expect(
    snapToRimCenter(passed.rims!, down(1, 1), near, near([1, 1, 0]), 6, () => true),
  ).toBeNull();
  expect(
    snapToRimCenter(passed.rims!, down(0.2, 0.1), near, near([0.2, 0.1, 0]), 6, () => false),
  ).toBeNull();
});
