import { CheckFailure, vertex, type IndexedMesh, type Vec3 } from "./mesh.ts";
export type RayHit = { triangle: number; distance: number; point: Vec3 };
export type Grid = {
  min: Vec3;
  max: Vec3;
  cellSize: number;
  dimensions: readonly [number, number, number];
  start: Uint32Array;
  triangles: Uint32Array;
  mailbox: Int32Array;
  rayId: number;
  mesh: IndexedMesh;
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const buildGrid = (mesh: IndexedMesh, maxReferences = 2 ** 25): Grid => {
  const min: Vec3 = [
      mesh.bounds.min[0] - 1e-3,
      mesh.bounds.min[1] - 1e-3,
      mesh.bounds.min[2] - 1e-3,
    ],
    max: Vec3 = [mesh.bounds.max[0] + 1e-3, mesh.bounds.max[1] + 1e-3, mesh.bounds.max[2] + 1e-3];
  const extent: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    total = mesh.triangles.length / 3;
  let h = Math.max(
    Math.cbrt((extent[0] * extent[1] * extent[2]) / Math.max(1, Math.min(total * 2, 2 ** 22))),
    Math.max(...extent) / 512,
    1e-3,
  );
  for (let retry = 0; retry < 4; retry++, h *= 2) {
    const dimensions: readonly [number, number, number] = [
        Math.ceil(extent[0] / h),
        Math.ceil(extent[1] / h),
        Math.ceil(extent[2] / h),
      ],
      cells = dimensions[0] * dimensions[1] * dimensions[2];
    const counts = new Uint32Array(cells),
      ranges = new Uint32Array(total * 6);
    let refs = 0;
    for (let t = 0; t < total; t++) {
      const a = mesh.triangles[t * 3]! * 3,
        b = mesh.triangles[t * 3 + 1]! * 3,
        c = mesh.triangles[t * 3 + 2]! * 3;
      for (let axis = 0; axis < 3; axis++) {
        const x = mesh.vertices[a + axis]!,
          y = mesh.vertices[b + axis]!,
          z = mesh.vertices[c + axis]!;
        ranges[t * 6 + axis] = clamp(
          Math.floor((Math.min(x, y, z) - min[axis]!) / h),
          0,
          dimensions[axis]! - 1,
        );
        ranges[t * 6 + axis + 3] = clamp(
          Math.floor((Math.max(x, y, z) - min[axis]!) / h),
          0,
          dimensions[axis]! - 1,
        );
      }
      refs +=
        (ranges[t * 6 + 3]! - ranges[t * 6]! + 1) *
        (ranges[t * 6 + 4]! - ranges[t * 6 + 1]! + 1) *
        (ranges[t * 6 + 5]! - ranges[t * 6 + 2]! + 1);
      if (refs > maxReferences) break;
      for (let z = ranges[t * 6 + 2]!; z <= ranges[t * 6 + 5]!; z++)
        for (let y = ranges[t * 6 + 1]!; y <= ranges[t * 6 + 4]!; y++)
          for (let x = ranges[t * 6]!; x <= ranges[t * 6 + 3]!; x++) {
            const index = x + dimensions[0] * (y + dimensions[1] * z);
            counts[index] = counts[index]! + 1;
          }
    }
    if (refs > maxReferences) continue;
    const start = new Uint32Array(cells + 1);
    for (let i = 0; i < cells; i++) start[i + 1] = start[i]! + counts[i]!;
    const cursor = start.slice(0, cells),
      triangles = new Uint32Array(refs);
    for (let t = 0; t < total; t++)
      for (let z = ranges[t * 6 + 2]!; z <= ranges[t * 6 + 5]!; z++)
        for (let y = ranges[t * 6 + 1]!; y <= ranges[t * 6 + 4]!; y++)
          for (let x = ranges[t * 6]!; x <= ranges[t * 6 + 3]!; x++) {
            const cell = x + dimensions[0] * (y + dimensions[1] * z);
            triangles[cursor[cell]!] = t;
            cursor[cell] = cursor[cell]! + 1;
          }
    return {
      min,
      max,
      cellSize: h,
      dimensions,
      start,
      triangles,
      mailbox: new Int32Array(total),
      rayId: 0,
      mesh,
    };
  }
  throw new CheckFailure("too-large", "This mesh is too dense to check.");
};
const intersection = (mesh: IndexedMesh, t: number, o: Vec3, d: Vec3): number | null => {
  const a = vertex(mesh, mesh.triangles[t * 3]!),
    b = vertex(mesh, mesh.triangles[t * 3 + 1]!),
    c = vertex(mesh, mesh.triangles[t * 3 + 2]!);
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2],
    vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  const px = d[1] * vz - d[2] * vy,
    py = d[2] * vx - d[0] * vz,
    pz = d[0] * vy - d[1] * vx,
    det = ux * px + uy * py + uz * pz;
  if (Math.abs(det) < 1e-12) return null;
  const tx = o[0] - a[0],
    ty = o[1] - a[1],
    tz = o[2] - a[2],
    u = (tx * px + ty * py + tz * pz) / det;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const qx = ty * uz - tz * uy,
    qy = tz * ux - tx * uz,
    qz = tx * uy - ty * ux,
    v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const distance = (vx * qx + vy * qy + vz * qz) / det;
  return distance > 1e-8 ? distance : null;
};
/** A mailbox tests large triangles once even when they span many visited cells. */
export const raycast = (
  grid: Grid,
  origin: Vec3,
  direction: Vec3,
  length: number,
  skip = -1,
  options: { accept?: (triangle: number) => boolean; tested?: (triangle: number) => void } = {},
): RayHit | null => {
  let enter = 0,
    exit = length;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]!) < 1e-15) {
      if (origin[axis]! < grid.min[axis]! || origin[axis]! > grid.max[axis]!) return null;
      continue;
    }
    const a = (grid.min[axis]! - origin[axis]!) / direction[axis]!,
      b = (grid.max[axis]! - origin[axis]!) / direction[axis]!;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  if (exit < enter) return null;
  const point: Vec3 = [
      origin[0] + direction[0] * (enter + 1e-9),
      origin[1] + direction[1] * (enter + 1e-9),
      origin[2] + direction[2] * (enter + 1e-9),
    ],
    cell = [0, 0, 0],
    step = [0, 0, 0],
    next = [0, 0, 0],
    delta = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    cell[axis] = clamp(
      Math.floor((point[axis]! - grid.min[axis]!) / grid.cellSize),
      0,
      grid.dimensions[axis]! - 1,
    );
    step[axis] = Math.sign(direction[axis]!);
    next[axis] =
      step[axis] === 0
        ? Infinity
        : (grid.min[axis]! +
            (cell[axis]! + (step[axis]! > 0 ? 1 : 0)) * grid.cellSize -
            origin[axis]!) /
          direction[axis]!;
    delta[axis] = step[axis] === 0 ? Infinity : grid.cellSize / Math.abs(direction[axis]!);
  }
  if (++grid.rayId >= 2 ** 31 - 1) {
    grid.mailbox.fill(0);
    grid.rayId = 1;
  }
  let best = length,
    hit = -1;
  while (cell.every((value, axis) => value >= 0 && value < grid.dimensions[axis]!)) {
    const index = cell[0]! + grid.dimensions[0] * (cell[1]! + grid.dimensions[1] * cell[2]!);
    for (let i = grid.start[index]!; i < grid.start[index + 1]!; i++) {
      const t = grid.triangles[i]!;
      if (t === skip || grid.mailbox[t] === grid.rayId) continue;
      grid.mailbox[t] = grid.rayId;
      if (options.accept && !options.accept(t)) continue;
      options.tested?.(t);
      const distance = intersection(grid.mesh, t, origin, direction);
      if (distance !== null && distance <= best) {
        best = distance;
        hit = t;
      }
    }
    const axis = next[0]! <= next[1]! && next[0]! <= next[2]! ? 0 : next[1]! <= next[2]! ? 1 : 2;
    if (next[axis]! >= best || next[axis]! > exit) break;
    cell[axis] = cell[axis]! + step[axis]!;
    next[axis] = next[axis]! + delta[axis]!;
  }
  return hit < 0
    ? null
    : {
        triangle: hit,
        distance: best,
        point: [
          origin[0] + direction[0] * best,
          origin[1] + direction[1] * best,
          origin[2] + direction[2] * best,
        ],
      };
};
