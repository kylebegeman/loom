import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from "three";
import { SLICE_ROLES } from "@t3tools/contracts/fork";
export type LayerData = {
  readonly layers: readonly { z: number; height: number; first: number }[];
  readonly segmentCount: number;
  readonly positions: Float32Array;
  readonly roles: Uint8Array;
};
export const decodeLayers = (bytes: ArrayBuffer): LayerData => {
  const view = new DataView(bytes);
  if (bytes.byteLength < 24 || new TextDecoder().decode(new Uint8Array(bytes, 0, 4)) !== "LLY1")
    throw new Error("This layer file is damaged.");
  const count = view.getUint32(4, true),
    segments = view.getUint32(8, true),
    originX = view.getFloat32(12, true),
    originY = view.getFloat32(16, true),
    step = view.getFloat32(20, true);
  if (
    count > 100000 ||
    segments > 1000000 ||
    bytes.byteLength !== 24 + count * 12 + segments * 9 ||
    ![originX, originY, step].every(Number.isFinite) ||
    step <= 0
  )
    throw new Error("This layer file has invalid bounds.");
  const layers = Array.from({ length: count }, (_, index) => ({
    z: view.getFloat32(24 + index * 12, true),
    height: view.getFloat32(28 + index * 12, true),
    first: view.getUint32(32 + index * 12, true),
  }));
  if ((segments > 0 && count === 0) || (count > 0 && layers[0]?.first !== 0))
    throw new Error("This layer file is damaged.");
  let previous = 0;
  for (const layer of layers) {
    if (
      !Number.isFinite(layer.z) ||
      !Number.isFinite(layer.height) ||
      layer.first < previous ||
      layer.first > segments
    )
      throw new Error("This layer file is damaged.");
    previous = layer.first;
  }
  const positions = new Float32Array(segments * 6),
    roles = new Uint8Array(bytes, 24 + count * 12 + segments * 8, segments).slice();
  for (let index = 0; index < count; index++)
    for (
      let segment = layers[index]!.first;
      segment < (layers[index + 1]?.first ?? segments);
      segment++
    ) {
      const start = 24 + count * 12 + segment * 8;
      positions.set(
        [
          originX + view.getUint16(start, true) * step,
          originY + view.getUint16(start + 2, true) * step,
          layers[index]!.z,
          originX + view.getUint16(start + 4, true) * step,
          originY + view.getUint16(start + 6, true) * step,
          layers[index]!.z,
        ],
        segment * 6,
      );
    }
  if (roles.some((role) => role >= SLICE_ROLES.length))
    throw new Error("This layer file has invalid feature roles.");
  return { layers, segmentCount: segments, positions, roles };
};
export const layerDrawRange = (data: LayerData, index: number): number =>
  data.layers.length
    ? (data.layers[Math.min(data.layers.length - 1, Math.max(0, Math.floor(index))) + 1]?.first ??
        data.segmentCount) * 2
    : 0;
const PALETTE = [
  [0.08, 0.55, 0.94],
  [0.2, 0.69, 0.92],
  [0.7, 0.51, 0.89],
  [0.59, 0.43, 0.8],
  [0.21, 0.74, 0.44],
  [0.33, 0.63, 0.41],
  [0.98, 0.55, 0.13],
  [0.88, 0.38, 0.3],
  [0.96, 0.62, 0.4],
  [0.52, 0.63, 0.68],
  [0.65, 0.65, 0.65],
] as const;
/** One geometry and draw call; moving through layers changes only the draw range. */
export const createLayers = (requestRender: () => void) => {
  const object = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({ vertexColors: true, toneMapped: false }),
  );
  object.visible = false;
  let current: LayerData | null = null;
  return {
    object,
    set(data: LayerData | null): void {
      object.geometry.dispose();
      object.geometry = new BufferGeometry();
      current = data;
      object.visible = data !== null;
      if (data) {
        const colors = new Float32Array(data.segmentCount * 6);
        for (let index = 0; index < data.segmentCount; index++) {
          const color = PALETTE[data.roles[index]!]!;
          colors.set(color, index * 6);
          colors.set(color, index * 6 + 3);
        }
        object.geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
        object.geometry.setAttribute("color", new BufferAttribute(colors, 3));
        object.geometry.computeBoundingBox();
      }
      requestRender();
    },
    showThrough(index: number): void {
      if (current) object.geometry.setDrawRange(0, layerDrawRange(current, index));
      requestRender();
    },
    dispose(): void {
      object.geometry.dispose();
      object.material.dispose();
      current = null;
      object.visible = false;
    },
  };
};
