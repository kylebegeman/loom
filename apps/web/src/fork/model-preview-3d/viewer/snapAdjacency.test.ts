import { BoxGeometry, CylinderGeometry } from "three";
import { expect, it } from "vite-plus/test";
import { buildTopology, SHARP_ANGLE_DEGREES, type Topology } from "./snap";

/** Exhaustive triangle membership is independent of the optimized vertex adjacency search. */
function referenceAdjacency(topology: Topology) {
  const { corners, positions } = topology,
    triangles = corners.length / 3,
    across = new Int32Array(corners.length).fill(-1),
    sharp = new Uint8Array(corners.length).fill(1),
    normals = new Float32Array(corners.length);
  for (let t = 0; t < triangles; t++) {
    const a = corners[t * 3]! * 3,
      b = corners[t * 3 + 1]! * 3,
      c = corners[t * 3 + 2]! * 3,
      ux = positions[b]! - positions[a]!,
      uy = positions[b + 1]! - positions[a + 1]!,
      uz = positions[b + 2]! - positions[a + 2]!,
      vx = positions[c]! - positions[a]!,
      vy = positions[c + 1]! - positions[a + 1]!,
      vz = positions[c + 2]! - positions[a + 2]!,
      x = uy * vz - uz * vy,
      y = uz * vx - ux * vz,
      z = ux * vy - uy * vx,
      size = Math.hypot(x, y, z) || 1;
    normals.set([x / size, y / size, z / size], t * 3);
  }
  const neighbors = Array.from({ length: triangles }, () => [] as number[]),
    threshold = Math.cos((SHARP_ANGLE_DEGREES * Math.PI) / 180);
  for (let e = 0; e < corners.length; e++) {
    const t = Math.floor(e / 3),
      a = corners[e]!,
      b = corners[t * 3 + ((e + 1) % 3)]!;
    if (a === b) continue;
    let matches = 0,
      match = -1;
    for (let other = 0; other < triangles; other++) {
      if (other === t) continue;
      const ids = corners.subarray(other * 3, other * 3 + 3);
      if (!ids.includes(b)) continue;
      for (const id of ids)
        if (id === a) {
          match = other;
          matches++;
        }
    }
    if (matches !== 1) continue;
    across[e] = match;
    const similarity =
      normals[t * 3]! * normals[match * 3]! +
      normals[t * 3 + 1]! * normals[match * 3 + 1]! +
      normals[t * 3 + 2]! * normals[match * 3 + 2]!;
    if (similarity >= threshold) {
      sharp[e] = 0;
      neighbors[t]!.push(match);
      neighbors[match]!.push(t);
    }
  }
  const region = new Uint32Array(triangles),
    visited = new Set<number>();
  let count = 0;
  for (let t = 0; t < triangles; t++) {
    if (visited.has(t)) continue;
    const queue = [t];
    visited.add(t);
    for (const member of queue) {
      region[member] = count;
      for (const neighbor of neighbors[member]!)
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
    }
    count++;
  }
  return { across, sharp, region };
}

const a = [0, 0, 0],
  b = [10, 0, 0],
  c = [0, 10, 0],
  d = [0, -10, 0];
const soups = [
  [
    "closed cube",
    new Float32Array(new BoxGeometry().toNonIndexed().getAttribute("position").array),
  ],
  [
    "high-valence cylinder",
    new Float32Array(
      new CylinderGeometry(20, 20, 10, 64).toNonIndexed().getAttribute("position").array,
    ),
  ],
  ["open surface", new Float32Array([...a, ...b, ...c, ...b, ...a, ...d])],
  ["same-winding duplicate", new Float32Array([...a, ...b, ...c, ...a, ...b, ...c])],
  [
    "non-manifold edge",
    new Float32Array([...a, ...b, ...c, ...b, ...a, ...d, ...a, ...b, 0, 0, 10]),
  ],
  [
    "repeated first endpoint",
    new Float32Array([...a, ...a, ...b, ...a, ...b, ...c, ...b, ...a, ...d]),
  ],
  [
    "repeated second endpoint",
    new Float32Array([...a, ...b, ...b, ...a, ...b, ...c, ...b, ...a, ...d]),
  ],
  ["collapsed triangle", new Float32Array([...a, ...a, ...a, ...a, ...b, ...c])],
] as const;

it.each(soups)("preserves exhaustive adjacency and smooth regions for %s", (_, positions) => {
  const actual = buildTopology(positions, null),
    expected = referenceAdjacency(actual);
  expect(actual.across).toEqual(expected.across);
  expect(actual.sharp).toEqual(expected.sharp);
  expect(actual.region).toEqual(expected.region);
});

it("preserves adjacency for mixed degenerate and disconnected indexed triangles", () => {
  const positions = new Float32Array([
      0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0, 0, 0, 10, 10, 0, 10, 100, 100, 100, 110, 100, 100,
      100, 110, 100,
    ]),
    indices = new Uint32Array(180);
  let seed = 42;
  for (let i = 0; i < indices.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    indices[i] = seed % 6;
  }
  indices.set([6, 7, 8], indices.length - 3);
  const actual = buildTopology(positions, indices),
    expected = referenceAdjacency(actual);
  expect(actual.across).toEqual(expected.across);
  expect(actual.sharp).toEqual(expected.sharp);
  expect(actual.region).toEqual(expected.region);
});
