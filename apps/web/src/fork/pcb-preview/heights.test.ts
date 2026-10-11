import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { expect, it } from "vite-plus/test";
import type { PcbInspection } from "@t3tools/contracts/fork";
import { classifyBoard } from "./board3dParts";
import { partHeights, heightAt, heightOfPart, boardFrame } from "./heights";
function block(name: string, width: number, height: number, z: number, board = false) {
  const material = new MeshStandardMaterial();
  if (board) material.name = "board";
  const mesh = new Mesh(new BoxGeometry(width, width, height), material);
  mesh.name = name;
  mesh.position.z = z;
  return mesh;
}
it("includes top heights, through-hole lead protrusion and unnamed extremes", () => {
  const root = new Group();
  root.add(
    block("", 30, 1.6, 0.8, true),
    block("U1", 2, 9.6, 6.4),
    block("J1", 1, 7, 0.5),
    block("", 1, 12, 8),
  );
  const parts = classifyBoard(root, new Set(["U1", "J1"])),
    heights = partHeights(parts)!;
  expect(heights.boardThicknessMm).toBeCloseTo(1.6);
  expect(heights.above!.heightMm).toBeCloseTo(12.4);
  expect(heights.above!.reference).toBeNull();
  expect(heights.below!.heightMm).toBeCloseTo(3);
  expect(heights.below!.reference).toBe("J1");
  expect(heights.partCount).toBe(3);
  expect(heights.parts).toHaveLength(2);
  expect(heightAt(parts, [0, 0, 0.8])!.lengthMm).toBe(0);
  expect(heightAt(parts, [0, 0, 0])!.lengthMm).toBeCloseTo(0);
  expect(heightAt(parts, [0, 0, -3])!.side).toBe("back");
  expect(heightOfPart(parts, "U1")!.lengthMm).toBeCloseTo(9.6);
  expect(heightOfPart(parts, "missing")).toBeNull();
});
it("limits named rows without losing the full count or extreme", () => {
  const root = new Group();
  root.add(block("", 50, 1.6, 0.8, true));
  for (let i = 0; i < 105; i++) root.add(block(`U${i}`, 1, i + 1, 1.6 + (i + 1) / 2));
  const heights = partHeights(
    classifyBoard(root, new Set(Array.from({ length: 105 }, (_, i) => `U${i}`))),
  )!;
  expect(heights.parts).toHaveLength(100);
  expect(heights.partCount).toBe(105);
  expect(heights.above?.reference).toBe("U104");
});
it.each([
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
])("fits board drawing axes (%s, %s) and translation", (sx, sy) => {
  const root = new Group();
  root.add(block("", 100, 1.6, 0.8, true));
  const drawings = [
    [1, 2],
    [10, 7],
    [4, 15],
    [20, 25],
    [40, 10],
  ];
  const components = drawings.map(([x, y], i) => {
    const part = block(`U${i}`, 1, 2, 2.6);
    part.position.x = sx! * x! + 30;
    part.position.y = sy! * y! - 20;
    root.add(part);
    return {
      id: `U${i}`,
      reference: `U${i}`,
      value: "",
      footprint: "",
      pcb: { x: x!, y: y!, sheet: "board" },
      pins: [],
    };
  });
  const parts = classifyBoard(root, new Set(components.map((c) => c.reference)));
  const inspection = {
    sourceHash: "one",
    components,
    nets: [],
    layers: [],
    bounds: { x: 0, y: 0, width: 50, height: 50 },
    thickness: 1.6,
    mountingHoles: [],
    warnings: [],
  } satisfies PcbInspection;
  expect(boardFrame(parts, inspection)!.toModel({ x: 6, y: 9 })).toEqual([
    sx! * 6 + 30,
    sy! * 9 - 20,
  ]);
});
