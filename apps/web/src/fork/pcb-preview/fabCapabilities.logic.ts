import * as Schema from "effect/Schema";
import {
  PcbFabCapability,
  type PcbFabCatalog,
  type PcbFabCheckResult,
} from "@t3tools/contracts/fork";
const valid = Schema.is(PcbFabCapability);
export function duplicateCapability(
  entry: PcbFabCapability,
  ids: readonly string[],
): PcbFabCapability {
  let counter = 1,
    id: string;
  do {
    const suffix = counter === 1 ? "-copy" : `-copy-${counter}`;
    id = entry.id.slice(0, 48 - suffix.length) + suffix;
    counter++;
  } while (ids.includes(id));
  return { ...entry, id, name: `${entry.name.slice(0, 74)} copy` };
}
export function parseLengthList(text: string): number[] | null {
  const tokens = text.split(",").map((v) => v.trim());
  if (!tokens.length || tokens.some((v) => !/^\d+(?:\.\d+)?$/.test(v))) return null;
  const values = tokens.map(Number);
  return values.every((v) => Number.isFinite(v) && v > 0) ? [...new Set(values)] : null;
}
export function capabilityErrors(entry: PcbFabCapability): string[] {
  const errors: string[] = [];
  if (!valid(entry))
    errors.push(
      "Use a name, valid lists, a checked date and positive millimetre limits below 10 mm.",
    );
  if (entry.minTrackMm < 0.05 || entry.minSpaceMm < 0.05)
    errors.push("Track and space must be at least 0.05 mm.");
  if (entry.minViaMm <= entry.minDrillMm)
    errors.push("Via pad diameter must be greater than its drill.");
  if (!entry.layerCounts.length || !entry.thicknessesMm.length || !entry.finishes.length)
    errors.push("Include at least one layer count, thickness and finish.");
  if (entry.sourceUrl) {
    try {
      const url = new URL(entry.sourceUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        errors.push("Use an HTTP or HTTPS source link without credentials.");
    } catch {
      errors.push("Use a valid source link.");
    }
  }
  return errors;
}
export function removeCapability(state: Pick<PcbFabCatalog, "entries" | "defaultId">, id: string) {
  return {
    entries: state.entries.filter((e) => e.id !== id),
    defaultId: state.defaultId === id ? "jlcpcb-standard" : state.defaultId,
  };
}
export function fabSummaryText(result: PcbFabCheckResult): string {
  return [
    `Fab check: ${result.capability.name}`,
    `${result.outcome}: ${result.counts.errors} errors, ${result.counts.warnings} warnings`,
    ...result.boardFindings.map((f) => f.message),
    ...result.violations.filter((v) => !v.excluded).map((v) => v.description),
    ...result.costDrivers.map((d) => `${d.title}: ${d.detail}`),
    `Limits checked ${result.capability.checkedOn}: ${result.capability.sourceUrl}`,
  ].join("\n");
}
