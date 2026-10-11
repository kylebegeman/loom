import type { PcbLayerState } from "./pcb-workspace.ts";

/** "copper" includes front, back and every inner copper layer on the board. */
type PresetLayer = "copper" | `${"F" | "B"}.${string}` | "Edge.Cuts";
export const PCB_LAYER_PRESETS = [
  {
    id: "assembly-front",
    name: "Assembly front",
    layers: ["F.Fab", "F.Silkscreen", "F.Courtyard", "Edge.Cuts"],
  },
  {
    id: "assembly-back",
    name: "Assembly back",
    layers: ["B.Fab", "B.Silkscreen", "B.Courtyard", "Edge.Cuts"],
  },
  { id: "copper-only", name: "Copper only", layers: ["copper"] },
  {
    id: "fab-review",
    name: "Fab review",
    layers: ["copper", "F.Mask", "B.Mask", "F.Paste", "B.Paste", "Edge.Cuts"],
  },
  {
    id: "silkscreen-check",
    name: "Silkscreen check",
    layers: ["F.Silkscreen", "B.Silkscreen", "F.Mask", "B.Mask", "Edge.Cuts"],
  },
] as const satisfies readonly { id: string; name: string; layers: readonly PresetLayer[] }[];
export type PcbLayerPresetId = (typeof PCB_LAYER_PRESETS)[number]["id"];
export type PcbBuiltInLayerPreset = (typeof PCB_LAYER_PRESETS)[number];

/** Resolve canonical board names in board order, hiding every layer outside the preset. */
export function resolveLayerPreset(
  preset: PcbBuiltInLayerPreset,
  boardLayers: readonly string[],
): PcbLayerState[] | null {
  const wanted: readonly string[] = preset.layers;
  const resolved = boardLayers.map((name) => ({
    name,
    visible: wanted.includes(name) || (wanted.includes("copper") && /^(F|B|In\d+)\.Cu$/.test(name)),
    opacity: 1,
  }));
  return resolved.some((layer) => layer.visible && layer.name !== "Edge.Cuts") ? resolved : null;
}

/** Built-in ids and display names both work in editor commands and server exports. */
export function findLayerPreset(idOrName: string): PcbBuiltInLayerPreset | undefined {
  const key = idOrName.trim().toLowerCase();
  return (
    PCB_LAYER_PRESETS.find((preset) => preset.id === key) ??
    PCB_LAYER_PRESETS.find((preset) => preset.name.toLowerCase() === key)
  );
}
