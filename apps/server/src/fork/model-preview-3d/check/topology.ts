import { unionFind, vertex, type IndexedMesh, type Vec3 } from "./mesh.ts";
export type EdgeClass = "manifold" | "open" | "flipped" | "non-manifold";
export type Shell = {
  triangles: number[];
  min: Vec3;
  max: Vec3;
  area: number;
  volume: number;
  closed: boolean;
};
export type Topology = {
  keys: Float64Array;
  counts: Uint32Array;
  first: Uint32Array;
  second: Uint32Array;
  directions: Int8Array;
  vertices: number;
  triangleShell: Uint32Array;
  shells: Shell[];
  open: number;
  flipped: number;
  nonManifold: number;
  watertight: boolean;
  volume: number | null;
};
export const edgeClass = (topology: Topology, slot: number): EdgeClass =>
  topology.counts[slot] === 1
    ? "open"
    : topology.counts[slot]! > 2
      ? "non-manifold"
      : topology.directions[slot] === 0
        ? "flipped"
        : "manifold";
/** Numeric edge keys stay exact below 2^53 at the three-million triangle cap. */
export const topologyOf = (mesh: IndexedMesh): Topology => {
  const triangles = mesh.triangles.length / 3,
    vertices = mesh.vertices.length / 3;
  let capacity = 2;
  while (capacity < triangles * 6) capacity *= 2;
  const keys = new Float64Array(capacity);
  keys.fill(-1);
  const counts = new Uint32Array(capacity),
    first = new Uint32Array(capacity),
    second = new Uint32Array(capacity),
    directions = new Int8Array(capacity),
    uf = unionFind(triangles);
  for (let t = 0; t < triangles; t++)
    for (let k = 0; k < 3; k++) {
      const a = mesh.triangles[t * 3 + k]!,
        b = mesh.triangles[t * 3 + ((k + 1) % 3)]!,
        lo = Math.min(a, b),
        hi = Math.max(a, b),
        key = lo * vertices + hi;
      let s = (Math.imul(lo, 73856093) ^ Math.imul(hi, 19349663)) & (capacity - 1);
      while (keys[s] !== -1 && keys[s] !== key) s = (s + 1) & (capacity - 1);
      if (!counts[s]) {
        keys[s] = key;
        first[s] = t;
        directions[s] = a === lo ? 1 : -1;
      } else {
        uf.join(t, first[s]!);
        if (counts[s] === 1) {
          second[s] = t;
          directions[s] = directions[s]! + (a === lo ? 1 : -1) === 0 ? 1 : 0;
        }
      }
      counts[s] = counts[s]! + 1;
    }
  const triangleShell = new Uint32Array(triangles),
    byRoot = new Map<number, number>(),
    shells: Shell[] = [];
  for (let t = 0; t < triangles; t++) {
    const root = uf.find(t);
    let id = byRoot.get(root);
    if (id === undefined) {
      id = shells.length;
      byRoot.set(root, id);
      shells.push({
        triangles: [],
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
        area: 0,
        volume: 0,
        closed: true,
      });
    }
    triangleShell[t] = id;
    const shell = shells[id]!;
    shell.triangles.push(t);
    shell.area += mesh.areas[t]!;
    const ps = [
      vertex(mesh, mesh.triangles[t * 3]!),
      vertex(mesh, mesh.triangles[t * 3 + 1]!),
      vertex(mesh, mesh.triangles[t * 3 + 2]!),
    ];
    const [a, b, c] = ps as [Vec3, Vec3, Vec3];
    shell.volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    shell.min = [
      Math.min(shell.min[0], a[0], b[0], c[0]),
      Math.min(shell.min[1], a[1], b[1], c[1]),
      Math.min(shell.min[2], a[2], b[2], c[2]),
    ];
    shell.max = [
      Math.max(shell.max[0], a[0], b[0], c[0]),
      Math.max(shell.max[1], a[1], b[1], c[1]),
      Math.max(shell.max[2], a[2], b[2], c[2]),
    ];
  }
  const result: Topology = {
    keys,
    counts,
    first,
    second,
    directions,
    vertices,
    triangleShell,
    shells,
    open: 0,
    flipped: 0,
    nonManifold: 0,
    watertight: true,
    volume: null,
  };
  for (let s = 0; s < capacity; s++)
    if (counts[s]) {
      const cls = edgeClass(result, s);
      if (cls !== "manifold") {
        shells[triangleShell[first[s]!]!]!.closed = false;
        if (cls === "open") result.open++;
        else if (cls === "flipped") result.flipped++;
        else result.nonManifold++;
      }
    }
  result.watertight =
    triangles > 0 && result.open === 0 && result.flipped === 0 && result.nonManifold === 0;
  result.volume = result.watertight ? shells.reduce((sum, s) => sum + s.volume, 0) : null;
  return result;
};
