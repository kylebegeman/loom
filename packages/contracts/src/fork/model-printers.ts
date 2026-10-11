import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { BuildPlatePresetId, CustomBedId } from "./model-beds.ts";
import { SlicerApp } from "./model-slicer.ts";

const mm = Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 10, maximum: 2000 }));
const offsetMm = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: 0, maximum: 2000 }),
);
const text = (max: number) => Schema.String.check(Schema.isMaxLength(max));
const name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60));
export const UserPrinterId = CustomBedId;
export const MaterialId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));
export const NozzleZone = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  label: name,
  footprintMm: Schema.Tuple([mm, mm]),
  offsetMm: Schema.Tuple([offsetMm, offsetMm]),
  heightMm: Schema.optionalKey(mm),
});
export const ExcludedArea = Schema.Array(Schema.Tuple([offsetMm, offsetMm])).check(
  Schema.isMinLength(3),
  Schema.isMaxLength(32),
);
export const Printer = Schema.Struct({
  id: UserPrinterId,
  name,
  kind: Schema.Literals(["printer", "surface"]),
  volumeMm: Schema.Tuple([mm, mm, Schema.NullOr(mm)]),
  bedShape: Schema.Literals(["rectangle", "round"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("rectangle" as const)),
  ),
  nozzlesMm: Schema.Array(
    Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0.1, maximum: 2 })),
  ).check(Schema.isMaxLength(8)),
  materialIds: Schema.Array(MaterialId).check(Schema.isMaxLength(32)),
  defaultMaterialId: Schema.NullOr(MaterialId),
  zones: Schema.Array(NozzleZone).check(Schema.isMaxLength(8)),
  excludedAreasMm: Schema.Array(ExcludedArea).check(Schema.isMaxLength(8)),
  notes: text(2000),
  source: Schema.Struct({
    kind: Schema.Literals(["user", "imported"]),
    app: Schema.NullOr(SlicerApp),
    profileName: Schema.NullOr(text(200)),
  }),
  basedOn: Schema.NullOr(Schema.String),
});
export type Printer = typeof Printer.Type;
export const Material = Schema.Struct({
  id: MaterialId,
  name,
  type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  brand: Schema.NullOr(text(60)),
  colorHex: Schema.NullOr(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))),
  densityGCm3: Schema.Number.check(
    Schema.isFinite(),
    Schema.isBetween({ minimum: 0.5, maximum: 3 }),
  ),
  costPerKg: Schema.NullOr(
    Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0, maximum: 10000 })),
  ),
  nozzleC: Schema.NullOr(Schema.Tuple([Schema.Int, Schema.Int])),
  bedC: Schema.NullOr(Schema.Tuple([Schema.Int, Schema.Int])),
  notes: text(2000),
});
export type Material = typeof Material.Type;
export const USER_PRINTER_LIMIT = 50;
export const MATERIAL_LIMIT = 100;
export const PrinterLibrary = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  printers: Schema.Array(Printer).check(Schema.isMaxLength(USER_PRINTER_LIMIT)),
  materials: Schema.Array(Material).check(Schema.isMaxLength(MATERIAL_LIMIT)),
  hiddenBuiltIns: Schema.Array(BuildPlatePresetId).check(Schema.isMaxLength(64)),
});
export type PrinterLibrary = typeof PrinterLibrary.Type;
export const PrinterLibraryUpdate = Schema.Struct({
  expectedVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  printers: PrinterLibrary.fields.printers,
  materials: PrinterLibrary.fields.materials,
  hiddenBuiltIns: PrinterLibrary.fields.hiddenBuiltIns,
});
export type PrinterLibraryUpdate = typeof PrinterLibraryUpdate.Type;
export const PrinterProfileInput = Schema.Struct({
  fileName: text(255),
  text: text(2 * 1024 * 1024),
});
export type PrinterProfileInput = typeof PrinterProfileInput.Type;
export const PrinterProfileDraft = Schema.Struct({
  printer: Printer,
  warnings: Schema.Array(text(2000)).check(Schema.isMaxLength(20)),
});
export type PrinterProfileDraft = typeof PrinterProfileDraft.Type;
export const PrinterExport = Schema.Struct({
  format: Schema.Literal("loom.printers"),
  version: Schema.Literal(1),
  exportedAt: Schema.String,
  printers: PrinterLibrary.fields.printers,
  materials: PrinterLibrary.fields.materials,
});
export type PrinterExport = typeof PrinterExport.Type;

/** Cross-record constraints shared by settings and authoritative host writes. */
export const libraryProblems = (
  library: Pick<PrinterLibrary, "printers" | "materials" | "hiddenBuiltIns">,
): string[] => {
  const problems: string[] = [];
  const seen = (values: readonly string[], label: string) => {
    if (new Set(values).size !== values.length) problems.push(`${label} must be unique.`);
  };
  seen(
    library.printers.map((p) => p.id),
    "Printer ids",
  );
  seen(
    library.printers.map((p) => `${p.kind}:${p.name.trim().toLocaleLowerCase()}`),
    "Printer names within a kind",
  );
  seen(
    library.materials.map((m) => m.id),
    "Material ids",
  );
  seen(library.hiddenBuiltIns, "Hidden built-in ids");
  const ids = new Set(library.materials.map((m) => m.id));
  for (const printer of library.printers) {
    if (!printer.name.trim()) problems.push(`${printer.id}: Enter a printer name.`);
    if (printer.kind === "printer" && printer.volumeMm[2] === null)
      problems.push(`${printer.name}: Printers need a height limit.`);
    if (printer.bedShape === "round" && printer.volumeMm[0] !== printer.volumeMm[1])
      problems.push(`${printer.name}: Round beds need equal width and depth.`);
    seen(printer.materialIds, `${printer.name}: Material ids`);
    seen(
      printer.zones.map((z) => z.id),
      `${printer.name}: Zone ids`,
    );
    seen(printer.nozzlesMm.map(String), `${printer.name}: Nozzle sizes`);
    if (printer.materialIds.some((id) => !ids.has(id)))
      problems.push(`${printer.name}: A selected material does not exist.`);
    if (
      printer.defaultMaterialId !== null &&
      !printer.materialIds.includes(printer.defaultMaterialId)
    )
      problems.push(`${printer.name}: The default material must be selected for this printer.`);
    for (const zone of printer.zones) {
      if (
        zone.offsetMm.some(
          (value, axis) => value + zone.footprintMm[axis]! > printer.volumeMm[axis]! + 1e-6,
        ) ||
        (zone.heightMm !== undefined &&
          printer.volumeMm[2] !== null &&
          zone.heightMm > printer.volumeMm[2])
      )
        problems.push(`${printer.name}: ${zone.label} leaves the bed.`);
    }
    if (
      printer.excludedAreasMm.some((area) =>
        area.some((point) => point[0] > printer.volumeMm[0] || point[1] > printer.volumeMm[1]),
      )
    )
      problems.push(`${printer.name}: An excluded area leaves the bed.`);
  }
  for (const material of library.materials) {
    if (!material.name.trim()) problems.push(`${material.id}: Enter a material name.`);
    for (const range of [material.nozzleC, material.bedC])
      if (range && (range[0] < 0 || range[1] > 500 || range[0] > range[1]))
        problems.push(`${material.name}: Temperatures need an ordered range from 0 to 500 °C.`);
  }
  return problems;
};

export const STARTER_MATERIALS: readonly Material[] = [
  { type: "PLA", densityGCm3: 1.24, nozzleC: [190, 240], bedC: [55, 55] },
  { type: "PETG", densityGCm3: 1.27, nozzleC: [220, 270], bedC: [70, 70] },
  { type: "ABS", densityGCm3: 1.04, nozzleC: [240, 280], bedC: [90, 90] },
  { type: "ASA", densityGCm3: 1.04, nozzleC: [240, 280], bedC: [100, 100] },
  { type: "TPU", densityGCm3: 1.24, nozzleC: [200, 250], bedC: [35, 35] },
].map((value) => ({
  ...value,
  id: `generic-${value.type.toLowerCase()}`,
  name: `Generic ${value.type}`,
  brand: null,
  colorHex: null,
  costPerKg: null,
  notes: "",
  nozzleC: value.nozzleC as [number, number],
  bedC: value.bedC as [number, number],
}));
