import type { BufferGeometry } from "three";
export type Welded = { positions: Float32Array; corners: Uint32Array };
const cached = new WeakMap<BufferGeometry, Welded>();
/** Preserves triangle order so raycast face indices address the welded triangles. */
export function weld(geometry: BufferGeometry): Welded {
  const prior = cached.get(geometry);
  if (prior) return prior;
  const attribute = geometry.getAttribute("position");
  const positions = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    positions[i * 3] = attribute.getX(i);
    positions[i * 3 + 1] = attribute.getY(i);
    positions[i * 3 + 2] = attribute.getZ(i);
  }
  const index = geometry.index ? Uint32Array.from(geometry.index.array) : null;
  const result = weldPositions(positions, index);
  cached.set(geometry, result);
  return result;
}
/** Grid hashing avoids per-corner objects even for non-indexed STL meshes. */
export function weldPositions(source: Float32Array, index: Uint32Array | null): Welded {
  if (source.length % 3 || (index?.length ?? source.length / 3) % 3)
    throw new Error("Invalid triangle geometry");
  const count = source.length / 3;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < source.length; i += 3) {
    const x = source[i]!,
      y = source[i + 1]!,
      z = source[i + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
      throw new Error("Non-finite triangle geometry");
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const grid = Math.max(1e-6, 1e-5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
  let capacity = 2;
  while (capacity < count * 2) capacity *= 2;
  const table = new Int32Array(capacity).fill(-1),
    unique = new Float32Array(source.length),
    ids = new Uint32Array(count);
  const qx = new Int32Array(count),
    qy = new Int32Array(count),
    qz = new Int32Array(count);
  let vertices = 0;
  for (let i = 0; i < count; i++) {
    const x = Math.round((source[i * 3]! - minX) / grid),
      y = Math.round((source[i * 3 + 1]! - minY) / grid),
      z = Math.round((source[i * 3 + 2]! - minZ) / grid);
    let slot =
      (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (capacity - 1);
    while (
      table[slot] !== -1 &&
      (qx[table[slot]!] !== x || qy[table[slot]!] !== y || qz[table[slot]!] !== z)
    )
      slot = (slot + 1) & (capacity - 1);
    let id = table[slot]!;
    if (id === -1) {
      id = vertices++;
      table[slot] = id;
      qx[id] = x;
      qy[id] = y;
      qz[id] = z;
      unique.set(source.subarray(i * 3, i * 3 + 3), id * 3);
    }
    ids[i] = id;
  }
  const corners = new Uint32Array(index?.length ?? count);
  for (let i = 0; i < corners.length; i++) {
    const original = index?.[i] ?? i;
    if (original >= count) throw new Error("Triangle index outside vertex buffer");
    corners[i] = ids[original]!;
  }
  return { positions: unique.slice(0, vertices * 3), corners };
}
