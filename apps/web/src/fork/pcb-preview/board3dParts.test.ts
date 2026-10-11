import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { expect, it } from "vite-plus/test";
import { classifyBoard, availableLayers } from "./board3dParts";
import { shownIn } from "../model-preview-3d/viewer/createViewer";
export function block(name: string, size: [number, number, number], z: number, materialName = "") {
  const material = new MeshStandardMaterial();
  material.name = materialName;
  const mesh = new Mesh(new BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.z = z;
  return mesh;
}
it("classifies materials, component instances, sides and inherited visibility", () => {
  const root = new Group(),
    top = new Group();
  top.name = "U1_2";
  top.add(block("body", [2, 2, 4], 3.6));
  root.add(
    block("", [20, 10, 1.6], 0.8, "board"),
    block("", [20, 10, 0.01], 1.61, "soldermask"),
    top,
    block("J1", [3, 3, 2], -2),
  );
  const parts = classifyBoard(root, new Set(["U1", "J1"]));
  expect(parts.kind).toBe("kicad");
  expect(parts.top).toBeCloseTo(1.6);
  expect(parts.components.map((part) => [part.reference, part.side])).toEqual([
    ["U1", "front"],
    ["J1", "back"],
  ]);
  expect(availableLayers(parts).soldermask).toBe(true);
  expect(availableLayers(parts).copper).toBe(false);
  top.visible = false;
  expect(shownIn(top.children[0]!, root)).toBe(false);
});
it("uses the largest unnamed board body and preserves unnamed models on tscircuit", () => {
  const root = new Group();
  root.name = "Loom_millimetres_to_metres";
  root.add(block("", [20, 10, 1.4], 0.7), block("", [2, 2, 3], 2.9), block("J1", [25, 25, 2], 3));
  const parts = classifyBoard(root, new Set(["J1"]));
  expect(parts.kind).toBe("tscircuit");
  expect(parts.top).toBeCloseTo(1.4);
  expect(parts.components).toHaveLength(2);
  expect(parts.components.some((part) => part.reference === null)).toBe(true);
  expect(availableLayers(parts).copper).toBe(false);
});
it("reports no board body when the export only contains known components", () => {
  const root = new Group();
  root.add(block("U1", [10, 10, 2], 4));
  expect(classifyBoard(root, new Set(["U1"])).top).toBeNull();
});
