import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

type BuildPlatePreset = {
  readonly label: string;
  readonly kind: "printer" | "surface";
  /** X, Y and Z in mm. A surface has no height limit, so its Z is null. */
  readonly volumeMm: readonly [number, number, number | null];
  readonly note: string | null;
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
    note: "Left nozzle: 325 × 320 × 320 mm. Right nozzle: 325 × 320 × 325 mm. Both nozzles: 300 × 320 × 320 mm.",
  },
  "bambu-h2c": {
    label: "Bambu Lab H2C",
    kind: "printer",
    volumeMm: [330, 320, 325],
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
  pattern: BuildPlatePattern.pipe(Schema.withDecodingDefault(Effect.succeed("grid-mm" as const))),
});

export type BuildPlatePresetId = typeof BuildPlatePresetId.Type;
export type BuildPlatePattern = typeof BuildPlatePattern.Type;
export type BuildPlateSetting = typeof BuildPlateSetting.Type;
