import {
  buildTopology,
  SHARP_ANGLE_DEGREES,
  topologyPoint,
  type Point,
  type Topology,
} from "./snap";

/** Parameters one analysis perturbs, so at most 16 renders. */
export const MAX_LINKED_PARAMETERS = 8;
/** Triangles sampled per region when measuring how far it moved. */
const REGION_SAMPLES = 12;
/** Movement below this fraction of the part's diagonal is float noise. */
const MOVE_FRACTION = 1e-4;
/** Searches reach this fraction of the diagonal; a farther move counts as that far. */
const REACH_FRACTION = 0.1;
/** A moved surface still faces within the smooth-region angle of where it did. */
const FACING = Math.cos((SHARP_ANGLE_DEGREES * Math.PI) / 180);

/** A render of the part with one parameter changed by `delta`. */
export type Perturbation = { delta: number; positions: Float32Array };

/**
 * How a parameter moves the base part's regions: millimetres along each
 * region's outward normal per unit increase, keyed by region. A parameter
 * that adds or removes a feature has no stable regions to compare.
 */
export type ParameterLink =
  | { status: "linked"; rates: Map<number, number> }
  | { status: "changes-shape" };

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const along = (a: Point, b: Point, s: number): Point => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];

const corner = (t: Topology, triangle: number, k: number) =>
  topologyPoint(t, t.corners[triangle * 3 + k]!);

function triangleNormal(t: Topology, triangle: number): Point {
  const a = corner(t, triangle, 0),
    n = cross(sub(corner(t, triangle, 1), a), sub(corner(t, triangle, 2), a)),
    size = Math.hypot(...n);
  return size ? [n[0] / size, n[1] / size, n[2] / size] : [0, 0, 0];
}

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(p: Point, a: Point, b: Point, c: Point): Point {
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
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return along(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c),
    d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return along(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return along(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const denominator = 1 / (va + vb + vc);
  return along(along(a, ab, vb * denominator), ac, vc * denominator);
}

/** Length of the diagonal of the positions' bounding box. */
function diagonal(positions: Float32Array): number {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const k = i % 3;
    min[k] = Math.min(min[k]!, positions[i]!);
    max[k] = Math.max(max[k]!, positions[i]!);
  }
  return positions.length ? Math.hypot(...max.map((v, k) => v - min[k]!)) : 0;
}

const regionCount = (t: Topology) => t.region.reduce((n, r) => Math.max(n, r + 1), 0);

/**
 * Finds the nearest surface that faces the same way as a probe, among
 * triangles within `reach`. Triangles are hashed into cells `reach` wide, so a
 * probe checks only the 27 cells around it.
 */
function surfaceIndex(t: Topology, reach: number) {
  const triangles = t.corners.length / 3,
    cells = new Map<string, number[]>(),
    normals = Array.from({ length: triangles }, (_, i) => triangleNormal(t, i)),
    cell = (v: number) => Math.floor(v / reach);
  for (let i = 0; i < triangles; i++) {
    const points = [0, 1, 2].map((k) => corner(t, i, k)),
      low = [0, 1, 2].map((k) => cell(Math.min(...points.map((p) => p[k]!)))),
      high = [0, 1, 2].map((k) => cell(Math.max(...points.map((p) => p[k]!))));
    for (let x = low[0]!; x <= high[0]!; x++)
      for (let y = low[1]!; y <= high[1]!; y++)
        for (let z = low[2]!; z <= high[2]!; z++) {
          const key = `${x},${y},${z}`,
            list = cells.get(key);
          if (list) list.push(i);
          else cells.set(key, [i]);
        }
  }
  const seen = new Int32Array(triangles).fill(-1);
  let probe = 0;
  /** The signed move along `normal` to the nearest same-facing surface, or undefined past reach. */
  return (point: Point, normal: Point): number | undefined => {
    probe++;
    let best = reach,
      found: number | undefined;
    const [cx, cy, cz] = point.map(cell) as Point;
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let z = cz - 1; z <= cz + 1; z++)
          for (const i of cells.get(`${x},${y},${z}`) ?? []) {
            if (seen[i] === probe) continue;
            seen[i] = probe;
            if (dot(normals[i]!, normal) < FACING) continue;
            const q = closestOnTriangle(point, corner(t, i, 0), corner(t, i, 1), corner(t, i, 2)),
              distance = Math.hypot(...sub(q, point));
            if (distance <= best) {
              best = distance;
              found = dot(sub(q, point), normal);
            }
          }
    return found;
  };
}

/** Up to REGION_SAMPLES triangle centers per region, spread through it. */
function regionSamples(t: Topology) {
  const members = new Map<number, number[]>();
  t.region.forEach((r, i) => {
    const list = members.get(r);
    if (list) list.push(i);
    else members.set(r, [i]);
  });
  const samples: { region: number; point: Point; normal: Point }[] = [];
  for (const [region, triangles] of members) {
    const stride = Math.max(1, triangles.length / REGION_SAMPLES);
    for (let s = 0; s < triangles.length; s += stride) {
      const i = triangles[Math.floor(s)]!,
        [a, b, c] = [0, 1, 2].map((k) => corner(t, i, k)) as [Point, Point, Point],
        normal = triangleNormal(t, i);
      if (normal.every((n) => n === 0)) continue;
      samples.push({
        region,
        point: [0, 1, 2].map((k) => (a[k]! + b[k]! + c[k]!) / 3) as Point,
        normal,
      });
    }
  }
  return samples;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length / 2;
  return sorted.length % 2
    ? sorted[Math.floor(middle)]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/**
 * Attributes the base part's regions to one parameter from renders nudged up and down. Samples at a
 * few triangle centers move by the signed distance along their normal to the nearest same-facing
 * surface; a region moved when those exceed noise, at the median move per unit of change.
 */
export function linkParameter(
  base: Topology,
  perturbations: readonly Perturbation[],
): ParameterLink {
  const size = diagonal(base.positions),
    reach = Math.max(size * REACH_FRACTION, 1e-6),
    noise = Math.max(size * MOVE_FRACTION, 1e-6),
    samples = regionSamples(base),
    regions = regionCount(base),
    found = new Map<number, number[]>();
  for (const { delta, positions } of perturbations) {
    const moved = buildTopology(positions, null);
    if (regionCount(moved) !== regions) return { status: "changes-shape" };
    const nearest = surfaceIndex(moved, reach),
      byRegion = new Map<number, number[]>();
    for (const { region, point, normal } of samples) {
      // Nothing within reach facing the same way: it moved at least that far.
      const move = nearest(point, normal) ?? reach,
        list = byRegion.get(region);
      if (list) list.push(move);
      else byRegion.set(region, [move]);
    }
    for (const [region, moves] of byRegion) {
      const rms = Math.sqrt(moves.reduce((n, m) => n + m * m, 0) / moves.length);
      if (rms <= noise) continue;
      const rates = found.get(region) ?? [];
      rates.push(median(moves) / delta);
      found.set(region, rates);
    }
  }
  return {
    status: "linked",
    rates: new Map(
      [...found].map(([region, rates]) => [
        region,
        rates.reduce((n, r) => n + r, 0) / rates.length,
      ]),
    ),
  };
}

/**
 * The base region under a model-space pick: the nearest triangle that faces
 * the picked face's way, or the nearest at all when no normal is known.
 */
export function regionAt(base: Topology, point: Point, normal?: Point): number | undefined {
  let best = Infinity,
    region: number | undefined;
  for (let i = 0; i < base.corners.length / 3; i++) {
    if (normal && dot(triangleNormal(base, i), normal) < FACING) continue;
    const q = closestOnTriangle(point, corner(base, i, 0), corner(base, i, 1), corner(base, i, 2)),
      distance = Math.hypot(...sub(q, point));
    if (distance < best) {
      best = distance;
      region = base.region[i];
    }
  }
  return region;
}

/** The triangles of the given regions as a triangle soup, for a highlight. */
export function regionsPositions(base: Topology, regions: ReadonlySet<number>): Float32Array {
  const triangles: number[] = [];
  base.region.forEach((r, i) => regions.has(r) && triangles.push(i));
  const out = new Float32Array(triangles.length * 9);
  triangles.forEach((triangle, i) => {
    for (let k = 0; k < 3; k++) out.set(corner(base, triangle, k), i * 9 + k * 3);
  });
  return out;
}
