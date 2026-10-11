import * as Schema from "effect/Schema";
import type {
  PcbCheckKind,
  PcbViolation,
  PcbCheckResult,
  PcbComponent,
} from "@t3tools/contracts/fork";

const Item = Schema.Struct({
  description: Schema.String,
  uuid: Schema.optional(Schema.String),
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
  units === undefined ? 1 : Object.hasOwn(MM_PER, units) ? MM_PER[units]! : null;
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
/** Matches KiCad's sheet export naming, including nested, sanitized sheet names. */
export function ercSheetId(rootSheet: string, sheetPath: string) {
  const names = sheetPath
    .split("/")
    .filter(Boolean)
    .map((name) => name.replace(/[/\\:*?"<>|]/g, "_"));
  return [rootSheet, ...names].join("-") + ".svg";
}
/** Stable across report order when KiCad UUIDs are available; locations round to 0.1 mm otherwise. */
export function findingId(
  kind: PcbCheckKind,
  group: PcbViolation["group"],
  type: string,
  sheetPath: string | undefined,
  items: PcbViolation["items"],
) {
  const identities =
    items.length > 0 && items.every((item) => item.uuid)
      ? items.map((item) => item.uuid!).toSorted()
      : items.map((item) => [
          item.description,
          item.x === undefined ? null : Math.round(item.x * 10),
          item.y === undefined ? null : Math.round(item.y * 10),
        ]);
  const key = JSON.stringify([kind, group, type, sheetPath ?? "", ...identities]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  return `${kind}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function identify(violations: readonly PcbViolation[], kind: PcbCheckKind, rootSheet?: string) {
  const counts = new Map<string, number>();
  return violations.map((v) => {
    const base = v.id ?? findingId(kind, v.group, v.type, v.sheet, v.items);
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return {
      ...v,
      id: count === 1 ? base : `${base}-${count}`,
      ...(kind === "erc" && rootSheet
        ? { sheetId: v.sheetId ?? ercSheetId(rootSheet, v.sheet ?? "/") }
        : {}),
    };
  });
}
function bound(violations: readonly PcbViolation[]) {
  const bounded: PcbViolation[] = [];
  let bytes = 0;
  for (const v of violations) {
    const size = Buffer.byteLength(JSON.stringify(v));
    if (bounded.length >= 500 || bytes + size > 1024 * 1024 - 1024) break;
    bounded.push(v);
    bytes += size + 1;
  }
  return bounded;
}
/**
 * The earlier local ERC fix stored mm without a provenance flag. Only saved symbol positions
 * can distinguish those reports from raw legacy coordinates; never guess from coordinate size.
 */
export function legacyErcScale(
  result: PcbCheckResult,
  rootSheet: string,
  components: readonly PcbComponent[],
) {
  const units = unitScale(result.coordinateUnits);
  if (units === null) return null;
  let raw = 0,
    corrected = 0;
  for (const v of result.violations)
    for (const item of v.items) {
      const reference = /^Symbol (\S+)\s/.exec(item.description)?.[1];
      if (!reference || item.x === undefined || item.y === undefined) continue;
      const expected = components.find(
        (c) =>
          c.reference === reference && c.schematic?.sheet === ercSheetId(rootSheet, v.sheet ?? "/"),
      )?.schematic;
      if (!expected) continue;
      const distance = (factor: number) =>
        Math.hypot(item.x! * units * factor - expected.x, item.y! * units * factor - expected.y);
      const before = distance(100),
        after = distance(1);
      if (before < 0.02 && after > 0.02) raw++;
      if (after < 0.02 && before > 0.02) corrected++;
    }
  return raw && !corrected ? 100 : corrected && !raw ? 1 : null;
}
/** Upgrade old persisted results on read; normalized results retain their identity and coordinates. */
export function normalizeCheckResult(
  result: PcbCheckResult,
  rootSheet?: string,
  legacyScale: number | null = ercScaleFactor(result.kind, result.kicadVersion ?? ""),
): PcbCheckResult {
  if (
    result.pointsInMm &&
    result.violations.every((v) => v.id && (result.kind !== "erc" || !rootSheet || v.sheetId))
  )
    return result;
  const units = unitScale(result.coordinateUnits);
  const scale = result.pointsInMm
    ? 1
    : units === null || legacyScale === null
      ? null
      : units * legacyScale;
  const violations = identify(
    result.violations.map((v) => ({
      ...v,
      items: v.items.map((item) => {
        const { x, y, ...rest } = item;
        return {
          ...rest,
          ...(x !== undefined &&
          y !== undefined &&
          scale !== null &&
          Number.isFinite(x * scale) &&
          Number.isFinite(y * scale)
            ? { x: toMm(x, scale), y: toMm(y, scale) }
            : {}),
        };
      }),
    })),
    result.kind,
    rootSheet,
  );
  const bounded = bound(violations);
  const uncertain = !result.pointsInMm && legacyScale === null && result.kind === "erc";
  return {
    ...result,
    violations: bounded,
    coordinateUnits: "mm",
    pointsInMm: true,
    truncated: result.truncated || bounded.length < violations.length,
    log: uncertain
      ? `${result.log}\nRun ERC again to locate these legacy findings. Their coordinate scale cannot be verified against the saved schematic.`
      : result.log,
  };
}
/** Parses a KiCad JSON report with every item position converted to millimetres. */
export function parseKicadReport(
  input: unknown,
  kind: PcbCheckKind,
  options: { rootSheet?: string | undefined } = {},
) {
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
          ...(i.uuid ? { uuid: i.uuid.slice(0, 256) } : {}),
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
  const sorted = identify(violations, kind, options.rootSheet).toSorted(
    (a, b) =>
      Number(a.excluded) - Number(b.excluded) ||
      Number(b.severity === "error") - Number(a.severity === "error"),
  );
  const bounded = bound(sorted);
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
    pointsInMm: true,
  };
}
