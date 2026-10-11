import * as Schema from "effect/Schema";
import { ModelPoint } from "./model-workspace.ts";

export const OVERHANG_ANGLE = { minimum: 30, maximum: 70, default: 45 } as const;
export const BED_BAND_MM = 0.2;
const area = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
export const OverhangRegion = Schema.Struct({
  areaMm2: area,
  /** Area-weighted centre in model (file) coordinates. */
  centre: ModelPoint,
  /** Height above the part's lowest point in the current orientation. */
  heightMm: Schema.Tuple([area, area]),
});
export const OverhangStats = Schema.Struct({
  thresholdDegrees: Schema.Int.check(Schema.isBetween(OVERHANG_ANGLE)),
  totalAreaMm2: area,
  overhangAreaMm2: area,
  overhangPercent: Schema.Number.check(
    Schema.isFinite(),
    Schema.isBetween({ minimum: 0, maximum: 100 }),
  ),
  facets: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  regions: Schema.Array(OverhangRegion).check(Schema.isMaxLength(10)),
  oriented: Schema.Boolean,
});
export type OverhangRegion = typeof OverhangRegion.Type;
export type OverhangStats = typeof OverhangStats.Type;
type Point = readonly [number, number, number];
const height = (point: Point, up: Point) => point[0] * up[0] + point[1] * up[1] + point[2] * up[2];
const triangleArea = (a: Point, b: Point, c: Point) => {
  const x = b[0] - a[0],
    y = b[1] - a[1],
    z = b[2] - a[2];
  const X = c[0] - a[0],
    Y = c[1] - a[1],
    Z = c[2] - a[2];
  return Math.hypot(y * Z - z * Y, z * X - x * Z, x * Y - y * X) / 2;
};
/** Keep only the portion of a downward face above the first-layer band, as the shader does. */
function aboveBand(vertices: Point[], up: Point, bed: number): Point[] {
  const result: Point[] = [];
  let previous = vertices.at(-1)!;
  let previousHeight = height(previous, up) - bed;
  for (const current of vertices) {
    const currentHeight = height(current, up) - bed;
    if (currentHeight > 0 !== previousHeight > 0) {
      const t = previousHeight / (previousHeight - currentHeight);
      result.push([
        previous[0] + t * (current[0] - previous[0]),
        previous[1] + t * (current[1] - previous[1]),
        previous[2] + t * (current[2] - previous[2]),
      ]);
    }
    if (currentHeight > 0) result.push(current);
    previous = current;
    previousHeight = currentHeight;
  }
  return result;
}

/** Measures facets, joining overhangs at shared vertices quantized to one micrometre. */
export function overhangStats(
  positions: Float32Array,
  options: { thresholdDegrees: number; up?: Point },
): OverhangStats {
  const { thresholdDegrees } = options;
  if (
    !Number.isInteger(thresholdDegrees) ||
    thresholdDegrees < OVERHANG_ANGLE.minimum ||
    thresholdDegrees > OVERHANG_ANGLE.maximum
  )
    throw new RangeError("Overhang angles must be whole degrees from 30 to 70.");
  if (positions.length % 9 !== 0)
    throw new RangeError("Overhang positions must contain complete triangles.");
  const direction = options.up ?? [0, 0, 1];
  const length = Math.hypot(...direction);
  if (!direction.every(Number.isFinite) || !Number.isFinite(length) || length === 0)
    throw new RangeError("Overhang up must be a finite nonzero direction.");
  const up: Point = [direction[0] / length, direction[1] / length, direction[2] / length];
  let bed = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!,
      y = positions[i + 1]!,
      z = positions[i + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
      throw new RangeError("Overhang positions must be finite.");
    bed = Math.min(bed, x * up[0] + y * up[1] + z * up[2]);
  }
  const sine = Math.sin((thresholdDegrees * Math.PI) / 180);
  const parents: number[] = [];
  const shared = new Map<string, number>();
  const faces: Array<{
    areaMm2: number;
    weighted: [number, number, number];
    min: number;
    max: number;
  }> = [];
  const find = (id: number): number => {
    let root = id;
    while (parents[root] !== root) root = parents[root]!;
    while (parents[id] !== id) {
      const next = parents[id]!;
      parents[id] = root;
      id = next;
    }
    return root;
  };
  let totalAreaMm2 = 0;
  let overhangAreaMm2 = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]!,
      ay = positions[i + 1]!,
      az = positions[i + 2]!;
    const bx = positions[i + 3]!,
      by = positions[i + 4]!,
      bz = positions[i + 5]!;
    const cx = positions[i + 6]!,
      cy = positions[i + 7]!,
      cz = positions[i + 8]!;
    const x = bx - ax,
      y = by - ay,
      z = bz - az,
      X = cx - ax,
      Y = cy - ay,
      Z = cz - az;
    const nx = y * Z - z * Y,
      ny = z * X - x * Z,
      nz = x * Y - y * X;
    const normalLength = Math.hypot(nx, ny, nz);
    totalAreaMm2 += normalLength / 2;
    if (
      normalLength === 0 ||
      -(nx * up[0] + ny * up[1] + nz * up[2]) / normalLength <= sine + 1e-12
    )
      continue;
    const vertices: Point[] = [
      [ax, ay, az],
      [bx, by, bz],
      [cx, cy, cz],
    ];
    const clipped = aboveBand(vertices, up, bed + BED_BAND_MM);
    if (clipped.length < 3) continue;
    let areaMm2 = 0;
    const weighted: [number, number, number] = [0, 0, 0];
    for (let j = 1; j < clipped.length - 1; j++) {
      const a = clipped[0]!,
        b = clipped[j]!,
        c = clipped[j + 1]!;
      const area = triangleArea(a, b, c);
      areaMm2 += area;
      for (const axis of [0, 1, 2] as const)
        weighted[axis] += (area * (a[axis] + b[axis] + c[axis])) / 3;
    }
    if (areaMm2 === 0) continue;
    overhangAreaMm2 += areaMm2;
    const id = parents.length;
    parents.push(id);
    const heights = clipped.map((point) => Math.max(0, height(point, up) - bed));
    faces.push({ areaMm2, weighted, min: Math.min(...heights), max: Math.max(...heights) });
    for (const point of vertices) {
      const key = point.map((value) => Math.round(value * 1000)).join(",");
      const other = shared.get(key);
      if (other === undefined) shared.set(key, id);
      else parents[find(id)] = find(other);
    }
  }
  const groups = new Map<number, (typeof faces)[number]>();
  for (const [id, face] of faces.entries()) {
    const root = find(id),
      group = groups.get(root);
    if (!group) groups.set(root, { ...face, weighted: [...face.weighted] });
    else {
      group.areaMm2 += face.areaMm2;
      for (const axis of [0, 1, 2] as const) group.weighted[axis] += face.weighted[axis];
      group.min = Math.min(group.min, face.min);
      group.max = Math.max(group.max, face.max);
    }
  }
  return {
    thresholdDegrees,
    totalAreaMm2,
    overhangAreaMm2,
    overhangPercent: totalAreaMm2 === 0 ? 0 : Math.min(100, (overhangAreaMm2 / totalAreaMm2) * 100),
    facets: positions.length / 9,
    regions: [...groups.values()]
      .sort((a, b) => b.areaMm2 - a.areaMm2)
      .slice(0, 10)
      .map((group) => ({
        areaMm2: group.areaMm2,
        centre: group.weighted.map((value) => value / group.areaMm2) as [number, number, number],
        heightMm: [group.min, group.max],
      })),
    oriented: up[0] !== 0 || up[1] !== 0 || up[2] !== 1,
  };
}
