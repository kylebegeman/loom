import * as Schema from "effect/Schema";
import type { PcbCheckKind, PcbViolation } from "@t3tools/contracts/fork";

const Item = Schema.Struct({
  description: Schema.String,
  pos: Schema.optional(Schema.Struct({ x: Schema.Finite, y: Schema.Finite })),
});
const Violation = Schema.Struct({
  type: Schema.String,
  description: Schema.String,
  severity: Schema.String,
  excluded: Schema.optional(Schema.Boolean),
  items: Schema.Array(Item),
});
const Common = { kicad_version: Schema.String, coordinate_units: Schema.optional(Schema.String) };
const Drc = Schema.Struct({
  ...Common,
  violations: Schema.Array(Violation),
  unconnected_items: Schema.optional(Schema.Array(Violation)),
  schematic_parity: Schema.optional(Schema.Array(Violation)),
});
const Erc = Schema.Struct({
  ...Common,
  sheets: Schema.Array(Schema.Struct({ path: Schema.String, violations: Schema.Array(Violation) })),
});
const decodeDrc = Schema.decodeUnknownSync(Drc),
  decodeErc = Schema.decodeUnknownSync(Erc);
const MM_PER: Record<string, number> = { mm: 1, in: 25.4, mils: 0.0254, mil: 0.0254 };
/** Millimetres per report unit; a missing unit is KiCad's mm default, an unknown one is null. */
export const unitScale = (units: string | undefined) =>
  units === undefined ? 1 : (MM_PER[units] ?? null);
/**
 * KiCad 8.0 to 10.0.6 wrote ERC JSON positions with the board scale instead of the schematic
 * scale, 100 times too small (KiCad issue 25582, fixed in 10.0.7). DRC was never affected.
 * Development builds (x.99) are taken as correct.
 */
export function ercScaleFactor(kind: PcbCheckKind, kicadVersion: string) {
  if (kind !== "erc") return 1;
  const match = /^\D*(\d+)\.(\d+)(?:\.(\d+))?/.exec(kicadVersion);
  if (!match) return 1;
  const [major = 0, minor = 0, patch = 0] = match.slice(1).map((n) => Number(n ?? 0));
  if (minor === 99 && major >= 10) return 1;
  return (major >= 8 && major <= 9) || (major === 10 && minor === 0 && patch < 7) ? 100 : 1;
}
// KiCad writes 4 decimals; rounding keeps 0.4191 * 100 from printing as 41.910000000000004.
const toMm = (value: number, scale: number) => Math.round(value * scale * 1e4) / 1e4;
/** Parses a KiCad JSON report with every item position converted to millimetres. */
export function parseKicadReport(input: unknown, kind: PcbCheckKind) {
  const report = kind === "erc" ? decodeErc(input) : decodeDrc(input);
  const units = unitScale(report.coordinate_units);
  // An unknown unit cannot be placed on the drawing, so its positions are dropped.
  const scale = units === null ? null : units * ercScaleFactor(kind, report.kicad_version);
  const violations: PcbViolation[] = [];
  const add = (
    items: ReadonlyArray<typeof Violation.Type>,
    group: PcbViolation["group"],
    sheet?: string,
  ) => {
    for (const v of items)
      violations.push({
        type: v.type.slice(0, 256),
        description: v.description.slice(0, 2048),
        severity: v.severity === "error" ? "error" : "warning",
        excluded: v.excluded ?? false,
        group,
        ...(sheet ? { sheet } : {}),
        items: v.items.slice(0, 32).map((i) => ({
          description: i.description.slice(0, 512),
          ...(i.pos && scale !== null ? { x: toMm(i.pos.x, scale), y: toMm(i.pos.y, scale) } : {}),
        })),
      });
  };
  if ("sheets" in report)
    for (const sheet of report.sheets) add(sheet.violations, "violation", sheet.path);
  else {
    add(report.violations, "violation");
    add(report.unconnected_items ?? [], "unconnected");
    add(report.schematic_parity ?? [], "parity");
  }
  // Keep actionable findings before excluded items, then errors before warnings.
  const sorted = violations.toSorted(
    (a, b) =>
      Number(a.excluded) - Number(b.excluded) ||
      Number(b.severity === "error") - Number(a.severity === "error"),
  );
  const bounded: PcbViolation[] = [];
  let bytes = 0;
  for (const v of sorted) {
    const size = Buffer.byteLength(JSON.stringify(v));
    if (bounded.length >= 500 || bytes + size > 1024 * 1024) break;
    bounded.push(v);
    bytes += size;
  }
  return {
    counts: {
      errors: violations.filter((v) => !v.excluded && v.severity === "error").length,
      warnings: violations.filter((v) => !v.excluded && v.severity === "warning").length,
      excluded: violations.filter((v) => v.excluded).length,
    },
    violations: bounded,
    truncated: sorted.length > bounded.length,
    kicadVersion: report.kicad_version,
    coordinateUnits: "mm",
  };
}
