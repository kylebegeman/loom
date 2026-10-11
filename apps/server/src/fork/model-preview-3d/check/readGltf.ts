import { capTriangles, CheckFailure, type TriangleSoup } from "./mesh.ts";
import type { CheckFile } from "./protocol.ts";

type JsonObject = Readonly<Record<string, unknown>>;
type Matrix = readonly number[];
const fail = (message = "This glTF contains invalid geometry."): never => {
  throw new CheckFailure("command-failed", message);
};
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : fail();
const list = (value: unknown): readonly unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : fail();
const integer = (value: unknown, fallback?: number): number =>
  value === undefined && fallback !== undefined
    ? fallback
    : typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : fail();
const vector = (value: unknown, fallback: readonly number[]): readonly number[] => {
  if (value === undefined) return fallback;
  const values = list(value);
  return values.length === fallback.length &&
    values.every((n) => typeof n === "number" && Number.isFinite(n))
    ? (values as readonly number[])
    : fail();
};
const identity: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const multiply = (a: Matrix, b: Matrix): Matrix =>
  Array.from({ length: 16 }, (_, index) => {
    const row = index % 4,
      column = Math.floor(index / 4);
    let result = 0;
    for (let k = 0; k < 4; k++) result += a[k * 4 + row]! * b[column * 4 + k]!;
    return result;
  });
const nodeMatrix = (node: JsonObject): Matrix => {
  if (node.matrix !== undefined) return vector(node.matrix, identity);
  const [x, y, z, w] = vector(node.rotation, [0, 0, 0, 1]) as readonly [
    number,
    number,
    number,
    number,
  ];
  const [sx, sy, sz] = vector(node.scale, [1, 1, 1]) as readonly [number, number, number];
  const [tx, ty, tz] = vector(node.translation, [0, 0, 0]) as readonly [number, number, number];
  const xx = x * x,
    yy = y * y,
    zz = z * z,
    xy = x * y,
    xz = x * z,
    yz = y * z,
    wx = w * x,
    wy = w * y,
    wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
};
const manifest = (bytes: Uint8Array): { json: JsonObject; binary: Uint8Array | null } => {
  let jsonBytes = bytes,
    binary: Uint8Array | null = null;
  if (
    bytes.length >= 4 &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === 0x46546c67
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      bytes.length < 20 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.length
    )
      fail("This GLB file is damaged.");
    let offset = 12,
      foundJson = false;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) fail("This GLB file is damaged.");
      const length = view.getUint32(offset, true),
        type = view.getUint32(offset + 4, true);
      if (offset + 8 + length > bytes.length || length % 4) fail("This GLB file is damaged.");
      const chunk = bytes.subarray(offset + 8, offset + 8 + length);
      if (type === 0x4e4f534a) {
        if (foundJson || offset !== 12) fail("This GLB file is damaged.");
        jsonBytes = chunk;
        foundJson = true;
      } else if (type === 0x004e4942) {
        if (!foundJson || binary) fail("This GLB file is damaged.");
        binary = chunk;
      }
      offset += 8 + length;
    }
    if (!foundJson) fail("This GLB file is damaged.");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    return fail("This glTF JSON is damaged.");
  }
  const result = object(json);
  if (object(result.asset).version !== "2.0") fail("Print checks require glTF 2.0.");
  return { json: result, binary };
};
const relativeUri = (uri: string): string => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    return fail("This glTF buffer path is invalid.");
  }
  if (
    !decoded ||
    decoded.startsWith("/") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.includes("?") ||
    decoded.includes("#") ||
    decoded.split("/").includes("..") ||
    /^[a-z][a-z0-9+.-]*:/i.test(decoded)
  )
    fail("glTF buffers must be relative files inside the model directory.");
  return decoded;
};
const embedded = (uri: string): Uint8Array => {
  const match = /^data:[^,]*;base64,([\s\S]*)$/i.exec(uri);
  if (!match) return fail("This glTF has an invalid embedded buffer.");
  try {
    return Uint8Array.from(atob(match[1]!), (character) => character.charCodeAt(0));
  } catch {
    return fail("This glTF has an invalid embedded buffer.");
  }
};
const componentBytes: Readonly<Record<number, number>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5124: 4,
  5125: 4,
  5126: 4,
};
const readComponent = (
  view: DataView,
  offset: number,
  component: number,
  normalized: boolean,
): number => {
  let value: number;
  switch (component) {
    case 5120:
      value = view.getInt8(offset);
      break;
    case 5121:
      value = view.getUint8(offset);
      break;
    case 5122:
      value = view.getInt16(offset, true);
      break;
    case 5123:
      value = view.getUint16(offset, true);
      break;
    case 5124:
      value = view.getInt32(offset, true);
      break;
    case 5125:
      value = view.getUint32(offset, true);
      break;
    case 5126:
      value = view.getFloat32(offset, true);
      break;
    default:
      return fail("This glTF uses an unsupported accessor component.");
  }
  if (!Number.isFinite(value)) return fail();
  if (!normalized || component === 5126) return value;
  switch (component) {
    case 5120:
      return Math.max(value / 127, -1);
    case 5121:
      return value / 255;
    case 5122:
      return Math.max(value / 32767, -1);
    case 5123:
      return value / 65535;
    case 5124:
      return Math.max(value / 2147483647, -1);
    case 5125:
      return value / 4294967295;
    default:
      return value;
  }
};

/** Reads the same default scene and Y-up metre frame as the viewer, including node instances. */
export const readGltf = (
  files: readonly CheckFile[],
  limits: { readonly maxTriangles: number },
): TriangleSoup => {
  const main = files[0]?.bytes ?? fail("This glTF file is missing.");
  const { json, binary } = manifest(main);
  const extensions = list(json.extensionsRequired);
  if (extensions.includes("KHR_draco_mesh_compression"))
    throw new CheckFailure(
      "unsupported-format",
      "This glTF uses Draco compression. Export an uncompressed model.",
    );
  if (extensions.includes("EXT_meshopt_compression"))
    throw new CheckFailure(
      "unsupported-format",
      "This glTF uses meshopt compression. Export an uncompressed model.",
    );
  const buffers = list(json.buffers).map((value, index) => {
    const buffer = object(value),
      length = integer(buffer.byteLength);
    let bytes: Uint8Array;
    if (buffer.uri === undefined)
      bytes = index === 0 && binary ? binary : fail("This glTF has a missing buffer.");
    else {
      if (typeof buffer.uri !== "string") return fail();
      const uri = buffer.uri;
      if (uri.startsWith("data:")) bytes = embedded(uri);
      else {
        const decoded = relativeUri(uri);
        bytes =
          files.find((file) => file.name === uri || file.name === decoded)?.bytes ??
          fail("This glTF has a missing buffer.");
      }
    }
    if (bytes.length < length) fail("This glTF has an incomplete buffer.");
    return bytes.subarray(0, length);
  });
  const views = list(json.bufferViews),
    accessors = list(json.accessors),
    nodes = list(json.nodes),
    meshes = list(json.meshes);
  const bufferView = (index: number): { data: DataView; stride: number | undefined } => {
    const entry = object(views[index]);
    const bytes = buffers[integer(entry.buffer)] ?? fail();
    const offset = integer(entry.byteOffset, 0),
      length = integer(entry.byteLength);
    if (offset + length > bytes.length) fail("This glTF accessor exceeds its buffer.");
    return {
      data: new DataView(bytes.buffer, bytes.byteOffset + offset, length),
      stride: entry.byteStride === undefined ? undefined : integer(entry.byteStride),
    };
  };
  const accessor = (
    index: number,
    type: "VEC3" | "SCALAR",
  ): { count: number; get: (index: number, axis?: number) => number } => {
    const entry = object(accessors[index]);
    if (entry.type !== type) fail("This glTF has an incompatible accessor type.");
    const width = type === "VEC3" ? 3 : 1,
      component = integer(entry.componentType),
      size = componentBytes[component] ?? fail();
    const count = integer(entry.count),
      offset = integer(entry.byteOffset, 0),
      normalized = entry.normalized === true;
    let base: (item: number, axis: number) => number = () => 0;
    if (entry.bufferView !== undefined) {
      const { data, stride: specified } = bufferView(integer(entry.bufferView));
      const stride = specified ?? size * width;
      if (
        stride < size * width ||
        offset + (count ? (count - 1) * stride + size * width : 0) > data.byteLength
      )
        fail("This glTF accessor exceeds its buffer.");
      base = (item, axis) =>
        readComponent(data, offset + item * stride + axis * size, component, normalized);
    }
    // Sparse zero-filled accessors may describe many unused vertices. Read only referenced
    // values rather than allocating a second dense copy of the entire source buffer.
    const replacements = new Map<number, number>();
    let sparseValue: (item: number, axis: number) => number = () => 0;
    if (entry.sparse !== undefined) {
      const sparse = object(entry.sparse),
        sparseCount = integer(sparse.count);
      if (sparseCount > count) fail("This glTF sparse accessor is damaged.");
      const indices = object(sparse.indices),
        overrides = object(sparse.values),
        indexComponent = integer(indices.componentType);
      if (![5121, 5123, 5125].includes(indexComponent))
        fail("This glTF sparse accessor is damaged.");
      const indicesView = bufferView(integer(indices.bufferView)).data,
        overrideView = bufferView(integer(overrides.bufferView)).data;
      const indicesOffset = integer(indices.byteOffset, 0),
        overrideOffset = integer(overrides.byteOffset, 0),
        indexSize = componentBytes[indexComponent]!;
      if (
        indicesOffset + sparseCount * indexSize > indicesView.byteLength ||
        overrideOffset + sparseCount * width * size > overrideView.byteLength
      )
        fail("This glTF sparse accessor exceeds its buffer.");
      sparseValue = (item, axis) =>
        readComponent(
          overrideView,
          overrideOffset + (item * width + axis) * size,
          component,
          normalized,
        );
      let previous = -1;
      for (let item = 0; item < sparseCount; item++) {
        const target = readComponent(
          indicesView,
          indicesOffset + item * indexSize,
          indexComponent,
          false,
        );
        if (target >= count || target <= previous) fail("This glTF sparse accessor is damaged.");
        previous = target;
        replacements.set(target, item);
      }
    }
    return {
      count,
      get: (item, axis = 0) => {
        const replacement = replacements.get(item);
        return replacement === undefined ? base(item, axis) : sparseValue(replacement, axis);
      },
    };
  };
  const output: number[] = [];
  const render = (meshIndex: number, matrix: Matrix): void => {
    const mesh = object(meshes[meshIndex]);
    for (const value of list(mesh.primitives)) {
      const primitive = object(value),
        mode = integer(primitive.mode, 4);
      if (![4, 5, 6].includes(mode)) continue;
      const attributes = object(primitive.attributes);
      if (attributes.POSITION === undefined) continue;
      const positionIndex = integer(attributes.POSITION);
      const indexIndex = primitive.indices === undefined ? null : integer(primitive.indices);
      const count = integer(object(accessors[indexIndex ?? positionIndex]).count);
      if (mode === 4 && count % 3) fail("This glTF has incomplete triangles.");
      const triangles = mode === 4 ? count / 3 : Math.max(0, count - 2);
      capTriangles(output.length / 9 + triangles, limits.maxTriangles);
      const positions = accessor(positionIndex, "VEC3");
      const indices = indexIndex === null ? null : accessor(indexIndex, "SCALAR");
      const point = (offset: number): void => {
        const index = indices ? indices.get(offset) : offset;
        if (!Number.isSafeInteger(index) || index < 0 || index >= positions.count)
          fail("This glTF has invalid triangle indices.");
        const x = positions.get(index, 0),
          y = positions.get(index, 1),
          z = positions.get(index, 2);
        const worldX = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
          worldY = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
          worldZ = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
        if (![worldX, worldY, worldZ].every(Number.isFinite)) fail();
        output.push(worldX * 1000, -worldZ * 1000, worldY * 1000);
      };
      for (let triangle = 0; triangle < triangles; triangle++) {
        const offsets =
          mode === 4
            ? [triangle * 3, triangle * 3 + 1, triangle * 3 + 2]
            : mode === 6
              ? [0, triangle + 1, triangle + 2]
              : triangle % 2
                ? [triangle + 1, triangle, triangle + 2]
                : [triangle, triangle + 1, triangle + 2];
        for (const offset of offsets) point(offset);
      }
    }
  };
  const visiting = new Set<number>();
  const walk = (index: number, parent: Matrix, depth: number): void => {
    if (depth > 256 || visiting.has(index))
      fail("This glTF contains cyclic or excessively nested nodes.");
    const node = object(nodes[index]),
      matrix = multiply(parent, nodeMatrix(node));
    visiting.add(index);
    if (node.mesh !== undefined) render(integer(node.mesh), matrix);
    for (const child of list(node.children)) walk(integer(child), matrix, depth + 1);
    visiting.delete(index);
  };
  const scenes = list(json.scenes);
  if (scenes.length)
    for (const node of list(object(scenes[integer(json.scene, 0)]).nodes))
      walk(integer(node), identity, 0);
  return Float32Array.from(output);
};
