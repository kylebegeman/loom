import * as NodeAssert from "node:assert/strict";
import {
  buildTopology,
  type Topology,
} from "../../apps/web/src/fork/model-preview-3d/viewer/snap.ts";
import {
  buildGrid,
  raycast,
  type Grid,
} from "../../apps/server/src/fork/model-preview-3d/check/grid.ts";
import { weld, type Vec3 } from "../../apps/server/src/fork/model-preview-3d/check/mesh.ts";
import { cubeSoup } from "../../apps/server/src/fork/model-preview-3d/check/fixtures.ts";
import { defineBenchmark, fingerprint } from "./harness.ts";

function cylinder(spokes: number): Float32Array {
  const positions = new Float32Array(spokes * 4 * 9);
  let offset = 0;
  const point = (i: number, z: number): Vec3 => {
    const angle = ((i % spokes) * Math.PI * 2) / spokes;
    return [20 * Math.cos(angle), 20 * Math.sin(angle), z];
  };
  const triangle = (a: Vec3, b: Vec3, c: Vec3) => {
    positions.set(a, offset);
    positions.set(b, offset + 3);
    positions.set(c, offset + 6);
    offset += 9;
  };
  for (let i = 0; i < spokes; i++) {
    const a = point(i, 0),
      b = point(i + 1, 0),
      c = point(i, 10),
      d = point(i + 1, 10);
    triangle(a, b, c);
    triangle(c, b, d);
    triangle([0, 0, 10], c, d);
    triangle([0, 0, 0], b, a);
  }
  return positions;
}

function plane(divisions: number) {
  const positions = new Float32Array((divisions + 1) ** 2 * 3),
    index = new Uint32Array(divisions ** 2 * 6);
  for (let y = 0; y <= divisions; y++)
    for (let x = 0; x <= divisions; x++) {
      const offset = (y * (divisions + 1) + x) * 3;
      positions[offset] = (x * 100) / divisions;
      positions[offset + 1] = (y * 100) / divisions;
    }
  let offset = 0;
  for (let y = 0; y < divisions; y++)
    for (let x = 0; x < divisions; x++) {
      const a = y * (divisions + 1) + x,
        b = a + 1,
        c = a + divisions + 1,
        d = c + 1;
      index.set([a, b, c, b, d, c], offset);
      offset += 6;
    }
  return { positions, index };
}

function subdividedBox(divisions: number, size: Vec3): Float32Array {
  const source = cubeSoup(size),
    positions = new Float32Array(12 * divisions ** 2 * 9);
  let offset = 0;
  for (let t = 0; t < 12; t++) {
    const a = source.subarray(t * 9, t * 9 + 3),
      b = source.subarray(t * 9 + 3, t * 9 + 6),
      c = source.subarray(t * 9 + 6, t * 9 + 9);
    const point = (i: number, j: number): Vec3 => [
      a[0]! + ((b[0]! - a[0]!) * i + (c[0]! - a[0]!) * j) / divisions,
      a[1]! + ((b[1]! - a[1]!) * i + (c[1]! - a[1]!) * j) / divisions,
      a[2]! + ((b[2]! - a[2]!) * i + (c[2]! - a[2]!) * j) / divisions,
    ];
    const triangle = (u: Vec3, v: Vec3, w: Vec3) => {
      positions.set(u, offset);
      positions.set(v, offset + 3);
      positions.set(w, offset + 6);
      offset += 9;
    };
    for (let i = 0; i < divisions; i++)
      for (let j = 0; j < divisions - i; j++) {
        triangle(point(i, j), point(i + 1, j), point(i, j + 1));
        if (i + j + 1 < divisions) triangle(point(i + 1, j), point(i + 1, j + 1), point(i, j + 1));
      }
  }
  return positions;
}

function fanBenchmark(spokes: number) {
  const positions = cylinder(spokes);
  return defineBenchmark({
    id: `model.snap.fan.${spokes}`,
    description:
      "Build snapping adjacency for a closed CAD cylinder with high-valence cap centers.",
    workload: { triangles: spokes * 4, spokes, indexed: false },
    run: () => buildTopology(positions, null),
    check: (topology) => {
      NodeAssert.equal(topology.corners.length, spokes * 12);
      NodeAssert.equal(topology.positions.length / 3, spokes * 2 + 2);
      NodeAssert.equal(new Set(topology.region).size, 3);
      NodeAssert.ok(topology.across.every((triangle) => triangle >= 0));
      NodeAssert.equal(
        topology.sharp.reduce((count, sharp) => count + sharp, 0),
        spokes * 4,
      );
      return fingerprint(topology);
    },
  });
}

const regular = plane(128);
const regularTopology = defineBenchmark({
  id: "model.snap.regular.32768",
  description: "Build snapping adjacency for a regular indexed surface with low vertex valence.",
  workload: { triangles: 32768, divisions: 128, indexed: true },
  run: () => buildTopology(regular.positions, regular.index),
  check: (topology: Topology) => {
    NodeAssert.equal(topology.region.length, 32768);
    NodeAssert.equal(topology.positions.length / 3, 129 ** 2);
    NodeAssert.equal(new Set(topology.region).size, 1);
    NodeAssert.equal(topology.across.filter((triangle) => triangle < 0).length, 128 * 4);
    return fingerprint(topology);
  },
});

function gridBenchmark(divisions: number, size: Vec3, shape: string) {
  const mesh = weld(subdividedBox(divisions, size)),
    triangles = mesh.triangles.length / 3;
  return defineBenchmark({
    id: `model.grid.${shape}.${triangles}`,
    description: "Build the print-check ray grid for a densely tessellated closed box.",
    workload: { triangles, divisions, dimensionsMm: size },
    run: () => buildGrid(mesh),
    check: (grid: Grid) => {
      NodeAssert.equal(grid.start[grid.start.length - 1], grid.triangles.length);
      NodeAssert.ok(grid.triangles.length >= triangles);
      for (let axis = 0; axis < 3; axis++) {
        const origin: [number, number, number] = [
            size[0] * 0.517,
            size[1] * 0.517,
            size[2] * 0.517,
          ],
          direction: [number, number, number] = [0, 0, 0];
        origin[axis] = -1;
        direction[axis] = 1;
        NodeAssert.ok(
          Math.abs((raycast(grid, origin, direction, size[axis]! + 2)?.distance ?? Infinity) - 1) <
            1e-7,
        );
      }
      return fingerprint({
        min: grid.min,
        max: grid.max,
        cellSize: grid.cellSize,
        dimensions: grid.dimensions,
        start: grid.start,
        triangles: grid.triangles,
      });
    },
  });
}

export const modelBenchmarks = [
  fanBenchmark(256),
  fanBenchmark(4096),
  regularTopology,
  gridBenchmark(32, [20, 20, 20], "box"),
  gridBenchmark(64, [20, 20, 20], "box"),
  gridBenchmark(64, [100, 100, 0.6], "plate"),
];
