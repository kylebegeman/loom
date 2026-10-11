import { expect, it } from "vite-plus/test";
import { PCB_LAYER_PRESETS, findLayerPreset, resolveLayerPreset } from "./pcb-layer-presets.ts";

const layers = [
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
  "F.Fab",
  "B.Fab",
  "F.Silkscreen",
  "B.Silkscreen",
  "F.Courtyard",
  "B.Courtyard",
  "F.Mask",
  "B.Mask",
  "F.Paste",
  "B.Paste",
  "Edge.Cuts",
  "User.Drawings",
];

it("defines unique stable ids using canonical KiCad names", () => {
  expect(new Set(PCB_LAYER_PRESETS.map((preset) => preset.id)).size).toBe(PCB_LAYER_PRESETS.length);
  for (const preset of PCB_LAYER_PRESETS)
    for (const layer of preset.layers) expect(layer).not.toMatch(/SilkS$|CrtYd$|^Dwgs\./);
});

it.each([
  ["assembly-front", ["F.Fab", "F.Silkscreen", "F.Courtyard", "Edge.Cuts"]],
  ["assembly-back", ["B.Fab", "B.Silkscreen", "B.Courtyard", "Edge.Cuts"]],
  ["copper-only", ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]],
  [
    "fab-review",
    ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu", "F.Mask", "B.Mask", "F.Paste", "B.Paste", "Edge.Cuts"],
  ],
  ["silkscreen-check", ["F.Silkscreen", "B.Silkscreen", "F.Mask", "B.Mask", "Edge.Cuts"]],
])("resolves %s with complete visibility and opacity in board order", (id, expected) => {
  const result = resolveLayerPreset(findLayerPreset(id as string)!, layers)!;
  expect(result.map((layer) => layer.name)).toEqual(layers);
  expect(result.filter((layer) => layer.visible).map((layer) => layer.name)).toEqual(expected);
  expect(result.every((layer) => layer.opacity === 1)).toBe(true);
});

it("expands copper on two-layer boards and skips absent preset layers", () => {
  expect(
    resolveLayerPreset(findLayerPreset("copper-only")!, ["B.Cu", "Edge.Cuts", "F.Cu"]),
  ).toEqual([
    { name: "B.Cu", visible: true, opacity: 1 },
    { name: "Edge.Cuts", visible: false, opacity: 1 },
    { name: "F.Cu", visible: true, opacity: 1 },
  ]);
  expect(resolveLayerPreset(findLayerPreset("assembly-front")!, ["F.Fab"])).toEqual([
    { name: "F.Fab", visible: true, opacity: 1 },
  ]);
});

it("rejects unavailable presets even when the outline is present", () => {
  for (const preset of PCB_LAYER_PRESETS) {
    expect(resolveLayerPreset(preset, [])).toBeNull();
    expect(resolveLayerPreset(preset, ["Edge.Cuts", "User.Drawings"])).toBeNull();
  }
});

it("finds ids before display names case-insensitively and ignores unknown names", () => {
  expect(findLayerPreset("ASSEMBLY-FRONT")).toBe(PCB_LAYER_PRESETS[0]);
  expect(findLayerPreset(" aSseMbLy FrOnT ")).toBe(PCB_LAYER_PRESETS[0]);
  expect(findLayerPreset("missing")).toBeUndefined();
});
