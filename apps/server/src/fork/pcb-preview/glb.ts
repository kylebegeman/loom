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
