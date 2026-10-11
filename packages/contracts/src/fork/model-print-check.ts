import * as Schema from "effect/Schema";

const Vec3 = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]);

/** Bump when a rule or threshold changes; part of the cache key. */
export const PRINT_CHECK_VERSION = 1;
export const PRINT_CHECK_MAX_TRIANGLES = 3_000_000;
export const PRINT_CHECK_MAX_FINDINGS = 200;

export const PrintCheckId = Schema.Literals([
  "mesh",
  "shells",
  "bed-fit",
  "first-layer",
  "overhangs",
  "islands",
  "walls",
  "small-features",
]);
export const PrintSeverity = Schema.Literals(["info", "warn", "fail"]);
export const PrintCheckStatus = Schema.Literals(["pass", "info", "warn", "fail", "skipped"]);
export const PrintFindingCode = Schema.Literals([
  "EMPTY_GEOMETRY", // fail   mesh
  "OPEN_EDGES", // warn   mesh
  "NON_MANIFOLD_EDGES", // warn   mesh
  "FLIPPED_FACES", // warn   mesh
  "INVERTED_SHELL", // warn   mesh
  "DEGENERATE_TRIANGLES", // info   mesh
  "MULTIPLE_SHELLS", // info   shells
  "INTERNAL_SHELL", // warn   shells
  "EXCEEDS_BUILD_VOLUME", // fail   bed-fit
  "FITS_ROTATED", // info   bed-fit
  "SMALL_BED_CONTACT", // fail   first-layer
  "TALL_THIN", // warn   first-layer
  "OVERHANG_AREA", // warn   overhangs
  "UNSUPPORTED_ISLAND", // warn   islands
  "THIN_WALL", // warn   walls
  "FEATURE_BELOW_NOZZLE", // fail   small-features
]);

export const PrintFinding = Schema.Struct({
  /** Stable within one report: `${code}-${n}`, n from 1 in report order. */
  id: Schema.String,
  check: PrintCheckId,
  code: PrintFindingCode,
  severity: PrintSeverity,
  /** One sentence, ready to show, millimetres with one decimal ("Wall 0.6 mm thick"). */
  message: Schema.String,
  value: Schema.NullOr(Schema.Number),
  limit: Schema.NullOr(Schema.Number),
  unit: Schema.NullOr(Schema.Literals(["mm", "mm2", "mm3", "ratio", "count"])),
  /** Model space. Null only for findings about the whole part (empty file, shell count). */
  location: Schema.NullOr(
    Schema.Struct({ point: Vec3, normal: Schema.NullOr(Vec3), radiusMm: Schema.Number }),
  ),
});

export const PrintCheckReport = Schema.Struct({
  version: Schema.Int,
  /** "incomplete" when a stage hit its time budget; its check row says which. */
  status: Schema.Literals(["complete", "incomplete"]),
  verdict: Schema.Literals(["ready", "review", "blocked"]),
  geometryRevision: Schema.String,
  checkedAt: Schema.String,
  durationMs: Schema.Number,
  cached: Schema.Boolean,
  orientation: Schema.NullOr(
    Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]),
  ),
  summary: Schema.Struct({
    triangles: Schema.Int,
    vertices: Schema.Int,
    shells: Schema.Int,
    watertight: Schema.Boolean,
    volumeMm3: Schema.NullOr(Schema.Number), // null unless watertight
    surfaceAreaMm2: Schema.Number,
    sizeMm: Vec3, // oriented, axis aligned
    contactAreaMm2: Schema.Number,
    overhangAreaMm2: Schema.Number,
    /** 1st percentile of measured thickness; null when no ray found a wall within range. */
    minThicknessMm: Schema.NullOr(Schema.Number),
    thicknessSamples: Schema.Int,
  }),
  settings: Schema.Struct({
    nozzleMm: Schema.Number,
    nozzleSource: Schema.Literals(["printer", "setting"]),
    overhangAngleDegrees: Schema.Number,
    firstLayerMm: Schema.Number,
    minWallMm: Schema.Number, // 2 x nozzle
  }),
  bed: Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    fit: Schema.Literals(["fits", "fits-rotated", "too-big"]),
    overMm: Schema.NullOr(Vec3),
  }),
  checks: Schema.Array(
    Schema.Struct({
      check: PrintCheckId,
      status: PrintCheckStatus,
      summary: Schema.String, // "Thinnest wall 0.6 mm (needs 0.8 mm)"
      findings: Schema.Int, // located findings for this check, before truncation
    }),
  ),
  findings: Schema.Array(PrintFinding),
  truncated: Schema.Boolean,
  /** Worker stage timings, for diagnosing slow checks: parse, weld, topology, grid, ... */
  stages: Schema.Array(Schema.Struct({ name: Schema.String, ms: Schema.Number })),
});

export const PrintCheckResult = Schema.Struct({
  status: Schema.Literals(["ok", "cancelled"]),
  report: Schema.NullOr(PrintCheckReport),
});

/** Options shared by the RPC and the MCP tool. */
export const PrintCheckOptions = Schema.Struct({
  /** SCAD only: name -> OpenSCAD literal, as for renderScad. */
  overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  parameterSet: Schema.optional(Schema.NullOr(Schema.String)),
  /** Check files over maxFileMegabytes, like fileUrl's allowLarge. */
  allowLarge: Schema.optional(Schema.Boolean),
  /** Skip the cache. */
  force: Schema.optional(Schema.Boolean),
});

export type PrintFinding = typeof PrintFinding.Type;
export type PrintCheckReport = typeof PrintCheckReport.Type;
export type PrintCheckResult = typeof PrintCheckResult.Type;
export type PrintCheckOptions = typeof PrintCheckOptions.Type;
