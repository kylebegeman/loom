export type AnnounceInput = {
  file: string;
  geometryRevision: string;
  stats: { size: readonly number[]; triangles: number } | null;
  fits: boolean | null;
  bedLabel: string;
  stale: boolean;
  hint: string | null;
  tool: "measure" | "annotate" | "lay-flat" | null;
  navigationMode: "orbit" | "pan";
  view: "iso" | "front" | "top" | "right" | null;
  projection: "perspective" | "orthographic";
  success: string | null;
  formatSize: (size: readonly number[]) => string;
};
const VIEW_NAMES = { iso: "Isometric", front: "Front", top: "Top", right: "Right" };
const TOOL_NAMES = { measure: "Measure", annotate: "Annotate", "lay-flat": "Lay flat" };
const bedMessage = (next: AnnounceInput) =>
  `${next.fits ? "Fits the bed" : "Larger than the bed"} (${next.bedLabel}).`;

/** Announce transitions once, with loads taking precedence over simultaneous controls. */
export function announcement(previous: AnnounceInput | null, next: AnnounceInput): string | null {
  if (next.geometryRevision && next.stats && previous?.geometryRevision !== next.geometryRevision)
    return `${next.file} loaded. ${next.formatSize(next.stats.size)}, ${next.stats.triangles.toLocaleString()} triangles.${next.fits === null ? "" : " " + bedMessage(next)}`;
  if (!previous) return null;
  if (next.stale && !previous.stale) return "Showing the last good version.";
  if (next.fits !== null && next.fits !== previous.fits) return bedMessage(next);
  if (next.success && next.success !== previous.success) return next.success;
  if (next.hint && next.hint !== previous.hint) return next.hint;
  if (!next.tool && previous.tool) return `${TOOL_NAMES[previous.tool]} off`;
  if (next.navigationMode !== previous.navigationMode)
    return next.navigationMode === "pan" ? "Pan mode" : "Orbit mode";
  if (next.projection !== previous.projection)
    return next.projection === "orthographic" ? "Orthographic" : "Perspective";
  if (next.view && next.view !== previous.view) return `${VIEW_NAMES[next.view]} view`;
  return null;
}
