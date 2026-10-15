import { InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from "three";
import SnapWorker from "./snapTopology.worker?worker";
import { buildTopology, SNAP_TRIANGLE_LIMIT, type Topology } from "./snap";
/** Copies current world-space geometry. Instance triangles follow source order per instance. */
export function meshPositions(mesh: Mesh): Float32Array {
  const geometry = mesh.geometry,
    count = Math.floor((geometry.index?.count ?? geometry.getAttribute("position").count) / 3) * 3,
    instances = mesh instanceof InstancedMesh ? mesh.count : 1;
  const positions = new Float32Array(count * instances * 3),
    vertex = new Vector3(),
    instance = new Matrix4(),
    world = new Matrix4();
  for (let i = 0; i < instances; i++) {
    world.copy(mesh.matrixWorld);
    if (mesh instanceof InstancedMesh) {
      mesh.getMatrixAt(i, instance);
      world.multiply(instance);
    }
    for (let j = 0; j < count; j++) {
      mesh.getVertexPosition(geometry.index?.getX(j) ?? j, vertex);
      vertex.applyMatrix4(world).toArray(positions, (i * count + j) * 3);
    }
  }
  return positions;
}
/**
 * A detached model's triangles as one soup in its own frame, which is the viewer's model space
 * once the model sits under the orientation root.
 */
export function modelPositions(model: Object3D): Float32Array {
  model.updateMatrixWorld(true);
  const parts: Float32Array[] = [];
  model.traverse((object) => {
    if (object instanceof Mesh) parts.push(meshPositions(object));
  });
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
/** One lazy worker for the whole model, always terminated on completion or cancellation. */
export async function buildTopologies(
  meshes: readonly Mesh[],
  signal: AbortSignal,
): Promise<Map<Mesh, Topology>> {
  const triangles = meshes.reduce(
    (sum, mesh) =>
      sum +
      Math.floor((mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3) *
        (mesh instanceof InstancedMesh ? mesh.count : 1),
    0,
  );
  if (triangles > SNAP_TRIANGLE_LIMIT) throw new Error("Model exceeds the snapping triangle limit");
  const result = new Map<Mesh, Topology>();
  const worker = typeof Worker === "undefined" ? null : new SnapWorker();
  try {
    for (const [id, mesh] of meshes.entries()) {
      signal.throwIfAborted();
      const positions = meshPositions(mesh);
      const topology = worker
        ? await new Promise<Topology>((resolve, reject) => {
            const abort = () => {
              cleanup();
              reject(new DOMException("Snapping cancelled", "AbortError"));
            };
            const cleanup = () => {
              signal.removeEventListener("abort", abort);
              worker.removeEventListener("message", message);
              worker.removeEventListener("error", error);
            };
            const message = (
              event: MessageEvent<{ id: number; topology?: Topology; error?: string }>,
            ) => {
              if (event.data.id !== id) return;
              cleanup();
              if (event.data.topology) resolve(event.data.topology);
              else reject(new Error(event.data.error ?? "Snapping index failed"));
            };
            const error = (event: ErrorEvent) => {
              cleanup();
              reject(new Error(event.message || "Snapping worker failed"));
            };
            worker.addEventListener("message", message);
            worker.addEventListener("error", error);
            signal.addEventListener("abort", abort, { once: true });
            worker.postMessage({ id, positions, index: null }, [positions.buffer]);
          })
        : buildTopology(positions, null);
      signal.throwIfAborted();
      result.set(mesh, topology);
    }
    return result;
  } finally {
    worker?.terminate();
  }
}
