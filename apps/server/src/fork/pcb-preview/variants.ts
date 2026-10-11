import type {
  PcbInspection,
  PcbParameters,
  PcbVariant,
  PcbVariantStats,
} from "@t3tools/contracts/fork";
import { applyCircuitParameters } from "./authoring.ts";
import { boardStats } from "./boardStats.ts";

export function circuitIssues(json: unknown) {
  let errors = 0,
    warnings = 0;
  if (Array.isArray(json))
    for (const row of json) {
      if (!row || typeof row !== "object" || !("type" in row) || typeof row.type !== "string")
        continue;
      if (row.type.endsWith("_error")) errors++;
      if (row.type.endsWith("_warning")) warnings++;
    }
  return { errors, warnings };
}
export function variantStats(inspection: PcbInspection, json: readonly unknown[]): PcbVariantStats {
  const stats = boardStats({ kind: "circuit-json", elements: json, inspection, glb: null });
  const board = Object.fromEntries(
    Object.entries({
      areaMm2: stats.areaMm2,
      copperLayers: stats.copperLayers,
      frontComponents: stats.components.front,
      backComponents: stats.components.back,
      platedHoles: stats.holes.plated,
      nonPlatedHoles: stats.holes.nonPlated,
      throughVias: stats.vias.through,
      blindOrMicroVias: stats.vias.blindOrMicro,
      minDrillMm: stats.measured.drill,
      minTrackMm: stats.measured.track,
      minAnnularRingMm: stats.measured.annularRing,
      minViaDiameterMm: stats.measured.viaDiameter,
      maxHeightMm: stats.tallest?.heightMm ?? null,
    }).flatMap(([key, value]) => (value === null ? [] : [[key, value]])),
  );
  return {
    widthMm: inspection.bounds?.width ?? 0,
    heightMm: inspection.bounds?.height ?? 0,
    components: inspection.components.length,
    ...circuitIssues(json),
    board,
  };
}
export function validateVariantValues(parameters: PcbParameters, values: PcbVariant["values"]) {
  try {
    applyCircuitParameters(parameters.source, parameters.parameters, values);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid circuit parameter values.";
  }
}
