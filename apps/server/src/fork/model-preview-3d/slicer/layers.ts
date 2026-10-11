import { SLICE_ROLES, type SliceRole } from "@t3tools/contracts/fork";
export const LAYER_SEGMENT_LIMIT = 1000000;
export type LayerInfo = { z: number; height: number; first: number };
export type LayerSegments = {
  readonly data: Uint8Array;
  readonly layerCount: number;
  readonly segmentCount: number;
  readonly decimated: boolean;
};
/** Progressive thinning keeps memory fixed and retains a sample throughout every print. */
export const createLayerBuffer = (limit = LAYER_SEGMENT_LIMIT) => {
  if (!Number.isSafeInteger(limit) || limit < 2 || limit > LAYER_SEGMENT_LIMIT)
    throw new RangeError("Layer segment limit must be between 2 and 1000000.");
  const coordinates = new Float32Array(limit * 4),
    roles = new Uint8Array(limit),
    indices = new Uint32Array(limit);
  const layers: LayerInfo[] = [];
  let count = 0,
    seen = 0,
    interval = 1;
  return {
    reset(): void {
      count = seen = 0;
      interval = 1;
      layers.length = 0;
    },
    layer(z: number, height: number): number {
      layers.push({ z, height, first: count });
      return layers.length - 1;
    },
    updateLayer(index: number, z: number, height: number): void {
      const layer = layers[index];
      if (layer) {
        layer.z = z;
        layer.height = height;
      }
    },
    add(layer: number, x0: number, y0: number, x1: number, y1: number, role: SliceRole): void {
      if (seen++ % interval) return;
      if (count === limit) {
        for (let source = 0, target = 0; source < count; source += 2, target++) {
          coordinates.copyWithin(target * 4, source * 4, source * 4 + 4);
          roles[target] = roles[source]!;
          indices[target] = indices[source]!;
        }
        count = Math.ceil(count / 2);
        interval *= 2;
      }
      coordinates.set([x0, y0, x1, y1], count * 4);
      roles[count] = SLICE_ROLES.indexOf(role);
      indices[count] = layer;
      count++;
    },
    finish(): LayerSegments {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let segment = 0; segment < count; segment++)
        for (const end of [0, 2]) {
          const x = coordinates[segment * 4 + end]!,
            y = coordinates[segment * 4 + end + 1]!;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      if (!count) minX = minY = maxX = maxY = 0;
      const step = Math.max(
        0.01,
        Math.ceil(Math.max(maxX - minX, maxY - minY) / 65535 / 0.01) * 0.01,
      );
      const data = new Uint8Array(24 + layers.length * 12 + count * 9),
        view = new DataView(data.buffer);
      data.set(new TextEncoder().encode("LLY1"));
      view.setUint32(4, layers.length, true);
      view.setUint32(8, count, true);
      view.setFloat32(12, minX, true);
      view.setFloat32(16, minY, true);
      view.setFloat32(20, step, true);
      let cursor = 0;
      layers.forEach((layer, index) => {
        while (cursor < count && indices[cursor]! < index) cursor++;
        view.setFloat32(24 + index * 12, layer.z, true);
        view.setFloat32(28 + index * 12, layer.height, true);
        view.setUint32(32 + index * 12, cursor, true);
      });
      const start = 24 + layers.length * 12;
      for (let index = 0; index < count; index++)
        for (let component = 0; component < 4; component++)
          view.setUint16(
            start + index * 8 + component * 2,
            Math.round(
              (coordinates[index * 4 + component]! - (component % 2 ? minY : minX)) / step,
            ),
            true,
          );
      data.set(roles.subarray(0, count), start + count * 8);
      return { data, layerCount: layers.length, segmentCount: count, decimated: interval > 1 };
    },
  };
};
