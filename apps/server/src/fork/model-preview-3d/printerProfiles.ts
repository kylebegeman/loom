import type { Printer, PrinterProfileDraft } from "@t3tools/contracts/fork";

type Point = readonly [number, number];
export type ProfileShape = {
  shape: "rectangle" | "round";
  volume: readonly [number, number];
  origin: Point;
  warnings: string[];
};
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("This file is not a printer profile Loom can read.");
  return value as Record<string, unknown>;
};
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? [value]
      : [];
const first = (value: unknown): string | undefined => strings(value)[0];
const number = (value: unknown): number | null => {
  const input = first(value) ?? (typeof value === "number" ? String(value) : "");
  if (!input.trim()) return null;
  const result = Number(input);
  return Number.isFinite(result) ? result : null;
};
const polygon = (text: string | undefined): Point[] => {
  if (!text) return [];
  const points = text.split(",").map((token) => token.trim().split(/x/i).map(Number));
  if (
    points.length < 3 ||
    points.length > 128 ||
    points.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))
  )
    throw new Error("The profile has an invalid bed outline.");
  return points.map((p) => [p[0]!, p[1]!] as const);
};
/** Recognize rectangles and circular beds while keeping all offsets relative to the front-left. */
export const shapeFromPolygon = (points: readonly Point[]): ProfileShape => {
  if (points.length < 3 || points.some((p) => p.some((n) => !Number.isFinite(n))))
    throw new Error("The profile has no bed size.");
  const min: Point = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
  const max: Point = [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
  const width = max[0] - min[0],
    depth = max[1] - min[1];
  if (width < 10 || depth < 10 || width > 2000 || depth > 2000)
    throw new Error("Bed width and depth must be 10 to 2000 mm.");
  const unique = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()];
  const rectangle =
    unique.length === 4 &&
    unique.every(
      (p) =>
        (Math.abs(p[0] - min[0]) < 0.01 || Math.abs(p[0] - max[0]) < 0.01) &&
        (Math.abs(p[1] - min[1]) < 0.01 || Math.abs(p[1] - max[1]) < 0.01),
    );
  const centre: Point = [
    unique.reduce((sum, p) => sum + p[0], 0) / unique.length,
    unique.reduce((sum, p) => sum + p[1], 0) / unique.length,
  ];
  const radii = unique.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1]));
  const radius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
  const round = unique.length >= 8 && radii.every((r) => Math.abs(r - radius) <= 0.5);
  const diameter = radius * 2;
  return {
    shape: round ? "round" : "rectangle",
    volume: round ? [diameter, diameter] : [width, depth],
    origin: round ? [centre[0] - radius, centre[1] - radius] : min,
    warnings:
      rectangle || round
        ? []
        : ["The bed outline is not a rectangle or circle; Loom uses its bounding box."],
  };
};
const nozzles = (value: unknown): number[] => {
  const result = [
    ...new Set(
      strings(value)
        .flatMap((s) => s.split(/[;,]/))
        .map(Number),
    ),
  ];
  if (
    !result.length ||
    result.length > 8 ||
    result.some((n) => !Number.isFinite(n) || n < 0.1 || n > 2)
  )
    throw new Error("The profile has no valid nozzle size.");
  return result;
};
const base = (
  id: string,
  name: string,
  shape: ProfileShape,
  height: number | null,
  app: Printer["source"]["app"],
): Printer => ({
  id,
  name: name.slice(0, 60),
  kind: height === null ? "surface" : "printer",
  volumeMm: [...shape.volume, height],
  bedShape: shape.shape,
  nozzlesMm: [],
  materialIds: [],
  defaultMaterialId: null,
  zones: [],
  excludedAreasMm: [],
  notes: "",
  source: { kind: "imported", app, profileName: name.slice(0, 200) },
  basedOn: null,
});
export const parseBambuProfile = (
  json: unknown,
  id: string,
  app: "bambu-studio" | "orca-slicer" = "bambu-studio",
): PrinterProfileDraft => {
  const profile = record(json);
  if (
    first(profile.inherits) &&
    (!profile.printable_area || !profile.printable_height || !profile.nozzle_diameter)
  )
    throw new Error(
      `This profile inherits from "${first(profile.inherits)}", which Loom could not find on this host. Export it from the slicer as a full profile.`,
    );
  const shape = shapeFromPolygon(polygon(strings(profile.printable_area).join(",")));
  const height = number(profile.printable_height);
  if (height === null || height < 10 || height > 2000)
    throw new Error("The profile has no valid print height.");
  const printer = base(
    id,
    first(profile.name) ?? first(profile.printer_model) ?? "Imported printer",
    shape,
    height,
    app,
  );
  const areas = strings(profile.extruder_printable_area),
    heights = strings(profile.extruder_printable_height);
  const zones = areas.filter(Boolean).map((area, index) => {
    const zone = shapeFromPolygon(polygon(area));
    const zHeight = number(heights[index]);
    return {
      id: `nozzle-${index + 1}`,
      label: index === 0 ? "Left nozzle" : index === 1 ? "Right nozzle" : `Nozzle ${index + 1}`,
      footprintMm: zone.volume,
      offsetMm: [zone.origin[0] - shape.origin[0], zone.origin[1] - shape.origin[1]] as Point,
      ...(zHeight !== null && zHeight !== height ? { heightMm: zHeight } : {}),
    };
  });
  const excluded = strings(profile.bed_exclude_area).join(",");
  const excludedAreasMm = excluded?.trim()
    ? [polygon(excluded).map((p) => [p[0] - shape.origin[0], p[1] - shape.origin[1]] as Point)]
    : [];
  return {
    printer: { ...printer, nozzlesMm: nozzles(profile.nozzle_diameter), zones, excludedAreasMm },
    warnings: [
      ...shape.warnings,
      ...(excludedAreasMm.length ? ["Excluded areas are listed but not drawn."] : []),
    ],
  };
};
export const parsePrusaIni = (text: string, id: string): PrinterProfileDraft => {
  if (/^\s*\[(?:printer|print|filament):/m.test(text))
    throw new Error(
      "Export a single config from PrusaSlicer (File, Export, Export Config) and import that.",
    );
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^#;=[][^=]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]!.trim()] = match[2]!;
  }
  const shape = shapeFromPolygon(polygon(values.bed_shape));
  const height = number(values.max_print_height);
  if (height === null || height < 10 || height > 2000)
    throw new Error("The profile has no valid print height.");
  return {
    printer: {
      ...base(
        id,
        values.printer_settings_id || values.printer_model || "Imported Prusa printer",
        shape,
        height,
        "prusa-slicer",
      ),
      nozzlesMm: nozzles(values.nozzle_diameter),
    },
    warnings: shape.warnings,
  };
};
