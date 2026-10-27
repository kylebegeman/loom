import {
  normalizeQuaternion,
  quaternionMatrix,
  type ModelPoint,
  type ModelQuaternion,
} from "@t3tools/contracts/fork";
import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix3,
  Matrix4,
  Mesh,
  Quaternion,
  Triangle,
  Vector3,
  type Object3D,
} from "three";
import { ConvexHull, type Face } from "three/addons/math/ConvexHull.js";
import { weld, type Welded } from "./weld";

const FLAT_TOLERANCE_DEGREES = 2;
const HULL_GROUP_DEGREES = 1;
const FLOATING_FACE_MM = 0.1;
const DOWN = new Vector3(0, 0, -1);
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const asTuple = (q: Quaternion): ModelQuaternion => normalizeQuaternion([q.x, q.y, q.z, q.w]);

/** Converts a world-space face normal to an absolute rotation of the model. */
export function restingQuaternion(normalWorld: Vector3, current: ModelQuaternion | null) {
  const delta = normalWorld.lengthSq()
    ? new Quaternion().setFromUnitVectors(normalWorld.clone().normalize(), DOWN)
    : new Quaternion();
  return asTuple(delta.multiply(new Quaternion(...normalizeQuaternion(current ?? [0, 0, 0, 1]))));
}

export type Adjacency = Welded & {
  neighbors: Int32Array;
  normals: Float64Array;
  areas: Float64Array;
};
const adjacencyCache = new WeakMap<BufferGeometry, Adjacency>();
/** Welded corners retain raycast triangle indices; ambiguous non-manifold edges stay open. */
export function buildAdjacency(geometry: BufferGeometry): Adjacency {
  const cached = adjacencyCache.get(geometry);
  if (cached) return cached;
  const welded = weld(geometry);
  const { positions, corners } = welded;
  const count = Math.floor(corners.length / 3);
  const neighbors = new Int32Array(count * 3).fill(-1);
  const normals = new Float64Array(count * 3);
  const areas = new Float64Array(count);
  const keys = new Float64Array(corners.length);
  const order = new Uint32Array(corners.length);
  const vertices = positions.length / 3;
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    normal = new Vector3();
  for (let face = 0; face < count; face++) {
    a.fromArray(positions, corners[face * 3]! * 3);
    b.fromArray(positions, corners[face * 3 + 1]! * 3);
    c.fromArray(positions, corners[face * 3 + 2]! * 3);
    normal.subVectors(b, a).cross(c.sub(a));
    areas[face] = normal.length() / 2;
    normal.normalize().toArray(normals, face * 3);
    for (let side = 0; side < 3; side++) {
      const edge = face * 3 + side;
      const first = corners[edge]!,
        second = corners[face * 3 + ((side + 1) % 3)]!;
      keys[edge] =
        first === second ? -1 : Math.min(first, second) * vertices + Math.max(first, second);
      order[edge] = edge;
    }
  }
  order.sort((first, second) => keys[first]! - keys[second]!);
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (end < order.length && keys[order[end]!] === keys[order[start]!]) end++;
    if (end - start === 2 && keys[order[start]!]! >= 0) {
      const first = order[start]!,
        second = order[start + 1]!;
      const firstFace = Math.floor(first / 3),
        secondFace = Math.floor(second / 3);
      if (firstFace !== secondFace && areas[firstFace]! > 0 && areas[secondFace]! > 0) {
        neighbors[first] = secondFace;
        neighbors[second] = firstFace;
      }
    }
    start = end;
  }
  const result = { ...welded, neighbors, normals, areas };
  adjacencyCache.set(geometry, result);
  return result;
}

export type CoplanarRegion = { triangles: Uint32Array; normal: Vector3; areaMm2: number };
/** Compare every face with the seed so a curved surface cannot gradually flood around the part. */
export function coplanarRegion(
  _geometry: BufferGeometry,
  adjacency: Adjacency,
  seed: number,
  toleranceDegrees = FLAT_TOLERANCE_DEGREES,
): CoplanarRegion | null {
  const { areas, normals, neighbors } = adjacency;
  if (!Number.isInteger(seed) || seed < 0 || seed >= areas.length || !areas[seed]) return null;
  const seedNormal = new Vector3().fromArray(normals, seed * 3);
  const threshold = Math.cos(radians(toleranceDegrees));
  const visited = new Uint8Array(areas.length);
  const queue = [seed],
    normal = new Vector3(),
    faceNormal = new Vector3();
  visited[seed] = 1;
  let areaMm2 = 0;
  for (let next = 0; next < queue.length; next++) {
    const face = queue[next]!;
    const area = areas[face]!;
    normal.addScaledVector(faceNormal.fromArray(normals, face * 3), area);
    areaMm2 += area;
    for (let side = 0; side < 3; side++) {
      const neighbor = neighbors[face * 3 + side]!;
      if (neighbor < 0 || visited[neighbor]) continue;
      visited[neighbor] = 1;
      if (
        areas[neighbor]! > 0 &&
        seedNormal.dot(faceNormal.fromArray(normals, neighbor * 3)) >= threshold
      )
        queue.push(neighbor);
    }
  }
  return { triangles: Uint32Array.from(queue), normal: normal.normalize(), areaMm2 };
}

/** The largest convex-hull side is stable; equal-area sides prefer a smaller print height. */
export function hullRestingNormal(points: readonly Vector3[]): Vector3 | null {
  if (points.length < 4) return null;
  const hull = new ConvexHull().setFromPoints([...points]);
  const groups: { seed: Vector3; normal: Vector3; area: number }[] = [];
  const threshold = Math.cos(radians(HULL_GROUP_DEGREES));
  const assigned = new Set<Face>();
  for (const face of hull.faces) {
    if (!(face.area > 0) || assigned.has(face)) continue;
    const seed = face.normal.clone(),
      normal = new Vector3(),
      queue = [face];
    assigned.add(face);
    let area = 0;
    for (let next = 0; next < queue.length; next++) {
      const member = queue[next]!;
      normal.addScaledVector(member.normal, member.area);
      area += member.area;
      let edge = member.edge;
      do {
        const neighbor = edge.twin.face;
        if (!assigned.has(neighbor) && seed.dot(neighbor.normal) >= threshold) {
          assigned.add(neighbor);
          queue.push(neighbor);
        }
        edge = edge.next;
      } while (edge !== member.edge);
    }
    groups.push({ seed, normal, area });
  }
  const largest = groups.reduce((maximum, group) => Math.max(maximum, group.area), 0);
  const epsilon = Math.max(1, largest) * 1e-8;
  let selected: Vector3 | null = null,
    lowestHeight = Infinity;
  const point = new Vector3();
  for (const group of groups) {
    if (largest - group.area > epsilon) continue;
    const normal = group.normal.normalize();
    const q = new Quaternion(...restingQuaternion(normal, null));
    let min = Infinity,
      max = -Infinity;
    for (const vertex of points) {
      const z = point.copy(vertex).applyQuaternion(q).z;
      min = Math.min(min, z);
      max = Math.max(max, z);
    }
    const height = max - min;
    if (height < lowestHeight - 1e-8) {
      selected = normal.clone();
      lowestHeight = height;
    }
  }
  return selected;
}

/** OpenSCAD rotate([x,y,z]) is Rz * Ry * Rx, which three calls Euler order ZYX. */
export function bakeRotation(q: ModelQuaternion, partCentre: Vector3, orientedMinZ: number) {
  const quaternion = new Quaternion(...normalizeQuaternion(q));
  const euler = new Euler().setFromQuaternion(quaternion, "ZYX");
  const angles: [number, number, number] = [euler.x, euler.y, euler.z].map(
    (value) => (value * 180) / Math.PI,
  ) as [number, number, number];
  const rotation = quaternionMatrix(q);
  const matrix = rotation.map((row) => [...row, 0]);
  matrix.push([0, 0, 0, 1]);
  const rootPosition = partCentre.clone().sub(partCentre.clone().applyQuaternion(quaternion));
  return { angles, matrix, dz: -(orientedMinZ - rootPosition.z) };
}

/** Distances remain model-space lengths; these deltas describe print-bed axes. */
export function bedDelta(
  start: ModelPoint,
  end: ModelPoint,
  q: ModelQuaternion | null,
): ModelPoint {
  const delta = new Vector3(...end).sub(new Vector3(...start));
  if (q) delta.applyQuaternion(new Quaternion(...normalizeQuaternion(q)));
  return [delta.x, delta.y, delta.z];
}

export type FaceRegion = CoplanarRegion & {
  mesh: Mesh;
  faceIndex: number;
  instanceId: number | undefined;
  matrix: Matrix4;
};
export type FaceOrientation = { quaternion: ModelQuaternion; areaMm2: number; floats: boolean };
type MeshPart = {
  mesh: Mesh;
  instanceId: number | undefined;
  matrix: Matrix4;
  regions: Map<number, FaceRegion>;
};
/** One index per loaded model. Geometry adjacency is lazy and shared with raycast triangle order. */
export function createOrientationIndex(model: Object3D, root: Object3D) {
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const parts: MeshPart[] = [];
  model.traverse((object) => {
    if (!(object instanceof Mesh) || !object.geometry.getAttribute("position")) return;
    const matrix = inverseRoot.clone().multiply(object.matrixWorld);
    if (object instanceof InstancedMesh) {
      for (let instanceId = 0; instanceId < object.count; instanceId++) {
        const instance = new Matrix4();
        object.getMatrixAt(instanceId, instance);
        parts.push({
          mesh: object,
          instanceId,
          matrix: matrix.clone().multiply(instance),
          regions: new Map(),
        });
      }
    } else parts.push({ mesh: object, instanceId: undefined, matrix, regions: new Map() });
  });
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  const readTriangle = (part: MeshPart, face: number, triangle: Triangle) => {
    const { corners, positions } = weld(part.mesh.geometry);
    triangle.a.fromArray(positions, corners[face * 3]! * 3).applyMatrix4(part.matrix);
    triangle.b.fromArray(positions, corners[face * 3 + 1]! * 3).applyMatrix4(part.matrix);
    triangle.c.fromArray(positions, corners[face * 3 + 2]! * 3).applyMatrix4(part.matrix);
    return triangle;
  };
  let points: Vector3[] | null = null;
  const modelPoints = () => {
    if (points) return points;
    points = [];
    for (const part of parts) {
      const { positions } = weld(part.mesh.geometry);
      for (let vertex = 0; vertex < positions.length; vertex += 3)
        points.push(new Vector3().fromArray(positions, vertex).applyMatrix4(part.matrix));
    }
    return points;
  };
  const regionAt = (mesh: Mesh, faceIndex: number, instanceId?: number): FaceRegion | null => {
    const part = parts.find((part) => part.mesh === mesh && part.instanceId === instanceId);
    if (!part) return null;
    const prior = part.regions.get(faceIndex);
    if (prior) return prior;
    const region = coplanarRegion(mesh.geometry, buildAdjacency(mesh.geometry), faceIndex);
    if (!region) return null;
    const normal = region.normal
      .clone()
      .applyNormalMatrix(new Matrix3().getNormalMatrix(part.matrix));
    const triangle = new Triangle();
    let areaMm2 = 0;
    for (const face of region.triangles) areaMm2 += readTriangle(part, face, triangle).getArea();
    const result = { ...region, mesh, faceIndex, instanceId, matrix: part.matrix, normal, areaMm2 };
    for (const face of region.triangles) part.regions.set(face, result);
    return result;
  };
  const atPoint = (point: ModelPoint): FaceRegion | null => {
    const position = new Vector3(...point),
      nearest = new Vector3(),
      triangle = new Triangle();
    let bestPart: MeshPart | null = null,
      bestFace = -1,
      distance = Infinity;
    for (const part of parts) {
      const count = weld(part.mesh.geometry).corners.length / 3;
      for (let face = 0; face < count; face++) {
        const d = readTriangle(part, face, triangle)
          .closestPointToPoint(position, nearest)
          .distanceToSquared(position);
        if (d < distance) {
          distance = d;
          bestPart = part;
          bestFace = face;
        }
      }
    }
    // Editor face points must actually touch a surface, rather than rotating to an arbitrary remote face.
    return bestPart && distance <= 0.01 ** 2
      ? regionAt(bestPart.mesh, bestFace, bestPart.instanceId)
      : null;
  };
  const orientationFor = (region: FaceRegion, current: ModelQuaternion | null): FaceOrientation => {
    const currentQ = new Quaternion(...normalizeQuaternion(current ?? [0, 0, 0, 1]));
    const quaternion = restingQuaternion(region.normal.clone().applyQuaternion(currentQ), current);
    const rotated = new Quaternion(...quaternion);
    let minPart = Infinity,
      minRegion = Infinity;
    for (const point of modelPoints())
      minPart = Math.min(minPart, a.copy(point).applyQuaternion(rotated).z);
    const { positions, corners } = weld(region.mesh.geometry);
    for (const face of region.triangles)
      for (let corner = 0; corner < 3; corner++) {
        b.fromArray(positions, corners[face * 3 + corner]! * 3)
          .applyMatrix4(region.matrix)
          .applyQuaternion(rotated);
        minRegion = Math.min(minRegion, b.z);
      }
    return { quaternion, areaMm2: region.areaMm2, floats: minRegion - minPart > FLOATING_FACE_MM };
  };
  const auto = () => {
    const normal = hullRestingNormal(modelPoints());
    return normal ? restingQuaternion(normal, null) : null;
  };
  const highlightGeometry = (region: FaceRegion) => {
    const { positions, corners } = weld(region.mesh.geometry);
    const vertices = new Float32Array(region.triangles.length * 9);
    for (const [index, face] of region.triangles.entries())
      for (let corner = 0; corner < 3; corner++)
        c.fromArray(positions, corners[face * 3 + corner]! * 3)
          .applyMatrix4(region.matrix)
          .toArray(vertices, index * 9 + corner * 3);
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(vertices, 3));
  };
  return { regionAt, atPoint, orientationFor, auto, highlightGeometry };
}
