const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** circuit-json-to-gltf uses millimetres in its Y-up world frame. Wrap each scene
 * at the adapter boundary so GLB consumers, including L23, receive standard metres.
 * Mesh buffers, material data and component-local transforms remain unchanged. */
export function normalizeCircuitGlb(bytes: Uint8Array): Uint8Array {
  const invalid = () => new Error("The circuit exporter produced an invalid GLB board.");
  if (bytes.length < 20) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== GLB_MAGIC ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== JSON_CHUNK
  )
    throw invalid();
  const jsonLength = view.getUint32(12, true);
  const restStart = 20 + jsonLength;
  if (jsonLength % 4 !== 0 || restStart > bytes.length) throw invalid();
  for (let offset = restStart; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw invalid();
    const length = view.getUint32(offset, true);
    if (length % 4 !== 0 || offset + 8 + length > bytes.length) throw invalid();
    offset += 8 + length;
  }
  const document: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, restStart)),
  );
  if (
    !object(document) ||
    !Array.isArray(document.nodes) ||
    !Array.isArray(document.scenes) ||
    !document.scenes.length
  )
    throw invalid();
  const nodeCount = document.nodes.length;
  const nodes: unknown[] = [...document.nodes];
  const scenes = document.scenes.map((scene: unknown) => {
    if (
      !object(scene) ||
      !Array.isArray(scene.nodes) ||
      !scene.nodes.every(
        (node: unknown) =>
          typeof node === "number" && Number.isInteger(node) && node >= 0 && node < nodeCount,
      )
    )
      throw invalid();
    const root = nodes.length;
    nodes.push({
      name: "Loom millimetres to metres",
      children: scene.nodes,
      scale: [0.001, 0.001, 0.001],
    });
    return { ...scene, nodes: [root] };
  });
  const json = new TextEncoder().encode(JSON.stringify({ ...document, scenes, nodes }));
  const padded = Math.ceil(json.length / 4) * 4;
  const output = new Uint8Array(20 + padded + bytes.length - restStart);
  const header = new DataView(output.buffer);
  header.setUint32(0, GLB_MAGIC, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, output.length, true);
  header.setUint32(12, padded, true);
  header.setUint32(16, JSON_CHUNK, true);
  output.fill(32, 20, 20 + padded);
  output.set(json, 20);
  output.set(bytes.subarray(restStart), 20 + padded);
  return output;
}

export type Vec3 = readonly [number, number, number];
export type GlbMesh = {
  name: string | null;
  nodes: readonly string[];
  materials: readonly string[];
  min: Vec3;
  max: Vec3;
};
export type GlbBounds = { meshes: GlbMesh[] };
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const numbers = (value: unknown, size: number): value is number[] =>
  Array.isArray(value) && value.length === size && value.every(finite);
const invalidBounds = () => new Error("The cached 3D board has invalid mesh bounds or transforms.");
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: readonly number[], b: readonly number[]) {
  const result = Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 4; i++) result[column * 4 + row]! += a[i * 4 + row]! * b[column * 4 + i]!;
    }
  return result;
}
function nodeMatrix(node: Record<string, unknown>) {
  if (node.matrix !== undefined) {
    if (!numbers(node.matrix, 16)) throw invalidBounds();
    return node.matrix;
  }
  const translation = node.translation ?? [0, 0, 0],
    scale = node.scale ?? [1, 1, 1];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  if (!numbers(translation, 3) || !numbers(scale, 3) || !numbers(rotation, 4))
    throw invalidBounds();
  const [x, y, z, w] = rotation as [number, number, number, number];
  if (Math.abs(Math.hypot(x, y, z, w) - 1) > 0.001) throw invalidBounds();
  return [
    (1 - 2 * (y * y + z * z)) * scale[0]!,
    2 * (x * y + z * w) * scale[0]!,
    2 * (x * z - y * w) * scale[0]!,
    0,
    2 * (x * y - z * w) * scale[1]!,
    (1 - 2 * (x * x + z * z)) * scale[1]!,
    2 * (y * z + x * w) * scale[1]!,
    0,
    2 * (x * z + y * w) * scale[2]!,
    2 * (y * z - x * w) * scale[2]!,
    (1 - 2 * (x * x + y * y)) * scale[2]!,
    0,
    translation[0]!,
    translation[1]!,
    translation[2]!,
    1,
  ];
}
/** Read the JSON chunk without touching the mesh buffers; also accepts a UTF-8 .gltf document. */
export function readGlbJson(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint32(0, true) !== GLB_MAGIC) {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  if (
    bytes.length < 20 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== JSON_CHUNK
  )
    throw invalidBounds();
  const length = view.getUint32(12, true);
  if (length % 4 !== 0 || length > 16 * 1024 * 1024 || length + 20 > bytes.length)
    throw invalidBounds();
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + length)),
  );
}
/** World-space boxes from POSITION accessor bounds, with names retained for PCB classification. */
export function readGlbBounds(json: unknown): GlbBounds {
  if (
    !object(json) ||
    !Array.isArray(json.nodes) ||
    !Array.isArray(json.meshes) ||
    !Array.isArray(json.accessors)
  )
    throw invalidBounds();
  const nodes: unknown[] = json.nodes,
    meshData: unknown[] = json.meshes,
    accessors: unknown[] = json.accessors;
  const materials: unknown[] = Array.isArray(json.materials) ? json.materials : [];
  const index = (value: unknown, rows: unknown[]) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= rows.length)
      throw invalidBounds();
    return value;
  };
  let visited = 0;
  const meshes: GlbMesh[] = [];
  const walk = (
    nodeIndex: number,
    parent: readonly number[],
    ancestors: readonly string[],
    path: ReadonlySet<number>,
  ) => {
    if (path.has(nodeIndex) || path.size >= 256 || ++visited > 100000) throw invalidBounds();
    const node = nodes[nodeIndex];
    if (!object(node)) throw invalidBounds();
    const matrix = multiply(parent, nodeMatrix(node));
    const names =
      typeof node.name === "string" && node.name ? [...ancestors, node.name] : ancestors;
    if (node.mesh !== undefined) {
      const mesh = meshData[index(node.mesh, meshData)];
      if (!object(mesh) || !Array.isArray(mesh.primitives)) throw invalidBounds();
      const min: [number, number, number] = [Infinity, Infinity, Infinity];
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      const materialNames = new Set<string>();
      for (const primitive of mesh.primitives as unknown[]) {
        if (!object(primitive) || !object(primitive.attributes)) throw invalidBounds();
        const accessor = accessors[index(primitive.attributes.POSITION, accessors)];
        if (!object(accessor) || !numbers(accessor.min, 3) || !numbers(accessor.max, 3))
          throw invalidBounds();
        const localMin = accessor.min,
          localMax = accessor.max;
        if (localMin.some((v, i) => v > localMax[i]!)) throw invalidBounds();
        for (let corner = 0; corner < 8; corner++) {
          const x = (corner & 1 ? accessor.max : accessor.min)[0]!;
          const y = (corner & 2 ? accessor.max : accessor.min)[1]!;
          const z = (corner & 4 ? accessor.max : accessor.min)[2]!;
          for (let axis = 0; axis < 3; axis++) {
            const value =
              matrix[axis]! * x +
              matrix[axis + 4]! * y +
              matrix[axis + 8]! * z +
              matrix[axis + 12]!;
            if (!Number.isFinite(value)) throw invalidBounds();
            min[axis] = Math.min(min[axis]!, value);
            max[axis] = Math.max(max[axis]!, value);
          }
        }
        if (primitive.material !== undefined) {
          const material = materials[index(primitive.material, materials)];
          if (!object(material)) throw invalidBounds();
          if (typeof material.name === "string") materialNames.add(material.name);
        }
      }
      if (Number.isFinite(min[0]))
        meshes.push({
          name: typeof mesh.name === "string" ? mesh.name : null,
          nodes: names,
          materials: [...materialNames],
          min,
          max,
        });
    }
    const nextPath = new Set(path);
    nextPath.add(nodeIndex);
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw invalidBounds();
      for (const next of node.children as unknown[])
        walk(index(next, nodes), matrix, names, nextPath);
    }
  };
  if (Array.isArray(json.scenes) && json.scenes.length) {
    for (const scene of json.scenes as unknown[]) {
      if (!object(scene) || !Array.isArray(scene.nodes)) throw invalidBounds();
      for (const root of scene.nodes as unknown[])
        walk(index(root, nodes), identity(), [], new Set());
    }
  } else {
    const children = new Set<number>();
    for (const node of nodes)
      if (object(node) && Array.isArray(node.children))
        for (const child of node.children as unknown[]) children.add(index(child, nodes));
    for (let i = 0; i < nodes.length; i++) if (!children.has(i)) walk(i, identity(), [], new Set());
    if (nodes.length && !visited) throw invalidBounds();
  }
  return { meshes };
}
