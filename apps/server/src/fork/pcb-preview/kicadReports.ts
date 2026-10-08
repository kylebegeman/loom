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
export function parseKicadReport(input: unknown, kind: PcbCheckKind) {
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
          ...(i.pos ? { x: i.pos.x, y: i.pos.y } : {}),
        })),
      });
  };
  const report = kind === "erc" ? decodeErc(input) : decodeDrc(input);
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
    ...(report.coordinate_units ? { coordinateUnits: report.coordinate_units } : {}),
  };
}
