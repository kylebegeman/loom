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
  "Dwgs.User": "#c2c2c2",
  "Cmts.User": "#5994dc",
  "Eco1.User": "#b4dbd2",
  "Eco2.User": "#d8c852",
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
