import { weldPositions } from "./weld";
export const SNAP_TRIANGLE_LIMIT = 1_000_000;
export const SHARP_ANGLE_DEGREES = 20;
export type Point = [number, number, number];
export type Topology = {
  positions: Float32Array;
  corners: Uint32Array;
  vertexStart: Uint32Array;
  vertexTriangles: Uint32Array;
  across: Int32Array;
  sharp: Uint8Array;
  region: Uint32Array;
};
export type SnapKind = "vertex" | "center" | "midpoint" | "faceCenter" | "edge" | "face";
/**
 * Feature snaps in priority order. Any candidate of an earlier kind within reach wins over a
 * nearer one of a later kind; the bare surface comes last.
 */
export const SNAP_PRIORITY = [
  "vertex",
  "center",
  "midpoint",
  "faceCenter",
  "edge",
] as const satisfies readonly SnapKind[];
export type Snap = {
  kind: SnapKind;
  point: Point;
  edge: [number, number] | null;
  /** A hole center snap: the fitted rim it is the center of. */
  circle?: CircleFit;
  /** Fitted rims whose outline passes within reach of the cursor. */
  rims?: CircleFit[];
};
export type CircleFit = {
  center: Point;
  normal: Point;
  diameter: number;
  sides: number | null;
  loop: Point[];
  rms: number;
};
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: Point, s: number): Point => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const length = (a: Point) => Math.hypot(...a);
const unit = (a: Point) => scale(a, 1 / (length(a) || 1));
export const topologyPoint = (topology: Topology, id: number): Point => [
  topology.positions[id * 3]!,
  topology.positions[id * 3 + 1]!,
  topology.positions[id * 3 + 2]!,
];
/** Builds CSR adjacency and smooth regions without allocating arrays per vertex. */
export function buildTopology(positions: Float32Array, index: Uint32Array | null): Topology {
  const welded = weldPositions(positions, index),
    corners = welded.corners;
  const vertices = welded.positions.length / 3,
    triangles = corners.length / 3;
  if (triangles > SNAP_TRIANGLE_LIMIT) throw new Error("Model exceeds the snapping triangle limit");
  const vertexStart = new Uint32Array(vertices + 1);
  for (const id of corners) vertexStart[id + 1]!++;
  for (let i = 1; i <= vertices; i++) vertexStart[i]! += vertexStart[i - 1]!;
  const write = vertexStart.slice(),
    vertexTriangles = new Uint32Array(corners.length);
  for (let i = 0; i < corners.length; i++)
    vertexTriangles[write[corners[i]!]!++] = Math.floor(i / 3);
  const across = new Int32Array(corners.length).fill(-1),
    sharp = new Uint8Array(corners.length).fill(1),
    region = new Uint32Array(triangles),
    normals = new Float32Array(corners.length);
  const result: Topology = { ...welded, vertexStart, vertexTriangles, across, sharp, region };
  for (let t = 0; t < triangles; t++) {
    region[t] = t;
    const a = topologyPoint(result, corners[t * 3]!),
      b = topologyPoint(result, corners[t * 3 + 1]!),
      c = topologyPoint(result, corners[t * 3 + 2]!);
    normals.set(unit(cross(sub(b, a), sub(c, a))), t * 3);
  }
  const root = (id: number): number => {
    while (region[id] !== id) {
      region[id] = region[region[id]!]!;
      id = region[id]!;
    }
    return id;
  };
  const threshold = Math.cos((SHARP_ANGLE_DEGREES * Math.PI) / 180);
  for (let e = 0; e < corners.length; e++) {
    const t = Math.floor(e / 3),
      a = corners[e]!,
      b = corners[t * 3 + (((e % 3) + 1) % 3)]!;
    if (a === b) continue;
    // A cap's shared center can touch thousands of triangles; inspect the smaller endpoint fan.
    const scanA = vertexStart[a + 1]! - vertexStart[a]! <= vertexStart[b + 1]! - vertexStart[b]!,
      scan = scanA ? a : b,
      seek = scanA ? b : a;
    let match = -1,
      matches = 0;
    for (let i = vertexStart[scan]!; i < vertexStart[scan + 1]!; i++) {
      const other = vertexTriangles[i]!;
      if (other === t) continue;
      const x = corners[other * 3]!,
        y = corners[other * 3 + 1]!,
        z = corners[other * 3 + 2]!;
      if (x === seek || y === seek || z === seek) {
        match = other;
        // Repeated corners contribute once per original a occurrence, whichever fan we inspect.
        matches += scanA
          ? 1
          : (Number(x === a) + Number(y === a) + Number(z === a)) /
            (Number(x === b) + Number(y === b) + Number(z === b));
        if (matches > 1) break;
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
      region[root(t)] = root(match);
    }
  }
  const dense = new Int32Array(triangles).fill(-1);
  const roots = Uint32Array.from({ length: triangles }, (_, t) => root(t));
  let count = 0;
  for (let t = 0; t < triangles; t++) {
    const id = roots[t]!;
    if (dense[id] === -1) dense[id] = count++;
    region[t] = dense[id]!;
  }
  return result;
}
const closestSegment = (point: Point, a: Point, b: Point): Point => {
  const ab = sub(b, a),
    size = dot(ab, ab);
  return add(a, scale(ab, size ? Math.max(0, Math.min(1, dot(sub(point, a), ab) / size)) : 0));
};
const closestRay = (a: Point, b: Point, origin: Point, direction: Point): Point => {
  const ab = sub(b, a),
    ao = sub(a, origin),
    ray = unit(direction);
  const aa = dot(ab, ab),
    ar = dot(ab, ray),
    denominator = aa - ar * ar;
  let t = denominator > 1e-12 ? (ar * dot(ao, ray) - dot(ab, ao)) / denominator : 0;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, scale(ab, t));
  return dot(sub(point, origin), ray) < 0 ? closestSegment(origin, a, b) : point;
};
/** Candidates this close on screen tie; the one nearer the camera wins. */
const TIE_PX = 0.01;
type Best = Partial<Record<SnapKind, { value: Snap; distance: number; depth: number }>>;
/** Keeps the nearest candidate of each kind, preferring the front one on a tie. */
function candidates(
  ray: { origin: Point; direction: Point },
  maxDepth: number,
  toScreen: (point: Point) => [number, number],
  cursor: [number, number],
  radiusPx: number,
  keep: (point: Point) => boolean,
) {
  const best: Best = {},
    direction = unit(ray.direction);
  const offer = (kind: SnapKind, point: Point, edge: Snap["edge"], circle?: CircleFit) => {
    const depth = dot(sub(point, ray.origin), direction);
    if (!keep(point) || depth > maxDepth) return;
    const projected = toScreen(point),
      distance = Math.hypot(projected[0] - cursor[0], projected[1] - cursor[1]),
      current = best[kind];
    if (
      distance <= radiusPx &&
      (!current ||
        distance < current.distance - TIE_PX ||
        (distance <= current.distance + TIE_PX && depth < current.depth))
    )
      best[kind] = { value: { kind, point, edge, ...(circle && { circle }) }, distance, depth };
  };
  const winner = () => SNAP_PRIORITY.map((kind) => best[kind]?.value).find(Boolean);
  return { offer, winner };
}
/** Two fits of the same rim, from the regions on either side of it. */
export const sameRim = (a: CircleFit, b: CircleFit) =>
  length(sub(a.center, b.center)) <= 1e-6 * (1 + a.diameter) &&
  Math.abs(a.diameter - b.diameter) <= 1e-6 * (1 + a.diameter);
/** Screen distance from the cursor to a rim's projected outline. */
function rimDistance(
  fit: CircleFit,
  toScreen: (point: Point) => [number, number],
  cursor: [number, number],
): number {
  const projected = fit.loop.map(toScreen);
  let nearest = Infinity;
  projected.forEach((a, i) => {
    const b = projected[(i + 1) % projected.length]!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      size = dx * dx + dy * dy,
      t = size
        ? Math.max(0, Math.min(1, ((cursor[0] - a[0]) * dx + (cursor[1] - a[1]) * dy) / size))
        : 0;
    nearest = Math.min(nearest, Math.hypot(a[0] + dx * t - cursor[0], a[1] + dy * t - cursor[1]));
  });
  return nearest;
}
/**
 * Visits only the hit neighbourhood, capped independently of the mesh's total size. Besides
 * corners and edges it offers the centers of fitted hole rims and of flat faces in that
 * neighbourhood, plus the centers of `woken` rims: rims the cursor passed recently, so a through
 * hole's center, which has no surface under it, can still be reached.
 */
export function snapNear(
  topology: Topology,
  triangle: number,
  hit: Point,
  ray: { origin: Point; direction: Point },
  toScreen: (point: Point) => [number, number],
  radiusPx: number,
  keep: (point: Point) => boolean,
  woken: readonly CircleFit[] = [],
): Snap {
  const fallback: Snap = { kind: "face", point: hit, edge: null };
  if (triangle < 0 || triangle >= topology.region.length) return fallback;
  const cursor = toScreen(hit),
    direction = unit(ray.direction),
    hitDepth = dot(sub(hit, ray.origin), direction),
    tolerance = Math.max(0.5, 0.01 * Math.abs(hitDepth));
  const screenDistance = (p: Point) => {
    const projected = toScreen(p);
    return Math.hypot(projected[0] - cursor[0], projected[1] - cursor[1]);
  };
  const { offer: candidate, winner } = candidates(
    ray,
    hitDepth + tolerance,
    toScreen,
    cursor,
    radiusPx,
    keep,
  );
  const regions = new Set<number>(),
    seen = new Set<number>([triangle]),
    queue = [triangle];
  for (let q = 0; q < queue.length && q < 2000; q++) {
    const t = queue[q]!,
      ids = [topology.corners[t * 3]!, topology.corners[t * 3 + 1]!, topology.corners[t * 3 + 2]!];
    if (q && !ids.some((id) => screenDistance(topologyPoint(topology, id)) <= radiusPx * 2))
      continue;
    regions.add(topology.region[t]!);
    for (let c = 0; c < 3; c++) {
      const a = ids[c]!,
        b = ids[(c + 1) % 3]!,
        p = topologyPoint(topology, a),
        edge: Snap["edge"] = topology.sharp[t * 3 + c] ? [a, b] : null;
      candidate("vertex", p, edge);
      if (edge) {
        const end = topologyPoint(topology, b);
        candidate("midpoint", scale(add(p, end), 0.5), edge);
        candidate("edge", closestRay(p, end, ray.origin, direction), edge);
      }
      for (
        let i = topology.vertexStart[a]!;
        i < topology.vertexStart[a + 1]! && queue.length < 2000;
        i++
      ) {
        const adjacent = topology.vertexTriangles[i]!;
        if (!seen.has(adjacent)) {
          seen.add(adjacent);
          queue.push(adjacent);
        }
      }
    }
  }
  const rims: CircleFit[] = [];
  for (const region of regions) {
    const center = faceCenter(topology, region);
    if (center) candidate("faceCenter", center, null);
    for (const { fit } of regionRims(topology, region)) {
      if (!fit) continue;
      candidate("center", fit.center, null, fit);
      // A rim bounds two regions, its face and its wall, and is fitted twice.
      if (
        rimDistance(fit, toScreen, cursor) <= radiusPx &&
        !rims.some((other) => sameRim(other, fit))
      )
        rims.push(fit);
    }
  }
  for (const fit of woken) candidate("center", fit.center, null, fit);
  const snap = winner() ?? fallback;
  return rims.length ? { ...snap, rims } : snap;
}
/**
 * The nearest woken rim center within reach when the cursor is over empty space, such as the
 * middle of a through hole. Null when none is in reach.
 */
export function snapToRimCenter(
  woken: readonly CircleFit[],
  ray: { origin: Point; direction: Point },
  toScreen: (point: Point) => [number, number],
  cursor: [number, number],
  radiusPx: number,
  keep: (point: Point) => boolean,
): Snap | null {
  const { offer, winner } = candidates(ray, Infinity, toScreen, cursor, radiusPx, keep);
  for (const fit of woken) offer("center", fit.center, null, fit);
  return winner() ?? null;
}
/** Agent queries use model units and never depend on the camera pose. */
export function snapNearPoint(topology: Topology, point: Point, radiusMm: number): Snap {
  let distance = radiusMm,
    result: Snap = { kind: "face", point, edge: null };
  for (let id = 0; id < topology.positions.length / 3; id++) {
    const p = topologyPoint(topology, id),
      d = length(sub(p, point));
    if (d <= distance) {
      distance = d;
      result = { kind: "vertex", point: p, edge: null };
    }
  }
  if (result.kind === "vertex") return result;
  for (let e = 0; e < topology.corners.length; e++) {
    if (!topology.sharp[e]) continue;
    const a = topology.corners[e]!,
      b = topology.corners[Math.floor(e / 3) * 3 + (((e % 3) + 1) % 3)]!;
    const p = closestSegment(point, topologyPoint(topology, a), topologyPoint(topology, b)),
      d = length(sub(p, point));
    if (d <= distance) {
      distance = d;
      result = { kind: "edge", point: p, edge: [a, b] };
    }
  }
  return result;
}
function solve3(matrix: number[][]): Point | null {
  for (let c = 0; c < 3; c++) {
    let pivot = c;
    for (let r = c + 1; r < 3; r++)
      if (Math.abs(matrix[r]![c]!) > Math.abs(matrix[pivot]![c]!)) pivot = r;
    if (Math.abs(matrix[pivot]![c]!) < 1e-12) return null;
    [matrix[c], matrix[pivot]] = [matrix[pivot]!, matrix[c]!];
    const divisor = matrix[c]![c]!;
    for (let k = c; k < 4; k++) matrix[c]![k]! /= divisor;
    for (let r = 0; r < 3; r++)
      if (r !== c) {
        const f = matrix[r]![c]!;
        for (let k = c; k < 4; k++) matrix[r]![k]! -= f * matrix[c]![k]!;
      }
  }
  return [matrix[0]![3]!, matrix[1]![3]!, matrix[2]![3]!];
}
/** Fits closed rims in their own plane; short arcs and flat-sided rectangles are rejected. */
export function fitCircle(input: readonly Point[]): CircleFit | null {
  let loop = input.filter(
    (p, i) => length(sub(p, input[(i + input.length - 1) % input.length]!)) > 1e-8,
  );
  loop = loop.filter((p, i) => {
    const a = unit(sub(p, loop[(i + loop.length - 1) % loop.length]!)),
      b = unit(sub(loop[(i + 1) % loop.length]!, p));
    return dot(a, b) < Math.cos(Math.PI / 180);
  });
  if (loop.length < 5 || loop.some((p) => p.some((v) => !Number.isFinite(v)))) return null;
  let newell: Point = [0, 0, 0],
    origin: Point = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!,
      q = loop[(i + 1) % loop.length]!;
    newell = add(newell, cross(p, q));
    origin = add(origin, scale(p, 1 / loop.length));
  }
  if (length(newell) < 1e-10) return null;
  const normal = unit(newell),
    x = unit(cross(normal, Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])),
    y = cross(normal, x);
  const matrix = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    points = loop.map((p) => {
      const relative = sub(p, origin);
      return [dot(relative, x), dot(relative, y), dot(relative, normal)];
    });
  for (const [px, py] of points) {
    const row = [px!, py!, 1],
      value = -(px! * px! + py! * py!);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) matrix[r]![c]! += row[r]! * row[c]!;
      matrix[r]![3]! += row[r]! * value;
    }
  }
  const fit = solve3(matrix);
  if (!fit) return null;
  const cx = -fit[0] / 2,
    cy = -fit[1] / 2,
    squared = cx * cx + cy * cy - fit[2];
  if (squared <= 0) return null;
  const radius = Math.sqrt(squared),
    rms = Math.sqrt(
      points.reduce((sum, p) => sum + (Math.hypot(p[0]! - cx, p[1]! - cy) - radius) ** 2, 0) /
        points.length,
    );
  if (
    points.reduce((max, p) => Math.max(max, Math.abs(p[2]!)), 0) > Math.max(0.02 * radius, 0.01) ||
    rms > 0.05 * radius
  )
    return null;
  return {
    center: add(origin, add(scale(x, cx), scale(y, cy))),
    normal,
    diameter: radius * 2,
    sides: loop.length <= 128 ? loop.length : null,
    loop,
    rms,
  };
}
const sameEdge = (a: number, b: number, edge: [number, number]) =>
  (a === edge[0] && b === edge[1]) || (a === edge[1] && b === edge[0]);
type Rim = { ids: number[]; fit: CircleFit | null };
/** Triangles grouped by smooth region, built once per topology. */
const regionIndex = new WeakMap<Topology, { start: Uint32Array; triangles: Uint32Array }>(),
  rimCache = new WeakMap<Topology, Map<number, Rim[]>>(),
  centerCache = new WeakMap<Topology, Map<number, Point | null>>();
/** A region is one flat face when every triangle is within this of its plane. */
const FLAT_COS = Math.cos(Math.PI / 180),
  FLAT_PLANE_MM = 0.01;
/**
 * Area centroid of a smooth region that is one flat face, bounded all round by sharp edges.
 * Curved regions have no face center, so a finely tessellated surface does not turn every facet
 * into a snap target.
 */
export function faceCenter(topology: Topology, region: number): Point | null {
  let cache = centerCache.get(topology);
  if (!cache) centerCache.set(topology, (cache = new Map()));
  if (cache.has(region)) return cache.get(region)!;
  let normal: Point | null = null,
    origin: Point = [0, 0, 0],
    area = 0,
    sum: Point = [0, 0, 0],
    flat = true;
  for (const t of regionTriangles(topology, region)) {
    const [a, b, c] = [0, 1, 2].map((k) =>
        topologyPoint(topology, topology.corners[t * 3 + k]!),
      ) as [Point, Point, Point],
      twice = cross(sub(b, a), sub(c, a)),
      size = length(twice);
    if (size < 1e-12) continue;
    const n = scale(twice, 1 / size);
    if (!normal) {
      normal = n;
      origin = a;
    } else if (
      dot(n, normal) < FLAT_COS ||
      [a, b, c].some((p) => Math.abs(dot(sub(p, origin), normal!)) > FLAT_PLANE_MM)
    ) {
      flat = false;
      break;
    }
    area += size;
    sum = add(sum, scale(add(add(a, b), c), size / 3));
  }
  const center = flat && area > 0 ? scale(sum, 1 / area) : null;
  cache.set(region, center);
  return center;
}
function regionTriangles(topology: Topology, region: number): Uint32Array {
  let index = regionIndex.get(topology);
  if (!index) {
    const regions = topology.region,
      count = regions.reduce((max, r) => Math.max(max, r + 1), 0),
      start = new Uint32Array(count + 1),
      triangles = new Uint32Array(regions.length);
    for (const r of regions) start[r + 1]!++;
    for (let i = 1; i <= count; i++) start[i]! += start[i - 1]!;
    const write = start.slice();
    for (let t = 0; t < regions.length; t++) triangles[write[regions[t]!]!++] = t;
    index = { start, triangles };
    regionIndex.set(topology, index);
  }
  return index.triangles.subarray(index.start[region] ?? 0, index.start[region + 1] ?? 0);
}
/**
 * Closed boundary loops of one smooth region with their circle fits. Hover asks for the same
 * rims many times a second, so each region is traced and fitted once per topology.
 */
function regionRims(topology: Topology, region: number): Rim[] {
  let cache = rimCache.get(topology);
  if (!cache) rimCache.set(topology, (cache = new Map()));
  const cached = cache.get(region);
  if (cached) return cached;
  const links = new Map<number, number[]>();
  for (const t of regionTriangles(topology, region))
    for (let c = 0; c < 3; c++) {
      const e = t * 3 + c,
        other = topology.across[e]!;
      if (other >= 0 && topology.region[other] === region) continue;
      const a = topology.corners[e]!,
        b = topology.corners[t * 3 + ((c + 1) % 3)]!;
      const aa = links.get(a) ?? [],
        bb = links.get(b) ?? [];
      if (!aa.includes(b)) aa.push(b);
      if (!bb.includes(a)) bb.push(a);
      links.set(a, aa);
      links.set(b, bb);
    }
  const used = new Set<number>(),
    rims: Rim[] = [];
  for (const start of links.keys()) {
    if (used.has(start) || links.get(start)?.length !== 2) continue;
    const ids: number[] = [];
    let previous = -1,
      current = start,
      closed = false;
    while (ids.length < 100000) {
      if (used.has(current)) {
        closed = current === start;
        break;
      }
      const neighbours = links.get(current);
      if (neighbours?.length !== 2) break;
      used.add(current);
      ids.push(current);
      const next = neighbours[0] === previous ? neighbours[1]! : neighbours[0]!;
      previous = current;
      current = next;
    }
    if (closed) rims.push({ ids, fit: fitCircle(ids.map((id) => topologyPoint(topology, id))) });
  }
  cache.set(region, rims);
  return rims;
}
/** Traces each boundary component of a smooth region; branches are not circular rims. */
export function circleAt(
  topology: Topology,
  triangle: number,
  hit: Point,
  edge: [number, number] | null,
): CircleFit | null {
  if (triangle < 0 || triangle >= topology.region.length) return null;
  const regions = new Set<number>([topology.region[triangle]!]);
  if (edge)
    for (let i = topology.vertexStart[edge[0]]!; i < topology.vertexStart[edge[0] + 1]!; i++) {
      const t = topology.vertexTriangles[i]!;
      if (
        [0, 1, 2].some((c) =>
          sameEdge(topology.corners[t * 3 + c]!, topology.corners[t * 3 + ((c + 1) % 3)]!, edge),
        )
      )
        regions.add(topology.region[t]!);
    }
  let best: CircleFit | null = null,
    nearest = Infinity;
  for (const region of regions)
    for (const { ids, fit } of regionRims(topology, region)) {
      if (!fit || (edge && !ids.some((id, i) => sameEdge(id, ids[(i + 1) % ids.length]!, edge))))
        continue;
      const distance = fit.loop.reduce(
        (minimum, p, i) =>
          Math.min(
            minimum,
            length(sub(closestSegment(hit, p, fit.loop[(i + 1) % fit.loop.length]!), hit)),
          ),
        Infinity,
      );
      if (
        distance < nearest ||
        (Math.abs(distance - nearest) < 1e-8 && fit.rms < (best?.rms ?? Infinity))
      ) {
        best = fit;
        nearest = distance;
      }
    }
  return best;
}
