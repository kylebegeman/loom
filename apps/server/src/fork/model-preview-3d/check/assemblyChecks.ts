import { checkEnclosure } from "./enclosure.ts";
import { ASSEMBLY_MAX_REGIONS, type AssemblyPairResult } from "@t3tools/contracts/fork";
import type { AssemblyWorkerRequest, AssemblyWorkerCore, AssemblyWorkerPart } from "./protocol.ts";
import {
  CheckFailure,
  unionFind,
  capTriangles,
  vertex,
  weld,
  type Vec3,
  type TriangleSoup,
  type IndexedMesh,
} from "./mesh.ts";
import { readStl } from "./readStl.ts";
import { readObj } from "./readObj.ts";
import { read3mf } from "./read3mf.ts";
import { readGltf } from "./readGltf.ts";
import { buildGrid, raycast, type Grid } from "./grid.ts";
import { topologyOf } from "./topology.ts";
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3) => Math.hypot(...a);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const readPart = (part: AssemblyWorkerPart, maxTriangles: number): TriangleSoup => {
  const limits = { maxTriangles };
  const soup =
    part.format === "stl"
      ? readStl(part.files, limits)
      : part.format === "obj"
        ? readObj(part.files, limits)
        : part.format === "3mf"
          ? read3mf(part.files, limits)
          : readGltf(part.files, limits);
  const m = part.matrix;
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i]!,
      y = soup[i + 1]!,
      z = soup[i + 2]!;
    soup[i] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    soup[i + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    soup[i + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  }
  return soup;
};
const triangle = (mesh: IndexedMesh, t: number): readonly [Vec3, Vec3, Vec3] => [
  vertex(mesh, mesh.triangles[t * 3]!),
  vertex(mesh, mesh.triangles[t * 3 + 1]!),
  vertex(mesh, mesh.triangles[t * 3 + 2]!),
];
const bounds = (points: readonly Vec3[]) => ({
  min: [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a]!))) as unknown as Vec3,
  max: [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a]!))) as unknown as Vec3,
});
const boundsGap = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }) =>
  Math.hypot(...[0, 1, 2].map((i) => Math.max(0, a.min[i]! - b.max[i]!, b.min[i]! - a.max[i]!)));
/** Closest point on a triangle, including its edges and vertices. */
const closestPoint = (p: Vec3, [a, b, c]: readonly [Vec3, Vec3, Vec3]): Vec3 => {
  const ab = sub(b, a),
    ac = sub(c, a),
    ap = sub(p, a),
    d1 = dot(ab, ap),
    d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b),
    d3 = dot(ab, bp),
    d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c),
    d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const inv = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * inv), scale(ac, vc * inv)));
};
const segmentClosest = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): readonly [Vec3, Vec3] => {
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(a, c),
    aa = dot(u, u),
    bb = dot(u, v),
    cc = dot(v, v),
    dd = dot(u, w),
    ee = dot(v, w),
    den = aa * cc - bb * bb;
  let s = den > 1e-20 ? clamp((bb * ee - cc * dd) / den) : 0,
    t = cc > 1e-20 ? (bb * s + ee) / cc : 0;
  if (t < 0) {
    t = 0;
    s = aa > 1e-20 ? clamp(-dd / aa) : 0;
  } else if (t > 1) {
    t = 1;
    s = aa > 1e-20 ? clamp((bb - dd) / aa) : 0;
  }
  return [add(a, scale(u, s)), add(c, scale(v, t))];
};
const edgeCross = (a: Vec3, b: Vec3, [c, d, e]: readonly [Vec3, Vec3, Vec3]) => {
  const direction = sub(b, a),
    u = sub(d, c),
    v = sub(e, c),
    p = cross(direction, v),
    det = dot(u, p);
  if (Math.abs(det) < 1e-12) return null;
  const offset = sub(a, c),
    alpha = dot(offset, p) / det,
    q = cross(offset, u),
    beta = dot(direction, q) / det,
    t = dot(v, q) / det;
  if (alpha < -1e-9 || beta < -1e-9 || alpha + beta > 1 + 1e-9 || t < -1e-9 || t > 1 + 1e-9)
    return null;
  return {
    point: add(a, scale(direction, t)),
    proper: t > 1e-7 && t < 1 - 1e-7,
  };
};
const triangleDistance = (
  a: readonly [Vec3, Vec3, Vec3],
  b: readonly [Vec3, Vec3, Vec3],
  epsilon: number,
) => {
  let distance = Infinity,
    closest: readonly [Vec3, Vec3] = [a[0], b[0]],
    proper = false;
  const retain = (x: Vec3, y: Vec3) => {
    const d = length(sub(x, y));
    if (d < distance) {
      distance = d;
      closest = [x, y];
    }
  };
  for (let i = 0; i < 3; i++) {
    retain(a[i]!, closestPoint(a[i]!, b));
    retain(closestPoint(b[i]!, a), b[i]!);
    const hitA = edgeCross(a[i]!, a[(i + 1) % 3]!, b),
      hitB = edgeCross(b[i]!, b[(i + 1) % 3]!, a);
    for (const hit of [hitA, hitB])
      if (hit) {
        retain(hit.point, hit.point);
        proper ||= hit.proper;
      }
    for (let j = 0; j < 3; j++) {
      const [x, y] = segmentClosest(a[i]!, a[(i + 1) % 3]!, b[j]!, b[(j + 1) % 3]!);
      retain(x, y);
    }
  }
  const straddles = (points: readonly [Vec3, Vec3, Vec3], plane: readonly [Vec3, Vec3, Vec3]) => {
    const n = cross(sub(plane[1], plane[0]), sub(plane[2], plane[0])),
      norm = length(n),
      values = points.map((point) => dot(sub(point, plane[0]), n) / norm);
    return Math.min(...values) < -epsilon && Math.max(...values) > epsilon;
  };
  return { distance, closest, proper: proper && straddles(a, b) && straddles(b, a) };
};
const candidates = (grid: Grid, box: { min: Vec3; max: Vec3 }, radius: number) => {
  const lo = box.min.map((n, i) =>
      Math.max(0, Math.floor((n - radius - grid.min[i]!) / grid.cellSize)),
    ),
    hi = box.max.map((n, i) =>
      Math.min(grid.dimensions[i]! - 1, Math.floor((n + radius - grid.min[i]!) / grid.cellSize)),
    ),
    seen = new Set<number>();
  for (let z = lo[2]!; z <= hi[2]!; z++)
    for (let y = lo[1]!; y <= hi[1]!; y++)
      for (let x = lo[0]!; x <= hi[0]!; x++) {
        const cell = x + grid.dimensions[0] * (y + grid.dimensions[1] * z);
        for (let i = grid.start[cell]!; i < grid.start[cell + 1]!; i++)
          seen.add(grid.triangles[i]!);
      }
  return seen;
};
type Loaded = {
  part: AssemblyWorkerPart;
  mesh: IndexedMesh;
  grid?: Grid;
  topology?: ReturnType<typeof topologyOf>;
};
const gridOf = (part: Loaded) => (part.grid ??= buildGrid(part.mesh));
const inside = (point: Vec3, target: Loaded, tested: () => void, epsilon: number) => {
  const topology = (target.topology ??= topologyOf(target.mesh));
  if (!topology.watertight) return false;
  const grid = gridOf(target);
  for (const t of candidates(grid, { min: point, max: point }, epsilon)) {
    tested();
    if (length(sub(point, closestPoint(point, triangle(target.mesh, t)))) <= epsilon) return false;
  }
  const directions: Vec3[] = [
    [0.893, 0.371, 0.259],
    [-0.217, 0.932, 0.289],
    [0.193, -0.271, 0.943],
  ];
  let votes = 0;
  for (const direction of directions) {
    let origin = point,
      hits = 0,
      travel = 0;
    const max = length(sub(grid.max, grid.min)) * 3 + 1;
    while (travel < max) {
      const hit = raycast(grid, origin, direction, max - travel, -1, {
        accept: (t) => topology.shells[topology.triangleShell[t]!]!.closed,
        tested,
      });
      if (!hit) break;
      hits++;
      travel += hit.distance + 1e-5;
      origin = add(hit.point, scale(direction, 1e-5));
    }
    if (hits % 2) votes++;
  }
  return votes >= 2;
};
const REGION_CELL_MM = 2;
const REGION_CELL_LIMIT = 100_000;
type RegionAggregate = {
  count: number;
  sum: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
};
type RegionCell = RegionAggregate & { index: number; coordinate: Vec3 };
/** Aggregate contact samples by cell so repeated triangle pairs do not grow memory without bound. */
const contactRegions = () => {
  const cells = new Map<string, RegionCell>();
  const append = (point: Vec3) => {
    const coordinate = point.map((value) => Math.floor(value / REGION_CELL_MM)) as unknown as Vec3;
    const key = coordinate.join(",");
    let cell = cells.get(key);
    if (!cell) {
      if (cells.size === REGION_CELL_LIMIT)
        throw new CheckFailure("too-large", "Assembly contact-region budget reached.");
      cell = {
        index: cells.size,
        coordinate,
        count: 0,
        sum: [0, 0, 0],
        min: [...point],
        max: [...point],
      };
      cells.set(key, cell);
    }
    cell.count++;
    for (let axis = 0; axis < 3; axis++) {
      cell.sum[axis] = cell.sum[axis]! + point[axis]!;
      cell.min[axis] = Math.min(cell.min[axis]!, point[axis]!);
      cell.max[axis] = Math.max(cell.max[axis]!, point[axis]!);
    }
  };
  const finish = (): AssemblyPairResult["regions"] => {
    const uf = unionFind(cells.size);
    for (const cell of cells.values()) {
      const [x, y, z] = cell.coordinate;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const other = cells.get(`${x + dx},${y + dy},${z + dz}`);
            if (other && other.index < cell.index) uf.join(cell.index, other.index);
          }
    }
    const clusters = new Map<number, RegionAggregate>();
    for (const cell of cells.values()) {
      const root = uf.find(cell.index);
      let group = clusters.get(root);
      if (!group) {
        group = { count: 0, sum: [0, 0, 0], min: [...cell.min], max: [...cell.max] };
        clusters.set(root, group);
      }
      group.count += cell.count;
      for (let axis = 0; axis < 3; axis++) {
        group.sum[axis] = group.sum[axis]! + cell.sum[axis]!;
        group.min[axis] = Math.min(group.min[axis]!, cell.min[axis]!);
        group.max[axis] = Math.max(group.max[axis]!, cell.max[axis]!);
      }
    }
    return [...clusters.values()]
      .toSorted((a, b) => b.count - a.count)
      .slice(0, ASSEMBLY_MAX_REGIONS)
      .map((group) => {
        const point = scale(group.sum, 1 / group.count);
        // Bounds provide a conservative radius covering every sample without storing each triangle pair.
        const radiusMm = Math.max(
          0.5,
          Math.hypot(
            ...point.map((value, axis) =>
              Math.max(value - group.min[axis]!, group.max[axis]! - value),
            ),
          ),
        );
        return { point, radiusMm, triangles: group.count };
      });
  };
  return { append, finish };
};
export const runAssemblyChecks = (request: AssemblyWorkerRequest): AssemblyWorkerCore => {
  const started = performance.now(),
    loaded = new Map<string, Loaded>();
  let total = 0,
    intersectionTests = 0,
    distanceTests = 0,
    complete = true;
  for (const part of request.parts) {
    const soup = readPart(part, request.limits.maxTriangles - total);
    total += soup.length / 9;
    capTriangles(total, request.limits.maxTriangles);
    loaded.set(part.id, { part, mesh: weld(soup) });
  }
  const pairs: AssemblyPairResult[] = [];
  const budget = () => {
    if (++intersectionTests > request.limits.intersections)
      throw new CheckFailure("too-large", "Assembly intersection budget reached.");
  };
  for (const pair of request.pairs) {
    const a = loaded.get(pair.a),
      b = loaded.get(pair.b);
    if (!a || !b) continue;
    const epsilon = Math.max(
      1e-4,
      1e-6 *
        Math.hypot(
          ...[0, 1, 2].map(
            (axis) =>
              Math.max(a.mesh.bounds.max[axis]!, b.mesh.bounds.max[axis]!) -
              Math.min(a.mesh.bounds.min[axis]!, b.mesh.bounds.min[axis]!),
          ),
        ),
    );
    const radius = Math.max(2 * (pair.requiredMm ?? 0), 0.5),
      gap = boundsGap(a.mesh.bounds, b.mesh.bounds),
      regions = contactRegions();
    let minimum = Infinity,
      closest: AssemblyPairResult["closest"] = null,
      proper = false,
      pairComplete = true,
      status: AssemblyPairResult["status"] = "clear";
    try {
      if (gap <= radius) {
        const grid = gridOf(b);
        for (let ta = 0; ta < a.mesh.triangles.length / 3; ta++) {
          const triA = triangle(a.mesh, ta),
            box = bounds(triA);
          for (const tb of candidates(grid, box, radius)) {
            budget();
            const triB = triangle(b.mesh, tb);
            if (boundsGap(box, bounds(triB)) > radius) continue;
            if (++distanceTests > request.limits.distances)
              throw new CheckFailure("too-large", "Assembly distance budget reached.");
            const hit = triangleDistance(triA, triB, epsilon);
            if (hit.distance < minimum) {
              minimum = hit.distance;
              closest = { a: hit.closest[0], b: hit.closest[1] };
            }
            proper ||= hit.proper;
            if (hit.distance <= epsilon) {
              regions.append(scale(add(hit.closest[0], hit.closest[1]), 0.5));
            }
          }
        }
        if (proper) status = "intersects";
        else if (minimum <= epsilon) status = "touching";
        if (status === "touching") {
          // Aligned overlapping solids can share boundary planes without strictly crossing triangles.
          // A witness must lie inside both actual meshes; overlapping bounds alone prove nothing.
          const overlapMin = a.mesh.bounds.min.map((value, axis) =>
              Math.max(value, b.mesh.bounds.min[axis]!),
            ),
            overlapMax = a.mesh.bounds.max.map((value, axis) =>
              Math.min(value, b.mesh.bounds.max[axis]!),
            );
          if (overlapMax.every((value, axis) => value - overlapMin[axis]! > 2 * epsilon)) {
            const witness = overlapMin.map(
              (value, axis) => (value + overlapMax[axis]!) / 2,
            ) as unknown as Vec3;
            if (inside(witness, a, budget, epsilon) && inside(witness, b, budget, epsilon))
              status = "intersects";
          }
        }
        if (status !== "intersects") {
          const contained = (inner: Loaded, outer: Loaded) =>
            inner.mesh.bounds.min.every((value, index) => value >= outer.mesh.bounds.min[index]!) &&
            inner.mesh.bounds.max.every((value, index) => value <= outer.mesh.bounds.max[index]!);
          if (
            status === "clear" &&
            ((contained(a, b) && !(b.topology ??= topologyOf(b.mesh)).watertight) ||
              (contained(b, a) && !(a.topology ??= topologyOf(a.mesh)).watertight))
          ) {
            pairComplete = false;
            complete = false;
          }
          const samples = (part: Loaded) => {
            const topology = (part.topology ??= topologyOf(part.mesh));
            return topology.shells.map((shell) =>
              vertex(part.mesh, part.mesh.triangles[shell.triangles[0]! * 3]!),
            );
          };
          const inA = samples(a).some((p) => inside(p, b, budget, epsilon)),
            inB = samples(b).some((p) => inside(p, a, budget, epsilon));
          if (inA || inB) status = minimum <= epsilon ? "intersects" : "inside";
        }
      }
    } catch (cause) {
      if (!(cause instanceof CheckFailure) || cause.reason !== "too-large") throw cause;
      pairComplete = false;
      complete = false;
    }
    // A budget limit does not erase contact or crossing already proved by the search.
    if (proper) status = "intersects";
    else if (minimum <= epsilon && status === "clear") status = "touching";
    const exact = Number.isFinite(minimum) && minimum <= radius && (pairComplete || minimum === 0),
      lower = gap > radius ? gap : radius;
    const result: AssemblyPairResult = {
      ...pair,
      status,
      clearance:
        pair.requiredMm === null
          ? null
          : status === "intersects" ||
              status === "inside" ||
              (Number.isFinite(minimum) && minimum + 1e-6 < pair.requiredMm)
            ? "tight"
            : pairComplete
              ? "ok"
              : null,
      minDistanceMm: exact ? minimum : null,
      atLeastMm: exact ? null : pairComplete ? lower : null,
      closest: exact ? closest : null,
      regions: regions.finish(),
      complete: pairComplete,
    };
    if (pair.clearanceId || status !== "clear" || !pairComplete) pairs.push(result);
  }
  const board = request.enclosure ? loaded.get(request.enclosure.board) : null;
  const enclosure =
    request.enclosure && board
      ? checkEnclosure(
          request.enclosure,
          board.part.matrix,
          new Map([...loaded].map(([id, v]) => [id, v.mesh])),
          pairs,
        )
      : undefined;
  if (enclosure) complete &&= enclosure.complete;
  return {
    ...(enclosure ? { enclosure } : {}),
    parts: [...loaded.values()].map(({ part, mesh }) => ({
      id: part.id,
      geometryRevision: part.geometryRevision,
      triangles: mesh.triangles.length / 3,
      bounds: mesh.bounds,
    })),
    pairs,
    summary: {
      pairsTested: request.pairs.length,
      intersecting: pairs.filter((p) => p.status === "intersects" || p.status === "inside").length,
      touching: pairs.filter((p) => p.status === "touching").length,
      tight: pairs.filter((p) => p.clearance === "tight").length,
    },
    complete,
    durationMs: performance.now() - started,
  };
};
