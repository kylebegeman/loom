import { it, expect } from "vite-plus/test";
import { createChangeMemory, type SeenVersion, type DrawingSnapshot } from "./changeMemory";
const drawing: DrawingSnapshot = {
  view: "pcb",
  sheetId: "board",
  layersKey: "front",
  frame: { x: 0, y: 0, width: 10, height: 10 },
  images: [{ svg: "0123456789", opacity: 1 }],
};
const seen: SeenVersion = {
  sourceHash: "a",
  inspection: {
    sourceHash: "a",
    components: [],
    nets: [],
    layers: [],
    bounds: null,
    thickness: 1.6,
    mountingHoles: [],
    warnings: [],
  },
  drawing,
};
it("evicts least recently used designs and drawings before semantic entries", () => {
  const m = createChangeMemory(2, 25);
  m.set("a", seen);
  m.set("b", seen);
  expect(m.get("a")?.drawing).toBeNull();
  expect(m.get("b")?.drawing).toEqual(drawing);
  m.get("a");
  m.set("c", { ...seen, drawing: null });
  expect(m.get("b")).toBeUndefined();
  expect(m.get("a")).toBeDefined();
  m.setDrawing("a", "stale", drawing);
  expect(m.get("a")?.drawing).toBeNull();
  m.setDrawing("a", "a", drawing);
  expect(m.get("a")?.drawing).toEqual(drawing);
});
