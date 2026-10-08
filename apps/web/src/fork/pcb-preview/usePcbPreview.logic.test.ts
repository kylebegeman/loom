import { expect, it } from "vite-plus/test";
import type { PcbDesign } from "@t3tools/contracts/fork";
import { initialView, previewAction, reconcileLayers } from "./usePcbPreview.logic";
const design: PcbDesign = {
  id: "board.kicad_pro",
  absolutePath: "/workspace/board.kicad_pro",
  name: "board",
  kind: "kicad",
  schematicPath: "board.kicad_sch",
  boardPath: "board.kicad_pcb",
  toolAvailable: true,
  toolStatus: { found: true, version: "10.0.6" },
};
const input = {
  visible: true,
  design,
  trusted: false,
  canRender: true,
  sourceHash: "revision",
  view: "schematic" as const,
};
it("supports manual refresh and failed watches while waiting for an initial revision", () => {
  expect(previewAction(input)).toBe("render");
  expect(previewAction({ ...input, sourceHash: null })).toBe("waiting");
  expect(previewAction({ ...input, sourceHash: null, watchFailed: true })).toBe("render");
  expect(previewAction({ ...input, sourceHash: null, manual: true })).toBe("render");
});
it("gates hidden, unavailable, untrusted and forbidden jobs", () => {
  expect(previewAction({ ...input, visible: false })).toBe("idle");
  expect(previewAction({ ...input, design: null })).toBe("idle");
  expect(previewAction({ ...input, canRender: false })).toBe("needs-permission");
  expect(previewAction({ ...input, design: { ...design, toolAvailable: false } })).toBe(
    "needs-tool",
  );
  expect(previewAction({ ...input, design: { ...design, kind: "tscircuit" } })).toBe("needs-trust");
  expect(previewAction({ ...input, trusted: true, design: { ...design, kind: "tscircuit" } })).toBe(
    "render",
  );
});
it("falls back from remembered views that the chosen design lacks", () => {
  expect(initialView(design, "pcb")).toBe("pcb");
  const { schematicPath: _unused, ...board } = design;
  expect(initialView(board, "schematic")).toBe("pcb");
  expect(previewAction({ ...input, design: board })).toBe("idle");
});

it("reconciles removed and added layers without losing current visibility or opacity", () => {
  const current = [
    { name: "F.Cu", visible: false, opacity: 0.4 },
    { name: "In1.Cu", visible: true, opacity: 0.8 },
  ];
  const reconciled = reconcileLayers(current, ["F.Cu", "B.Cu", "Edge.Cuts"], "front");
  expect(reconciled).toEqual([
    current[0],
    { name: "B.Cu", visible: false, opacity: 1 },
    { name: "Edge.Cuts", visible: true, opacity: 1 },
  ]);
  expect(reconcileLayers(reconciled, ["F.Cu", "B.Cu", "Edge.Cuts"], "front")).toBe(reconciled);
  expect(reconcileLayers(null, ["F.Paste"], "front")[0]?.visible).toBe(true);
});
