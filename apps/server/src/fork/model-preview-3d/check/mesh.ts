export type Vec3 = readonly [number, number, number];
export type Quaternion = readonly [number, number, number, number];
export type TriangleSoup = Float32Array;
export type IndexedMesh = {
  vertices: Float64Array;
  triangles: Uint32Array;
  normals: Float64Array;
  areas: Float64Array;
  bounds: { min: Vec3; max: Vec3 };
  degenerate: number;
};
export class CheckFailure extends Error {
  readonly reason: "unsupported-format" | "too-large" | "command-failed";
  constructor(reason: "unsupported-format" | "too-large" | "command-failed", message: string) {
    super(message);
    this.reason = reason;
  }
}
export const capTriangles = (count: number, max: number) => {
  if (count > max)
    throw new CheckFailure(
      "too-large",
      `Too many triangles to check (${count.toLocaleString("en-US")}). The limit is ${max.toLocaleString("en-US")}.`,
    );
};
export const rotatePoint = (p: Vec3, q: Quaternion | null): Vec3 => {
  if (!q) return p;
  const [x, y, z, w] = q,
    [a, b, c] = p;
  const tx = 2 * (y * c - z * b),
    ty = 2 * (z * a - x * c),
    tz = 2 * (x * b - y * a);
  return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx];
};
export const inverseQuaternion = (q: Quaternion | null): Quaternion | null =>
  q ? [-q[0], -q[1], -q[2], q[3]] : null;
export const vertex = (mesh: IndexedMesh, i: number): Vec3 => [
  mesh.vertices[i * 3]!,
  mesh.vertices[i * 3 + 1]!,
  mesh.vertices[i * 3 + 2]!,
];
export const center = (mesh: IndexedMesh, t: number): Vec3 => {
  const a = vertex(mesh, mesh.triangles[t * 3]!),
    b = vertex(mesh, mesh.triangles[t * 3 + 1]!),
    c = vertex(mesh, mesh.triangles[t * 3 + 2]!);
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
};
export const normal = (mesh: IndexedMesh, t: number): Vec3 => [
  mesh.normals[t * 3]!,
  mesh.normals[t * 3 + 1]!,
  mesh.normals[t * 3 + 2]!,
];
/** Quantized open-addressing weld avoids a per-vertex object graph on large STL meshes. */
export const weld = (soup: TriangleSoup, orientation: Quaternion | null = null): IndexedMesh => {
  if (soup.length % 9)
    throw new CheckFailure("command-failed", "This mesh has incomplete triangles.");
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < soup.length; i += 3) {
    const p = rotatePoint([soup[i]!, soup[i + 1]!, soup[i + 2]!], orientation);
    for (let k = 0; k < 3; k++) {
      if (!Number.isFinite(p[k]))
        throw new CheckFailure("command-failed", "This mesh contains invalid coordinates.");
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
  }
  if (!soup.length) {
    min.fill(0);
    max.fill(0);
  }
  const eps = Math.max(
    1e-5,
    Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) * 1e-6,
  );
  let capacity = 2;
  while (capacity < (soup.length / 3) * 2) capacity *= 2;
  const slots = new Uint32Array(capacity),
    points = new Float64Array(soup.length),
    all = new Uint32Array(soup.length / 3);
  let count = 0;
  for (let i = 0; i < soup.length; i += 3) {
    const p = rotatePoint([soup[i]!, soup[i + 1]!, soup[i + 2]!], orientation),
      x = Math.round(p[0] / eps),
      y = Math.round(p[1] / eps),
      z = Math.round(p[2] / eps);
    let slot =
      (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (capacity - 1);
    while (slots[slot]) {
      const j = slots[slot]! - 1;
      if (
        Math.round(points[j * 3]! / eps) === x &&
        Math.round(points[j * 3 + 1]! / eps) === y &&
        Math.round(points[j * 3 + 2]! / eps) === z
      )
        break;
      slot = (slot + 1) & (capacity - 1);
    }
    if (!slots[slot]) {
      slots[slot] = ++count;
      points.set(p, (count - 1) * 3);
    }
    all[i / 3] = slots[slot]! - 1;
  }
  const triangles = new Uint32Array(all.length),
    normals = new Float64Array(soup.length / 3),
    areas = new Float64Array(soup.length / 9);
  let trianglesCount = 0,
    degenerate = 0;
  for (let i = 0; i < all.length; i += 3) {
    const a = all[i]!,
      b = all[i + 1]!,
      c = all[i + 2]!,
      ax = points[a * 3]!,
      ay = points[a * 3 + 1]!,
      az = points[a * 3 + 2]!;
    const ux = points[b * 3]! - ax,
      uy = points[b * 3 + 1]! - ay,
      uz = points[b * 3 + 2]! - az,
      vx = points[c * 3]! - ax,
      vy = points[c * 3 + 1]! - ay,
      vz = points[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      len = Math.hypot(nx, ny, nz);
    if (a === b || b === c || c === a || len / 2 < 1e-12) {
      degenerate++;
      continue;
    }
    triangles.set([a, b, c], trianglesCount * 3);
    normals.set([nx / len, ny / len, nz / len], trianglesCount * 3);
    areas[trianglesCount] = len / 2;
    trianglesCount++;
  }
  return {
    vertices: points.slice(0, count * 3),
    triangles: triangles.slice(0, trianglesCount * 3),
    normals: normals.slice(0, trianglesCount * 3),
    areas: areas.slice(0, trianglesCount),
    bounds: { min: min as unknown as Vec3, max: max as unknown as Vec3 },
    degenerate,
  };
};
export const unionFind = (size: number) => {
  const parent = Uint32Array.from({ length: size }, (_, i) => i);
  const find = (value: number): number => {
    let i = value;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const join = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  return { find, join };
};
