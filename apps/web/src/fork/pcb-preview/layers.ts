import {
  PCB_LAYER_PRESETS,
  findLayerPreset,
  resolveLayerPreset,
  type PcbEditorAction,
  type PcbLayerPreset,
  type PcbLayerPresetId,
  type PcbLayerState,
  type PcbWorkspace,
} from "@t3tools/contracts/fork";
import { reconcileLayers } from "./usePcbPreview.logic";

/** KiCad 9 default layer colors, so swatches match the exported layer drawings. */
const COLORS: Record<string, string> = {
  "F.Cu": "#c83434",
  "B.Cu": "#4d7fc4",
  "In1.Cu": "#7fc87f",
  "In2.Cu": "#ce7d2c",
  "In3.Cu": "#4fcbcb",
  "In4.Cu": "#db628b",
  "F.Silkscreen": "#f2eda1",
  "B.Silkscreen": "#e8b2a7",
  "F.Mask": "#d864ff",
  "B.Mask": "#02ffee",
  "F.Paste": "#b4a09a",
  "B.Paste": "#00c2c2",
  "F.Adhesive": "#840084",
  "B.Adhesive": "#000084",
  "Edge.Cuts": "#d0d2cd",
  Margin: "#ff26e2",
  "F.Courtyard": "#ff26e2",
  "B.Courtyard": "#26e9ff",
  "F.Fab": "#afafaf",
  "B.Fab": "#585d84",
  "User.Drawings": "#c2c2c2",
  "User.Comments": "#5994dc",
  "User.Eco1": "#b4dbd2",
  "User.Eco2": "#d8c852",
};
export function layerColor(name: string): string {
  const known = COLORS[name];
  if (known) return known;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 55% 58%)`;
}

export const LAYER_GROUPS = ["Copper", "Technical", "Board", "User"] as const;
export type LayerGroup = (typeof LAYER_GROUPS)[number];
export function layerGroup(name: string): LayerGroup {
  if (name.endsWith(".Cu")) return "Copper";
  if (/\.(Silkscreen|SilkS|Mask|Paste|Adhesive|Adhes)$/.test(name)) return "Technical";
  if (/^(Edge\.Cuts|Margin)$|\.(Courtyard|CrtYd|Fab)$/.test(name)) return "Board";
  return "User";
}

/** Compare named layers rather than array positions, including their saved opacity. */
export function sameVisibility(a: readonly PcbLayerState[], b: readonly PcbLayerState[]): boolean {
  if (a.length !== b.length) return false;
  const byName = new Map(b.map((layer) => [layer.name, layer]));
  return (
    byName.size === b.length &&
    new Set(a.map((layer) => layer.name)).size === a.length &&
    a.every((layer) => {
      const other = byName.get(layer.name);
      return other?.visible === layer.visible && other.opacity === layer.opacity;
    })
  );
}

/** Restore a saved set against today's board, with new layers hidden until chosen. */
export function reconcileSaved(
  saved: readonly PcbLayerState[],
  boardLayers: readonly string[],
): PcbLayerState[] {
  const byName = new Map(saved.map((layer) => [layer.name, layer]));
  return boardLayers.map((name) => byName.get(name) ?? { name, visible: false, opacity: 1 });
}

export type ActiveLayerSet =
  | { kind: "built-in"; id: PcbLayerPresetId; name: string }
  | { kind: "saved"; id: string; name: string };

/** Prefer stable built-in identities when a saved set happens to show the same layers. */
export function matchLayerSet(
  layers: readonly PcbLayerState[] | null,
  boardLayers: readonly string[],
  savedSets: PcbWorkspace["layerSets"],
): ActiveLayerSet | null {
  if (!layers?.length || !boardLayers.length) return null;
  for (const preset of PCB_LAYER_PRESETS) {
    const resolved = resolveLayerPreset(preset, boardLayers);
    if (resolved && sameVisibility(layers, resolved))
      return { kind: "built-in", id: preset.id, name: preset.name };
  }
  const saved = savedSets.find((set) =>
    sameVisibility(layers, reconcileSaved(set.layers, boardLayers)),
  );
  return saved ? { kind: "saved", id: saved.id, name: saved.name } : null;
}

/** Duplicating a built-in preserves existing names, adding a readable suffix when needed. */
export function uniqueLayerSetName(name: string, savedSets: PcbWorkspace["layerSets"]): string {
  const taken = new Set(savedSets.map((set) => set.name.trim().toLowerCase()));
  let candidate = name,
    suffix = 2;
  while (taken.has(candidate.toLowerCase())) candidate = `${name} ${suffix++}`;
  return candidate;
}

/** Named editor commands resolve hidden built-ins too; hiding only changes device menus. */
export function resolveEditorLayers(
  command: Pick<PcbEditorAction, "name" | "layers">,
  boardLayers: readonly string[],
  savedSets: PcbWorkspace["layerSets"],
): readonly PcbLayerState[] | undefined {
  if (command.name !== undefined && command.layers !== undefined)
    throw new Error("Pass layers or name, not both.");
  if (command.name !== undefined) {
    const preset = findLayerPreset(command.name);
    const saved = savedSets.find((set) => set.id === command.name || set.name === command.name);
    const resolved = preset
      ? resolveLayerPreset(preset, boardLayers)
      : saved
        ? reconcileSaved(saved.layers, boardLayers)
        : undefined;
    if (resolved === undefined) throw new Error("Unknown layer preset.");
    if (resolved === null) throw new Error("This board has none of the preset's layers.");
    return resolved;
  }
  if (command.layers?.some((layer) => !boardLayers.includes(layer.name)))
    throw new Error("Unknown layer.");
  return command.layers;
}

/** A selected built-in follows the board's layer list, including newly added inner copper. */
export function reconcileLayerChoice(
  current: readonly PcbLayerState[] | null,
  boardLayers: readonly string[],
  base: PcbLayerPreset,
): readonly PcbLayerState[] {
  if (
    current?.length === boardLayers.length &&
    boardLayers.every((name, index) => current[index]?.name === name)
  )
    return current;
  const active = matchLayerSet(current, current?.map((layer) => layer.name) ?? [], []);
  if (active?.kind === "built-in") {
    const preset = findLayerPreset(active.id)!;
    const resolved = resolveLayerPreset(preset, boardLayers);
    if (resolved) return resolved;
  }
  return reconcileLayers(current, boardLayers, base);
}
