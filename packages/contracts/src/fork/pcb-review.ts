import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ThreadId, TrimmedNonEmptyString, NonNegativeInt, IsoDateTime } from "../baseSchemas.ts";
export const PcbReviewLocation = Schema.Struct({
  x: Schema.Number, // mm
  y: Schema.Number, // mm
  sheet: Schema.optional(Schema.String), // schematic sheet id, as in PcbLocation
  layer: Schema.optional(Schema.String), // board only
});
export const PcbReviewFinding = Schema.Struct({
  id: TrimmedNonEmptyString, // "review:<rule>:<hash>", stable across moves
  rule: TrimmedNonEmptyString,
  severity: Schema.Literals(["error", "warning", "info"]),
  message: Schema.String, // one sentence, product voice
  why: Schema.String, // what was seen: parts, pins, nets, values
  fix: Schema.String, // what usually resolves it
  parts: Schema.Array(Schema.String), // references, capped at 20
  nets: Schema.Array(Schema.String), // capped at 10
  schematic: Schema.optional(PcbReviewLocation),
  board: Schema.optional(PcbReviewLocation),
  waived: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  waiverNote: Schema.optional(Schema.String),
});
export const PcbReviewRuleRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: Schema.String,
  enabled: Schema.Boolean,
  /** Why an enabled rule did not run or ran with less data, e.g. "pin types unavailable". */
  limited: Schema.optional(Schema.String),
  findings: NonNegativeInt,
});
export const PcbReviewInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
});
export const PcbReviewResult = Schema.Struct({
  designKind: Schema.Literals(["kicad", "tscircuit"]),
  outcome: Schema.Literals(["clean", "findings", "failed"]),
  sourceHash: TrimmedNonEmptyString,
  /** Hash of rulesVersion, enabled rules and parameters; waivers are applied on read. */
  configHash: TrimmedNonEmptyString,
  rulesVersion: NonNegativeInt,
  counts: Schema.Struct({
    errors: NonNegativeInt,
    warnings: NonNegativeInt,
    info: NonNegativeInt,
    waived: NonNegativeInt,
  }),
  findings: Schema.Array(PcbReviewFinding), // capped at 500, sorted by severity then rule
  truncated: Schema.Boolean,
  rules: Schema.Array(PcbReviewRuleRun),
  notices: Schema.Array(Schema.String), // capped at 20
  log: Schema.String, // netlist export log on failure
  durationMs: NonNegativeInt,
  ranAt: IsoDateTime,
});
export const PcbLatestReviewResult = Schema.NullOr(PcbReviewResult);
const ParamValue = Schema.Union([Schema.Number, Schema.String]);
export const PcbReviewWaiver = Schema.Struct({
  designId: TrimmedNonEmptyString,
  findingId: TrimmedNonEmptyString,
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  at: IsoDateTime,
});
export const PcbReviewSettings = Schema.Struct({
  /** Overrides of each rule's default; unknown ids are kept and ignored. */
  rules: Schema.Record(Schema.String, Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  params: Schema.Record(Schema.String, Schema.Record(Schema.String, ParamValue)).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  waivers: Schema.Array(PcbReviewWaiver).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export const PcbReviewSettingsUpdate = Schema.Struct({
  rules: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  params: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, ParamValue))),
  waive: Schema.optional(
    Schema.Array(
      Schema.Struct({
        designId: TrimmedNonEmptyString,
        findingId: TrimmedNonEmptyString,
        note: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
      }),
    ).check(Schema.isMaxLength(100)),
  ),
  unwaive: Schema.optional(
    Schema.Array(
      Schema.Struct({ designId: TrimmedNonEmptyString, findingId: TrimmedNonEmptyString }),
    ).check(Schema.isMaxLength(100)),
  ),
});
export type PcbReviewResult = typeof PcbReviewResult.Type;
export type PcbReviewInput = typeof PcbReviewInput.Type;
export type PcbReviewFinding = typeof PcbReviewFinding.Type;
export type PcbReviewSettings = typeof PcbReviewSettings.Type;
export type PcbReviewLocation = typeof PcbReviewLocation.Type;
