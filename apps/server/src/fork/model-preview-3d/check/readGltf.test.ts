import { expect, it } from "vite-plus/test";
import { readGltf } from "./readGltf.ts";
const limits = { maxTriangles: 10 };
const text = (name: string, source: unknown) => ({
  name,
  bytes: new TextEncoder().encode(JSON.stringify(source)),
});
const dataUri = (bytes: Uint8Array): string =>
  `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}`;
const fixture = (componentType = 5123, mode = 4, uri?: string) => {
  const stride = 16,
    indexWidth = componentType === 5121 ? 1 : componentType === 5123 ? 2 : 4;
  const count = mode === 4 ? 3 : 4;
  const bytes = new Uint8Array(4 + 4 * stride + count * indexWidth),
    data = new DataView(bytes.buffer);
  const vertices = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ];
  vertices.forEach((point, index) =>
    point.forEach((value, axis) => data.setFloat32(4 + index * stride + axis * 4, value, true)),
  );
  for (let index = 0; index < count; index++) {
    const offset = 4 + 4 * stride + index * indexWidth;
    if (componentType === 5121) data.setUint8(offset, index);
    else if (componentType === 5123) data.setUint16(offset, index, true);
    else data.setUint32(offset, index, true);
  }
  const json = {
    asset: { version: "2.0" },
    buffers: [
      {
        byteLength: bytes.length,
        ...(uri === undefined ? { uri: dataUri(bytes) } : uri ? { uri } : {}),
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 4, byteLength: 4 * stride, byteStride: stride },
      { buffer: 0, byteOffset: 4 + 4 * stride, byteLength: count * indexWidth },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 1, componentType, count, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  return { json, bytes };
};
const glb = (json: unknown, binary: Uint8Array): Uint8Array => {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json)),
    jsonSize = Math.ceil(jsonBytes.length / 4) * 4,
    binarySize = Math.ceil(binary.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonSize + 8 + binarySize),
    data = new DataView(bytes.buffer);
  data.setUint32(0, 0x46546c67, true);
  data.setUint32(4, 2, true);
  data.setUint32(8, bytes.length, true);
  data.setUint32(12, jsonSize, true);
  data.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonSize);
  bytes.set(jsonBytes, 20);
  data.setUint32(20 + jsonSize, binarySize, true);
  data.setUint32(24 + jsonSize, 0x004e4942, true);
  bytes.set(binary, 28 + jsonSize);
  return bytes;
};
it.each([5121, 5123, 5125])(
  "reads interleaved positions and component type %i indices in Y-up metres",
  (component) => {
    const { json } = fixture(component);
    const output = readGltf([text("part.gltf", json)], limits);
    expect(output).toHaveLength(9);
    expect(output[3]).toBe(1000);
    expect(output[8]).toBe(1000);
  },
);
it("reads a GLB BIN chunk with padding and transferred view offsets", () => {
  const { json, bytes } = fixture(5121, 4, "");
  const binary = glb(json, bytes),
    containing = new Uint8Array(binary.length + 8);
  containing.set(binary, 4);
  const output = readGltf(
    [{ name: "part.glb", bytes: containing.subarray(4, 4 + binary.length) }],
    limits,
  );
  expect(output[3]).toBe(1000);
  expect(output[8]).toBe(1000);
});
it.each([5, 6])("triangulates primitive mode %i with the correct winding", (mode) => {
  const { json } = fixture(5123, mode);
  const output = readGltf([text("part.gltf", json)], limits);
  expect(output).toHaveLength(18);
  expect([...output.subarray(9)].filter((_, i) => i % 3 === 0)).toEqual(
    mode === 5 ? [0, 1000, 1000] : [0, 0, 1000],
  );
  expect(() => readGltf([text("part.gltf", json)], { maxTriangles: 1 })).toThrow(
    "Too many triangles",
  );
});
it("instantiates node TRS and matrices under parent transforms and chooses the default scene", () => {
  const { json } = fixture();
  const nodes = [
    { translation: [1, 0, 0], children: [1, 2] },
    {
      mesh: 0,
      translation: [0, 1, 0],
      scale: [2, 2, 2],
      rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    },
    { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 1] },
  ];
  const output = readGltf(
    [text("part.gltf", { ...json, nodes, scenes: [{ nodes: [2] }, { nodes: [0] }], scene: 1 })],
    limits,
  );
  expect(output).toHaveLength(18);
  expect(output[0]).toBe(1000);
  expect(output[2]).toBe(1000);
  expect(output[5]).toBeCloseTo(3000, 4);
  expect(output[9]).toBe(1000);
  expect(output[10]).toBe(-2000);
});
it("resolves preloaded relative buffers and rejects remote, absolute and parent paths", () => {
  const { json, bytes } = fixture(5123, 4, "mesh%20data.bin");
  expect(
    readGltf([text("part.gltf", json), { name: "mesh%20data.bin", bytes }], limits),
  ).toHaveLength(9);
  for (const uri of [
    "http://host/file",
    "/file",
    "../file",
    "%2e%2e/file",
    "folder\\file",
    "file?token=x",
    "file#x",
  ]) {
    const bad = { ...json, buffers: [{ uri, byteLength: bytes.length }] };
    expect(() => readGltf([text("part.gltf", bad), { name: uri, bytes }], limits)).toThrow(
      /relative files|invalid/,
    );
  }
});
it("handles zero-initialized sparse accessors and normalized integer positions", () => {
  const bytes = Uint8Array.from([1, 2, 0, 0, 255, 0, 0, 0, 255, 0]);
  const json = {
    asset: { version: "2.0" },
    buffers: [{ uri: dataUri(bytes), byteLength: bytes.length }],
    bufferViews: [
      { buffer: 0, byteLength: 2 },
      { buffer: 0, byteOffset: 4, byteLength: 6 },
    ],
    accessors: [
      {
        componentType: 5121,
        normalized: true,
        count: 3,
        type: "VEC3",
        sparse: {
          count: 2,
          indices: { bufferView: 0, componentType: 5121 },
          values: { bufferView: 1 },
        },
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
  };
  const output = readGltf([text("part.gltf", json)], limits);
  expect(output[3]).toBe(1000);
  expect(output[8]).toBe(1000);
});
it("rejects required compression, out-of-bounds accessors and cycles and ignores line primitives", () => {
  const { json } = fixture();
  expect(() =>
    readGltf(
      [text("part.gltf", { ...json, extensionsRequired: ["KHR_draco_mesh_compression"] })],
      limits,
    ),
  ).toThrow("This glTF uses Draco compression. Export an uncompressed model.");
  expect(() =>
    readGltf(
      [text("part.gltf", { ...json, extensionsRequired: ["EXT_meshopt_compression"] })],
      limits,
    ),
  ).toThrow("meshopt compression");
  expect(() =>
    readGltf(
      [
        text("part.gltf", {
          ...json,
          accessors: [{ ...json.accessors[0], count: 99 }, json.accessors[1]],
        }),
      ],
      limits,
    ),
  ).toThrow("exceeds its buffer");
  expect(() =>
    readGltf([text("part.gltf", { ...json, nodes: [{ mesh: 0, children: [0] }] })], limits),
  ).toThrow("cyclic");
  expect(
    readGltf(
      [
        text("part.gltf", {
          ...json,
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] }],
        }),
      ],
      limits,
    ),
  ).toHaveLength(0);
});
