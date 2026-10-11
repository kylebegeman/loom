import type { PcbBoardStats, PcbInspection } from "@t3tools/contracts/fork";
import { formatLength, formatLengths } from "./length";

/** Draft summaries always keep tool-facing millimetres, regardless of display preference. */
export function boardStatsText(
  stats: PcbBoardStats,
  inspection?: Pick<PcbInspection, "thickness" | "nets">,
) {
  const mm = (value: number | null) =>
    value === null ? "Not available" : formatLength(value, "mm", { trim: true });
  const measured = (name: string, value: number | null, rule: number | null | undefined) =>
    `${name}: ${mm(value)} (measured)${rule == null ? "" : `; ${mm(rule)} rule`}`;
  return [
    "Board stats",
    `Size: ${stats.size ? formatLengths([stats.size.width, stats.size.height], "mm", { trim: true }) : "Not available"}`,
    `Area: ${stats.areaMm2 === null ? "Not available" : `${stats.areaMm2.toFixed(2)} mm² (${stats.areaSource === "outline" ? "outline" : "bounding box"})`}`,
    ...(inspection
      ? [`Thickness: ${mm(inspection.thickness)}`, `Nets: ${inspection.nets.length}`]
      : []),
    `Copper layers: ${stats.copperLayers}`,
    `Components: ${stats.components.front} front, ${stats.components.back} back`,
    `Holes: ${stats.holes.plated} plated, ${stats.holes.nonPlated} non-plated`,
    `Vias: ${stats.vias.through} through, ${stats.vias.blindOrMicro} blind or micro`,
    measured("Smallest drill", stats.measured.drill, stats.rules?.drill),
    measured("Smallest track", stats.measured.track, stats.rules?.track),
    measured(
      "Smallest annular ring (round pads and vias)",
      stats.measured.annularRing,
      stats.rules?.annularRing,
    ),
    measured("Smallest via diameter", stats.measured.viaDiameter, stats.rules?.viaDiameter),
    `Clearance: ${mm(stats.rules?.clearance ?? null)}${stats.rules?.clearance == null ? "" : " rule"}; run DRC to measure`,
    `Tallest part: ${stats.tallest ? `${mm(stats.tallest.heightMm)}${stats.tallest.reference ? `, ${stats.tallest.reference}` : ""}, ${stats.tallest.side} (${stats.tallest.source === "glb" ? "3D board" : "Circuit JSON"})` : stats.heights === "needs-3d" ? "Build the 3D board to measure heights" : stats.heights === "no-models" ? "No 3D component models" : "Not available"}`,
  ].join("\n");
}
