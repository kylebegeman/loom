import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, ThreadId } from "../baseSchemas.ts";

const text = (max = 200) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const list = <S extends Schema.Top>(item: S, max: number) =>
  Schema.Array(item).check(Schema.isMaxLength(max));
/** A length in millimetres: positive and below 10 mm, so a mil or inch slip is refused. */
const lengthMm = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThan(10));
const optionalLength = Schema.NullOr(lengthMm).pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
);

export const PcbFabTier = Schema.Literals(["standard", "advanced"]);
export const PcbFabId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,47}$/));

/** The shared fab capability entry (PCB-FOLLOW-UPS.md). All lengths in millimetres. */
export const PcbFabCapability = Schema.Struct({
  id: PcbFabId,
  name: text(80),
  tier: PcbFabTier,
  minTrackMm: lengthMm,
  minSpaceMm: lengthMm,
  minDrillMm: lengthMm,
  minAnnularRingMm: lengthMm,
  minViaMm: lengthMm, // smallest via pad diameter
  layerCounts: list(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })), 64),
  thicknessesMm: list(Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 10 })), 32),
  finishes: list(text(60), 16),
  notes: Schema.String.check(Schema.isMaxLength(2_000)),
  sourceUrl: Schema.String.check(Schema.isMaxLength(500)), // "" for none
  checkedOn: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  // Null means "not published"; the rule is skipped.
  minEdgeClearanceMm: optionalLength,
  minHoleToHoleMm: optionalLength,
});
export type PcbFabCapability = typeof PcbFabCapability.Type;

/** Stored user entries. Built-ins are not stored. */
export const PcbFabCapabilities = Schema.Struct({
  version: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  entries: list(PcbFabCapability, 24).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  defaultId: Schema.NullOr(PcbFabId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type PcbFabCapabilities = typeof PcbFabCapabilities.Type;

/** What clients and agents read: built-ins, user entries, and the resolved default. */
export const PcbFabCatalog = Schema.Struct({
  version: Schema.Int,
  builtIns: list(PcbFabCapability, 24),
  entries: list(PcbFabCapability, 24),
  defaultId: PcbFabId, // falls back to "jlcpcb-standard"
  skipped: list(text(200), 24), // stored entries that no longer decode, by id or index
});
export type PcbFabCatalog = typeof PcbFabCatalog.Type;

export const PcbFabCapabilitiesUpdate = Schema.Struct({
  expectedVersion: Schema.Int,
  entries: list(PcbFabCapability, 24),
  defaultId: Schema.NullOr(PcbFabId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type PcbFabCapabilitiesUpdate = typeof PcbFabCapabilitiesUpdate.Type;

export const PcbFabCheckInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1_024),
  fabId: Schema.optional(PcbFabId), // missing means the default
});
export type PcbFabCheckInput = typeof PcbFabCheckInput.Type;

export const PcbLatestFabCheckInput = PcbFabCheckInput;

export const PcbFabRule = Schema.Literals([
  "track",
  "space",
  "drill",
  "annular-ring",
  "via",
  "edge-clearance",
  "hole-to-hole",
]);

export const PcbFabViolationItem = Schema.Struct({
  description: Schema.String,
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
});
/** Same fields as PcbViolation, so L52's checkFindings accepts it, plus the fab rule. */
export const PcbFabViolation = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  description: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
  excluded: Schema.Boolean,
  group: Schema.Literals(["violation", "unconnected", "parity"]),
  items: Schema.Array(PcbFabViolationItem),
  rule: PcbFabRule,
  limitMm: Schema.optional(Schema.Number),
  measuredMm: Schema.optional(Schema.Number),
});

export const PcbFabBoardFinding = Schema.Struct({
  id: Schema.Literals(["layers", "thickness", "finish"]),
  severity: Schema.Literals(["error", "warning"]),
  message: text(400),
});

export const PcbFabFacts = Schema.Struct({
  copperLayers: NonNegativeInt,
  sizeMm: Schema.NullOr(Schema.Struct({ width: Schema.Number, height: Schema.Number })),
  areaMm2: Schema.NullOr(Schema.Number),
  thicknessMm: Schema.NullOr(Schema.Number),
  finish: Schema.NullOr(Schema.String),
  castellatedPads: NonNegativeInt,
  viaInPad: NonNegativeInt,
  /** Distinct via sizes, largest count first. */
  viaSizes: list(
    Schema.Struct({ drillMm: Schema.Number, diameterMm: Schema.Number, count: NonNegativeInt }),
    32,
  ),
  smallestPadDrillMm: Schema.NullOr(Schema.Number),
  largestPadDrillMm: Schema.optional(Schema.NullOr(Schema.Number)),
});

export const PcbFabCostDriver = Schema.Struct({
  id: text(64),
  title: text(200),
  detail: text(1_000),
  count: Schema.optional(NonNegativeInt),
  sourceUrl: Schema.optional(text(500)),
});

export const PcbFabCheckResult = Schema.Struct({
  fabId: PcbFabId,
  capability: PcbFabCapability, // the entry as checked, so later edits show as stale
  sourceHash: text(200),
  outcome: Schema.Literals(["clean", "violations", "failed", "timed-out"]),
  counts: Schema.Struct({
    errors: NonNegativeInt,
    warnings: NonNegativeInt,
    excluded: NonNegativeInt,
  }),
  violations: list(PcbFabViolation, 500), // sorted errors first, then rule
  truncated: Schema.Boolean,
  boardFindings: list(PcbFabBoardFinding, 8),
  notChecked: list(PcbFabRule, 8), // rules skipped because the value is null
  alsoInDrc: NonNegativeInt, // non-fab violations seen in the same run
  facts: Schema.NullOr(PcbFabFacts),
  costDrivers: list(PcbFabCostDriver, 24),
  zonesRefilled: Schema.Boolean,
  kicadVersion: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Int),
  log: Schema.String,
  ranAt: IsoDateTime,
});
export type PcbFabCheckResult = typeof PcbFabCheckResult.Type;

export const DEFAULT_FAB_ID = "jlcpcb-standard";

export type PcbFabFacts = typeof PcbFabFacts.Type;

export type PcbFabViolation = typeof PcbFabViolation.Type;

export type PcbFabBoardFinding = typeof PcbFabBoardFinding.Type;

export type PcbFabCostDriver = typeof PcbFabCostDriver.Type;

export type PcbFabRule = typeof PcbFabRule.Type;
