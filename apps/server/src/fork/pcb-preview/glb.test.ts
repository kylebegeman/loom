import { expect, it } from "vite-plus/test";
import { normalizeCircuitGlb } from "./glb.ts";

const encode = (document: unknown) => {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const padded = (json.length + 3) & ~3;
  const bytes = new Uint8Array(20 + padded + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + padded);
  bytes.set(json, 20);
  view.setUint32(20 + padded, 4, true);
  view.setUint32(24 + padded, 0x004e4942, true);
  bytes.set([1, 2, 3, 4], 28 + padded);
  return bytes;
};
const decode = (bytes: Uint8Array) =>
  JSON.parse(
    new TextDecoder().decode(
      bytes.subarray(20, 20 + new DataView(bytes.buffer).getUint32(12, true)),
    ),
  );

it("exports tscircuit board geometry in standard glTF metres without changing mesh data", () => {
  const original = {
    asset: { version: "2.0", generator: "circuit-json-to-gltf" },
    scenes: [{ nodes: [0, 1], name: "Board" }, { nodes: [1] }],
    nodes: [{ mesh: 0 }, { translation: [3, 0.7, 0] }],
    accessors: [{ min: [-12, -0.7, -10], max: [12, 0.7, 10] }],
  };
  const input = encode(original);
  const output = normalizeCircuitGlb(input);
  const result = decode(output);
  expect(result.scenes).toEqual([{ nodes: [2], name: "Board" }, { nodes: [3] }]);
  expect(result.nodes).toEqual([
    ...original.nodes,
    { name: "Loom millimetres to metres", children: [0, 1], scale: [0.001, 0.001, 0.001] },
    { name: "Loom millimetres to metres", children: [1], scale: [0.001, 0.001, 0.001] },
  ]);
  expect(result.accessors).toEqual(original.accessors);
  expect(output.subarray(-12)).toEqual(input.subarray(-12));
  expect(new DataView(output.buffer).getUint32(8, true)).toBe(output.length);
  expect(decode(input)).toEqual(original);
});
it("rejects truncated, unsupported and malformed board exports", () => {
  expect(() => normalizeCircuitGlb(new Uint8Array([1]))).toThrow();
  const input = encode({ scenes: [{ nodes: [0] }], nodes: [{}] });
  expect(() => normalizeCircuitGlb(input.subarray(0, input.length - 1))).toThrow();
  expect(() => normalizeCircuitGlb(encode({ scenes: [{ nodes: [9] }], nodes: [{}] }))).toThrow();
  expect(() => normalizeCircuitGlb(encode({ scenes: [], nodes: [] }))).toThrow();
});
