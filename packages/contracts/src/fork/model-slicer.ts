import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ModelFileRef, SignedFile, ScadRenderResult } from "./model-files.ts";

export const SlicerApp = Schema.Literals(["bambu-studio", "orca-slicer", "prusa-slicer"]);
export type SlicerApp = typeof SlicerApp.Type;
export const SLICER_LABELS = {
  "bambu-studio": "Bambu Studio",
  "orca-slicer": "OrcaSlicer",
  "prusa-slicer": "PrusaSlicer",
} as const;
const profileName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
export const SlicerProfileRef = Schema.Struct({
  source: Schema.Literals(["installed", "imported"]),
  name: profileName,
});
export type SlicerProfileRef = typeof SlicerProfileRef.Type;
export const SlicerMapping = Schema.Struct({
  app: SlicerApp,
  machine: SlicerProfileRef,
  process: Schema.NullOr(SlicerProfileRef),
  filaments: Schema.Array(SlicerProfileRef).check(Schema.isMaxLength(16)),
  materialIds: Schema.optionalKey(
    Schema.Array(Schema.NullOr(Schema.String)).check(Schema.isMaxLength(16)),
  ),
});
export type SlicerMapping = typeof SlicerMapping.Type;
const nullPath = Schema.NullOr(Schema.String).pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
);
export const SlicerSettings = Schema.Struct({
  paths: Schema.Struct({
    "bambu-studio": nullPath,
    "orca-slicer": nullPath,
    "prusa-slicer": nullPath,
  }),
  timeoutSeconds: Schema.Int.check(Schema.isBetween({ minimum: 30, maximum: 1800 })),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  mappings: Schema.Record(Schema.String, SlicerMapping).check(Schema.isMaxProperties(64)),
});
export type SlicerSettings = typeof SlicerSettings.Type;
export const DEFAULT_SLICER_SETTINGS: SlicerSettings = {
  paths: { "bambu-studio": null, "orca-slicer": null, "prusa-slicer": null },
  timeoutSeconds: 300,
  currency: "USD",
  mappings: {},
};
export const SlicerInfo = Schema.Struct({
  app: SlicerApp,
  path: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  supported: Schema.Boolean,
});
export type SlicerInfo = typeof SlicerInfo.Type;
export const SliceInput = Schema.Struct({
  file: Schema.suspend(() => ModelFileRef),
  variantId: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  ),
  overrides: Schema.Record(Schema.String, Schema.String),
  parameterSet: Schema.NullOr(Schema.String),
  bedId: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
  cachedOnly: Schema.optionalKey(Schema.Boolean),
});
export type SliceInput = typeof SliceInput.Type;
export const SLICE_ROLES = [
  "outer-wall",
  "inner-wall",
  "infill",
  "solid-infill",
  "top",
  "bottom",
  "bridge",
  "support",
  "support-interface",
  "skirt",
  "other",
] as const;
export const SliceRole = Schema.Literals(SLICE_ROLES);
export type SliceRole = typeof SliceRole.Type;
const nonnegative = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const nullableNumber = Schema.NullOr(nonnegative);
export const PrintEstimate = Schema.Struct({
  printSeconds: nullableNumber,
  layerCount: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  filaments: Schema.Array(
    Schema.Struct({
      slot: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 15 })),
      type: Schema.NullOr(Schema.String),
      colorHex: Schema.NullOr(Schema.String),
      lengthMm: nullableNumber,
      grams: nullableNumber,
    }),
  ).check(Schema.isMaxLength(16)),
  totalGrams: nullableNumber,
  supportUsed: Schema.NullOr(Schema.Boolean),
  supportGrams: nullableNumber,
  cost: nullableNumber,
  currency: Schema.String,
});
export type PrintEstimate = typeof PrintEstimate.Type;
export const SliceResult = Schema.Struct({
  status: Schema.Literals(["ok", "error", "cancelled", "none"]),
  key: Schema.NullOr(Schema.String),
  cached: Schema.Boolean,
  durationMs: nonnegative,
  bedId: Schema.String,
  app: Schema.NullOr(SlicerApp),
  appVersion: Schema.NullOr(Schema.String),
  profiles: Schema.NullOr(
    Schema.Struct({
      machine: Schema.String,
      process: Schema.NullOr(Schema.String),
      filaments: Schema.Array(Schema.String).check(Schema.isMaxLength(16)),
    }),
  ),
  estimate: Schema.NullOr(PrintEstimate),
  orientationApplied: Schema.NullOr(Schema.Boolean),
  warnings: Schema.Array(Schema.String).check(Schema.isMaxLength(50)),
  log: Schema.suspend(() => ScadRenderResult.fields.log),
  project: Schema.NullOr(Schema.suspend(() => SignedFile)),
  layers: Schema.NullOr(
    Schema.Struct({
      file: Schema.suspend(() => SignedFile),
      layerCount: Schema.Int,
      segmentCount: Schema.Int,
      decimated: Schema.Boolean,
    }),
  ),
});
export type SliceResult = typeof SliceResult.Type;
export const SlicerProfileEntry = Schema.Struct({
  name: profileName,
  source: Schema.Literals(["system", "user", "imported"]),
  nozzleMm: Schema.NullOr(nonnegative),
  printerModel: Schema.NullOr(Schema.String),
});
export type SlicerProfileEntry = typeof SlicerProfileEntry.Type;
export const SlicerProfileList = Schema.Struct({
  app: SlicerApp,
  version: Schema.NullOr(Schema.String),
  machines: Schema.Array(SlicerProfileEntry).check(Schema.isMaxLength(1000)),
  processes: Schema.Array(SlicerProfileEntry).check(Schema.isMaxLength(1000)),
  filaments: Schema.Array(SlicerProfileEntry).check(Schema.isMaxLength(1000)),
});
export type SlicerProfileList = typeof SlicerProfileList.Type;
export const ImportSlicerProfile = Schema.Struct({
  app: SlicerApp,
  kind: Schema.Literals(["machine", "process", "filament", "config"]),
  fileName: profileName,
  text: Schema.String.check(Schema.isMaxLength(2 * 1024 * 1024)),
});
export type ImportSlicerProfile = typeof ImportSlicerProfile.Type;
export const DEFAULT_BAMBU_MAPPINGS: Readonly<Record<string, SlicerMapping>> = Object.fromEntries(
  [
    ["bambu-h2d", "Bambu Lab H2D 0.4 nozzle", "H2D"],
    ["bambu-h2c", "Bambu Lab H2C 0.4 nozzle", "H2C"],
    ["bambu-x1-p1-a1", "Bambu Lab X1 Carbon 0.4 nozzle", "X1C"],
    ["bambu-a1-mini", "Bambu Lab A1 mini 0.4 nozzle", "A1M"],
  ].map(([id, machine, suffix]) => [
    id,
    {
      app: "bambu-studio" as const,
      machine: { source: "installed" as const, name: machine! },
      process: { source: "installed" as const, name: `0.20mm Standard @BBL ${suffix}` },
      filaments: [{ source: "installed" as const, name: `Bambu PLA Basic @BBL ${suffix}` }],
    },
  ]),
);
