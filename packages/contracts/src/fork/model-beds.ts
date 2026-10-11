import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type BedZone = {
  readonly id: string;
  readonly label: string;
  readonly footprintMm: readonly [number, number];
  /** From the bed's front-left corner, X right and Y back. */
  readonly offsetMm: readonly [number, number];
  /** Absent means the bed's height. */
  readonly heightMm?: number;
};

export type ZoneRect = {
  readonly offsetMm: readonly [number, number];
  readonly footprintMm: readonly [number, number];
};

type BuildPlatePreset = {
  readonly label: string;
  readonly kind: "printer" | "surface";
  /** X, Y and Z in mm. A surface has no height limit, so its Z is null. */
  readonly volumeMm: readonly [number, number, number | null];
  readonly note: string | null;
  readonly zones?: readonly BedZone[];
};

/**
 * Beds offered in the viewport, settings and the Part tab, in menu order: printers, then flat
 * surfaces to compare a part against. To add one, add an entry with a stable id: the setting
 * schema, menus and fit checks all read this table. Printer volumes are vendor build volumes.
 */
export const BUILD_PLATE_PRESETS = {
  "bambu-h2d": {
    label: "Bambu Lab H2D",
    kind: "printer",
    volumeMm: [350, 320, 325],
    zones: [
      {
        id: "left",
        label: "Left nozzle",
        footprintMm: [325, 320],
        offsetMm: [0, 0],
        heightMm: 320,
      },
      {
        id: "right",
        label: "Right nozzle",
        footprintMm: [325, 320],
        offsetMm: [25, 0],
        heightMm: 325,
      },
    ],
    note: "Left nozzle: 325 × 320 × 320 mm. Right nozzle: 325 × 320 × 325 mm. Both nozzles: 300 × 320 × 320 mm.",
  },
  "bambu-h2c": {
    label: "Bambu Lab H2C",
    kind: "printer",
    volumeMm: [330, 320, 325],
    zones: [
      {
        id: "left",
        label: "Left nozzle",
        footprintMm: [325, 320],
        offsetMm: [0, 0],
        heightMm: 320,
      },
      {
        id: "right",
        label: "Right nozzle",
        footprintMm: [305, 320],
        offsetMm: [25, 0],
        heightMm: 325,
      },
    ],
    note: "Left nozzle: 325 × 320 × 320 mm. Right nozzle: 305 × 320 × 325 mm. Both nozzles: 300 × 320 × 320 mm.",
  },
  "bambu-x1-p1-a1": {
    label: "Bambu Lab X1, P1, A1",
    kind: "printer",
    volumeMm: [256, 256, 256],
    note: null,
  },
  "bambu-a1-mini": {
    label: "Bambu Lab A1 mini",
    kind: "printer",
    volumeMm: [180, 180, 180],
    note: null,
  },
  "anycubic-kobra-s1": {
    label: "Anycubic Kobra S1",
    kind: "printer",
    volumeMm: [250, 250, 250],
    note: null,
  },
  "prusa-core-one": {
    label: "Prusa CORE One",
    kind: "printer",
    volumeMm: [250, 220, 270],
    note: null,
  },
  "prusa-mk4s": { label: "Prusa MK4S", kind: "printer", volumeMm: [250, 210, 220], note: null },
  "prusa-mini": { label: "Prusa MINI+", kind: "printer", volumeMm: [180, 180, 180], note: null },
  "creality-k1-max": {
    label: "Creality K1 Max",
    kind: "printer",
    volumeMm: [300, 300, 300],
    note: null,
  },
  "creality-ender-3-v3": {
    label: "Creality Ender-3 V3",
    kind: "printer",
    volumeMm: [220, 220, 250],
    note: null,
  },
  "sheet-a4": { label: "A4 sheet", kind: "surface", volumeMm: [297, 210, null], note: null },
  "sheet-letter": {
    label: "US Letter sheet",
    kind: "surface",
    volumeMm: [279.4, 215.9, null],
    note: null,
  },
  "mat-12in": {
    label: "12 in square",
    kind: "surface",
    volumeMm: [304.8, 304.8, null],
    note: null,
  },
  "plane-1m": { label: "1 m square", kind: "surface", volumeMm: [1000, 1000, null], note: null },
} as const satisfies Record<string, BuildPlatePreset>;

export const BuildPlatePresetId = Schema.Literals([
  ...(Object.keys(BUILD_PLATE_PRESETS) as (keyof typeof BUILD_PLATE_PRESETS)[]),
  "custom",
]);

/** The lines drawn on the bed: a 10 mm grid, a 1 in grid with quarter-inch lines, or only the outline. */
export const BuildPlatePattern = Schema.Literals(["grid-mm", "grid-inch", "plain"]);

export const BuildPlateSetting = Schema.Struct({
  preset: BuildPlatePresetId,
  /** Used only when preset is "custom"; each axis 10 to 2000 mm. */
  customMm: Schema.Tuple([
    Schema.Number.check(Schema.isBetween({ minimum: 10, maximum: 2000 })),
    Schema.Number.check(Schema.isBetween({ minimum: 10, maximum: 2000 })),
    Schema.Number.check(Schema.isBetween({ minimum: 10, maximum: 2000 })),
  ]),
  showZones: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  pattern: BuildPlatePattern.pipe(Schema.withDecodingDefault(Effect.succeed("grid-mm" as const))),
});

export type BuildPlatePresetId = typeof BuildPlatePresetId.Type;
export type BuildPlatePattern = typeof BuildPlatePattern.Type;
export type BuildPlateSetting = typeof BuildPlateSetting.Type;

/** X, Y and Z in mm. Z is null for a surface with no height limit. */
export type BedVolume = readonly [number, number, number | null];
export type Bed = {
  readonly id: string;
  readonly label: string;
  readonly kind: "printer" | "surface" | "custom";
  readonly volumeMm: BedVolume;
  readonly note: string | null;
  readonly zones?: readonly BedZone[];
};

/** Every bed the user can choose, in menu order: printers, surfaces, custom. */
export const listBeds = (setting: BuildPlateSetting): readonly Bed[] => [
  ...Object.entries(BUILD_PLATE_PRESETS).map(([id, preset]) => ({ id, ...preset })),
  { id: "custom", label: "Custom", kind: "custom", volumeMm: setting.customMm, note: null },
];

/** The bed the setting points at. Always one of listBeds(setting). */
export const activeBed = (setting: BuildPlateSetting): Bed => {
  const bed = listBeds(setting).find((bed) => bed.id === setting.preset);
  if (!bed) throw new RangeError(`Unknown bed: ${setting.preset}`);
  return bed;
};

/** Make a known bed active, keeping the pattern and custom dimensions. */
export const selectBed = (setting: BuildPlateSetting, id: string): BuildPlateSetting =>
  id === "custom" || Object.hasOwn(BUILD_PLATE_PRESETS, id)
    ? { ...setting, preset: id as BuildPlatePresetId }
    : setting;

export type BedFit =
  | { readonly status: "fits" }
  | { readonly status: "fits-rotated" }
  /** Overage per axis as placed, in mm; zero where the part fits. */
  | { readonly status: "too-big"; readonly overMm: readonly [number, number, number] };

const FIT_TOLERANCE_MM = 1e-6;

/** Check size as placed, then rotated 90 degrees about Z. Invalid dimensions throw. */
export const fitOnBed = (size: readonly [number, number, number], volume: BedVolume): BedFit => {
  if (
    size.length !== 3 ||
    [size[0], size[1], size[2]].some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new RangeError("Part dimensions must be three finite, nonnegative lengths in mm.");
  }
  if (
    volume.length !== 3 ||
    [volume[0], volume[1]].some((value) => !Number.isFinite(value) || value <= 0) ||
    (volume[2] !== null && (!Number.isFinite(volume[2]) || volume[2] <= 0))
  ) {
    throw new RangeError(
      "Bed dimensions must be finite, positive lengths, with null for unlimited height.",
    );
  }
  const heightFits = volume[2] === null || size[2] <= volume[2] + FIT_TOLERANCE_MM;
  if (
    heightFits &&
    size[0] <= volume[0] + FIT_TOLERANCE_MM &&
    size[1] <= volume[1] + FIT_TOLERANCE_MM
  ) {
    return { status: "fits" };
  }
  if (
    heightFits &&
    size[1] <= volume[0] + FIT_TOLERANCE_MM &&
    size[0] <= volume[1] + FIT_TOLERANCE_MM
  ) {
    return { status: "fits-rotated" };
  }
  return {
    status: "too-big",
    overMm: [
      Math.max(0, size[0] - volume[0]),
      Math.max(0, size[1] - volume[1]),
      volume[2] === null ? 0 : Math.max(0, size[2] - volume[2]),
    ],
  };
};

const lowestZoneHeight = (zones: readonly BedZone[], bedHeight: number | null) => {
  const heights = zones
    .map((zone) => zone.heightMm ?? bedHeight)
    .filter((height) => height !== null);
  return heights.length ? Math.min(...heights) : null;
};

/** The rectangle every nozzle reaches, at the lowest available nozzle height. */
export const sharedZone = (
  zones: readonly BedZone[],
  bedHeight: number | null,
): (ZoneRect & { readonly heightMm: number | null }) | null => {
  if (!zones.length) return null;
  const x = Math.max(...zones.map((zone) => zone.offsetMm[0]));
  const y = Math.max(...zones.map((zone) => zone.offsetMm[1]));
  const width = Math.min(...zones.map((zone) => zone.offsetMm[0] + zone.footprintMm[0])) - x;
  const depth = Math.min(...zones.map((zone) => zone.offsetMm[1] + zone.footprintMm[1])) - y;
  return width > FIT_TOLERANCE_MM && depth > FIT_TOLERANCE_MM
    ? {
        offsetMm: [x, y],
        footprintMm: [width, depth],
        heightMm: lowestZoneHeight(zones, bedHeight),
      }
    : null;
};

/** Each nozzle rectangle minus the shared rectangle, split into non-overlapping slabs. */
export const singleZoneStrips = (
  zones: readonly BedZone[],
): readonly (ZoneRect & { readonly zoneId: string })[] => {
  const common = sharedZone(zones, null);
  return zones.flatMap((zone) => {
    if (!common)
      return [{ zoneId: zone.id, offsetMm: zone.offsetMm, footprintMm: zone.footprintMm }];
    const [x, y] = zone.offsetMm;
    const [width, depth] = zone.footprintMm;
    const [cx, cy] = common.offsetMm;
    const [cw, cd] = common.footprintMm;
    const slabs: ZoneRect[] = [
      { offsetMm: [x, y], footprintMm: [cx - x, depth] },
      { offsetMm: [cx + cw, y], footprintMm: [x + width - cx - cw, depth] },
      { offsetMm: [cx, y], footprintMm: [cw, cy - y] },
      { offsetMm: [cx, cy + cd], footprintMm: [cw, y + depth - cy - cd] },
    ];
    return slabs
      .filter((slab) => slab.footprintMm.every((size) => size > FIT_TOLERANCE_MM))
      .map((slab) => ({ ...slab, zoneId: zone.id }));
  });
};

export type ZoneFit =
  | { readonly reach: "all-zones" }
  | { readonly reach: "one-zone"; readonly zoneIds: readonly string[] }
  | { readonly reach: "whole-bed" };
export type BedFitResult = {
  readonly fit: BedFit;
  readonly zone: ZoneFit | null;
  readonly withinMm: BedVolume;
};

/** Refine the outer volume by shared nozzle reach, single nozzles, then the whole plate. */
export const fitBed = (
  size: readonly [number, number, number],
  bed: { readonly volumeMm: BedVolume; readonly zones?: readonly BedZone[] },
): BedFitResult => {
  const zones = bed.zones;
  if (!zones?.length)
    return { fit: fitOnBed(size, bed.volumeMm), zone: null, withinMm: bed.volumeMm };
  const common = sharedZone(zones, bed.volumeMm[2]);
  const candidates: BedFitResult[] = [];
  if (common) {
    const withinMm: BedVolume = [...common.footprintMm, common.heightMm];
    const fit = fitOnBed(size, withinMm);
    const result = { fit, zone: { reach: "all-zones" as const }, withinMm };
    if (fit.status !== "too-big") return result;
    candidates.push(result);
  }
  const single = zones.map((zone) => {
    const withinMm: BedVolume = [...zone.footprintMm, zone.heightMm ?? bed.volumeMm[2]];
    return { fit: fitOnBed(size, withinMm), withinMm, id: zone.id };
  });
  const fitting = single.filter((candidate) => candidate.fit.status !== "too-big");
  if (fitting.length) {
    const selected = fitting.find((candidate) => candidate.fit.status === "fits") ?? fitting[0]!;
    return {
      fit: selected.fit,
      withinMm: selected.withinMm,
      zone: { reach: "one-zone", zoneIds: fitting.map((candidate) => candidate.id) },
    };
  }
  candidates.push(...single.map(({ fit, withinMm }) => ({ fit, withinMm, zone: null })));
  const withinMm: BedVolume = [
    bed.volumeMm[0],
    bed.volumeMm[1],
    lowestZoneHeight(zones, bed.volumeMm[2]),
  ];
  const fit = fitOnBed(size, withinMm);
  if (fit.status !== "too-big") return { fit, zone: { reach: "whole-bed" }, withinMm };
  candidates.push({ fit, zone: null, withinMm });
  const overage = (candidate: BedFitResult) =>
    candidate.fit.status === "too-big" ? candidate.fit.overMm.reduce((sum, mm) => sum + mm, 0) : 0;
  const closest = candidates.reduce((best, candidate) =>
    overage(candidate) < overage(best) ? candidate : best,
  );
  return { ...closest, zone: null };
};

const mm = Schema.Number.check(Schema.isFinite());
export const BedFitSummary = Schema.Struct({
  /** World-space part size in millimetres (X, Y, Z). */
  sizeMm: Schema.Tuple([mm, mm, mm]),
  activeBedId: Schema.String,
  beds: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      kind: Schema.Literals(["printer", "surface", "custom"]),
      volumeMm: Schema.Tuple([mm, mm, Schema.NullOr(mm)]),
      fit: Schema.Literals(["fits", "fits-rotated", "too-big"]),
      overMm: Schema.NullOr(Schema.Tuple([mm, mm, mm])),
      zone: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            reach: Schema.Literals(["all-zones", "one-zone", "whole-bed"]),
            zoneIds: Schema.Array(Schema.String),
          }),
        ),
      ),
    }),
  ).check(Schema.isMaxLength(64)),
});
export type BedFitSummary = typeof BedFitSummary.Type;

/** The same fit results for clients and agents, in bed menu order. */
export const bedFitSummary = (
  size: readonly [number, number, number],
  setting: BuildPlateSetting,
): BedFitSummary => ({
  sizeMm: size,
  activeBedId: activeBed(setting).id,
  beds: listBeds(setting).map((bed) => {
    const { fit, zone } = fitBed(size, bed);
    return {
      id: bed.id,
      label: bed.label,
      kind: bed.kind,
      volumeMm: bed.volumeMm,
      fit: fit.status,
      overMm: fit.status === "too-big" ? fit.overMm : null,
      ...(bed.zones?.length
        ? {
            zone: zone
              ? { reach: zone.reach, zoneIds: zone.reach === "one-zone" ? zone.zoneIds : [] }
              : null,
          }
        : {}),
    };
  }),
});
