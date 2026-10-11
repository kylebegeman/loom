import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import {
  ModelAssembly,
  resolvePartPath,
  relativePartPath,
  validateAssembly,
  partMatrix,
  composeRotation,
  alignPosition,
  slugId,
} from "./model-assembly.ts";
const decode = Schema.decodeUnknownSync(ModelAssembly);
const doc = (parts: unknown[] = []) =>
  decode({ format: "loom-assembly", version: 1, name: "Test", parts });
it("defaults portable assembly fields and leaves newer documents readable", () => {
  const result = doc([{ id: "case", name: "Case", path: "case.stl" }]);
  expect(result.units).toBe("mm");
  expect(result.parts[0]).toMatchObject({
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    color: null,
    visible: true,
    parameters: {},
    parameterSet: null,
    explode: null,
  });
  expect(decode({ ...result, version: 2, enclosure: { boardPartId: "pcb" } }).version).toBe(2);
  expect(() =>
    doc([{ id: "case", name: "Case", path: "case.stl", position: [Infinity, 0, 0] }]),
  ).toThrow();
});
it("resolves folder-relative paths without escaping or accepting absolute/URL paths", () => {
  expect(resolvePartPath("design/case.loom-assembly.json", "../boards/main.glb")).toBe(
    "boards/main.glb",
  );
  expect(resolvePartPath("design/case.loom-assembly.json", "../../private.glb")).toBeNull();
  for (const path of [
    "/etc/file.stl",
    "C:/mesh.stl",
    "https://example/mesh.stl",
    "a\\b.stl",
    "a\0.stl",
  ])
    expect(resolvePartPath("design/case.loom-assembly.json", path)).toBeNull();
  expect(relativePartPath("design/case.loom-assembly.json", "boards/main.glb")).toBe(
    "../boards/main.glb",
  );
});
it("rejects duplicate ids and dangling, self or duplicate clearance pairs", () => {
  const a = { id: "a", name: "A", path: "a.stl" },
    b = { id: "b", name: "B", path: "b.stl" };
  expect(validateAssembly(doc([a, a]))?.path).toBe("parts[1].id");
  expect(validateAssembly(doc([{ ...a, parameters: { x: "1" } }]))?.path).toBe(
    "parts[0].parameters",
  );
  const base = doc([a, b]);
  expect(
    validateAssembly({
      ...base,
      clearances: [{ id: "gap", a: "a", b: "missing", requiredMm: 0.3, label: null }],
    }),
  ).not.toBeNull();
  expect(
    validateAssembly({
      ...base,
      clearances: [{ id: "gap", a: "a", b: "a", requiredMm: 0.3, label: null }],
    }),
  ).not.toBeNull();
  expect(
    validateAssembly({
      ...base,
      clearances: [
        { id: "gap", a: "a", b: "b", requiredMm: 0.3, label: null },
        { id: "gap2", a: "b", b: "a", requiredMm: 0.4, label: null },
      ],
    }),
  ).not.toBeNull();
});
it("composes world-axis quarter turns and aligns using actual rotated bounds", () => {
  const q = composeRotation([90, 0, 0], [0, 90, 0]);
  const m = partMatrix([0, 0, 0], q),
    r = partMatrix([0, 0, 0], [90, 0, 0]),
    turn = partMatrix([0, 0, 0], [0, 90, 0]);
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 3; row++)
      expect(m[col * 4 + row]).toBeCloseTo(
        [0, 1, 2].reduce((sum, k) => sum + turn[k * 4 + row]! * r[col * 4 + k]!, 0),
        6,
      );
  const aligned = alignPosition({
    position: [2, 3, 4],
    bounds: { min: [-1, -2, -3], max: [5, 8, 9] },
    target: { min: [0, 0, 0], max: [10, 20, 30] },
    axis: "z",
    mode: "after",
    offsetMm: 0.5,
  });
  expect(aligned).toEqual([2, 3, 37.5]);
  expect(
    alignPosition({
      position: [2, 3, 4],
      bounds: { min: [-1, -2, -3], max: [5, 8, 9] },
      target: { min: [0, 0, 0], max: [0, 0, 0] },
      axis: "z",
      mode: "min",
    }),
  ).toEqual([2, 3, 7]);
  expect(slugId("Case", ["case", "case-2"])).toBe("case-3");
});
