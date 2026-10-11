import * as Schema from "effect/Schema";
import { ThreadId, CheckpointId } from "../baseSchemas.ts";
import {
  ModelCamera,
  ModelMeasurement,
  ModelOrientation,
  ModelSection,
  ModelVariant,
  ModelPoint,
  ModelProjection,
} from "./model-workspace.ts";
import { BedFitSummary } from "./model-beds.ts";
import { ScaleReference } from "./model-scale.ts";
export const ModelWall = Schema.Struct({
  thicknessMm: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  start: ModelPoint,
  end: ModelPoint,
});
export type ModelWall = typeof ModelWall.Type;
const text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024));
export const ModelEditorAction = Schema.Struct({
  action: Schema.Literals([
    "open",
    "close",
    "maximize",
    "fit",
    "zoom",
    "view",
    "camera",
    "display",
    "navigation",
    "section",
    "orientation",
    "wall-thickness",
    "tool",
    "inspector",
    "refresh",
    "capture",
    "load-view",
    "snapshot",
    "parameters",
    "parameter-history",
    "parameter-set",
    "parameter-preview",
    "prepare-request",
    "reselect-annotation",
    "cancel-tool",
    "pick",
    "save-annotation",
    "capture-annotation",
    "allow-large",
    "turn-history",
    "turn-compare",
    "explode",
    "isolate",
    "select-part",
    "layers",
  ]),
  enabled: Schema.optional(Schema.Boolean),
  layer: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  index: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 79 }))),
  factor: Schema.optional(
    Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0.01, maximum: 100 })),
  ),
  name: Schema.optional(Schema.String),
  points: Schema.optional(
    Schema.Array(ModelPoint).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  ),
  snap: Schema.optional(Schema.Boolean),
  snapRadius: Schema.optional(
    Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0.01, maximum: 50 })),
  ),
  measure: Schema.optional(Schema.Literals(["distance", "hole"])),
  request: Schema.optional(Schema.String.check(Schema.isMaxLength(8000))),
  values: Schema.optional(ModelVariant.fields.values),
  camera: Schema.optional(ModelCamera),
  section: Schema.optional(ModelSection),
  projection: Schema.optional(ModelProjection),
  reference: Schema.optional(ScaleReference),
  wireframe: Schema.optional(Schema.Boolean),
  overhangs: Schema.optional(Schema.Boolean),
  previous: Schema.optional(Schema.Boolean),
  findings: Schema.optional(Schema.Boolean),
  grid: Schema.optional(Schema.Boolean),
  axes: Schema.optional(Schema.Boolean),
  four: Schema.optional(Schema.Boolean),
  attachToDraft: Schema.optional(Schema.Boolean),
});
export type ModelEditorAction = typeof ModelEditorAction.Type;
export const ModelEditorInput = Schema.Struct({
  threadId: ThreadId,
  path: text,
  command: ModelEditorAction,
});
export const ModelEditorEvent = Schema.Struct({
  requestId: text,
  path: text,
  command: ModelEditorAction,
});
export const ModelEditorState = Schema.Struct({
  turnHistory: Schema.optionalKey(
    Schema.Struct({
      open: Schema.Boolean,
      viewing: Schema.NullOr(CheckpointId),
      viewingTurn: Schema.NullOr(Schema.Int),
      comparing: Schema.NullOr(CheckpointId),
      latestTurn: Schema.NullOr(Schema.Int),
    }),
  ),
  layers: Schema.optionalKey(
    Schema.Struct({
      shown: Schema.Boolean,
      index: Schema.Int,
      count: Schema.Int,
      zMm: Schema.NullOr(Schema.Number),
    }),
  ),
  assembly: Schema.optionalKey(
    Schema.Struct({
      selectedPartId: Schema.NullOr(Schema.String),
      isolatedPartId: Schema.NullOr(Schema.String),
      explode: Schema.Number,
    }),
  ),
  inspector: Schema.NullOr(Schema.String),
  tool: Schema.NullOr(Schema.Literals(["measure", "annotate", "lay-flat"])),
  orientation: Schema.optional(Schema.NullOr(ModelOrientation)),
  sectionCaps: Schema.optional(
    Schema.Literals(["none", "off", "checking", "filled", "partial", "open-mesh"]),
  ),
  measureMode: Schema.optional(Schema.Literals(["distance", "hole"])),
  pendingPoint: Schema.NullOr(ModelPoint),
  pendingRegion: Schema.NullOr(Schema.Array(ModelPoint).check(Schema.isMaxLength(64))),
  loading: Schema.Boolean,
  previous: Schema.optional(
    Schema.Struct({
      shown: Schema.Boolean,
      size: ModelPoint,
      sourceRevision: Schema.String,
    }),
  ),
  fit: Schema.optional(BedFitSummary),
  parameters: Schema.NullOr(
    Schema.Struct({
      values: ModelVariant.fields.values,
      applied: ModelVariant.fields.values,
      setName: Schema.NullOr(Schema.String),
      automatic: Schema.Boolean,
      hasUnapplied: Schema.Boolean,
      historyCursor: Schema.Int,
      history: Schema.Array(Schema.String).check(Schema.isMaxLength(80)),
    }),
  ),
});
export const ModelEditorResult = Schema.Struct({
  message: Schema.String,
  path: Schema.optional(Schema.String),
  camera: Schema.optional(ModelCamera),
  sourceRevision: Schema.optional(Schema.String),
  state: Schema.optional(ModelEditorState),
  measurement: Schema.optional(ModelMeasurement),
  wall: Schema.optional(ModelWall),
});
export const ModelEditorComplete = Schema.Struct({
  threadId: ThreadId,
  path: text,
  requestId: text,
  message: Schema.String,
  error: Schema.optional(Schema.Boolean),
  camera: Schema.optional(ModelCamera),
  sourceRevision: Schema.optional(Schema.String),
  state: Schema.optional(ModelEditorState),
  measurement: Schema.optional(ModelMeasurement),
  wall: Schema.optional(ModelWall),
  png: Schema.optional(Schema.String.check(Schema.isMaxLength(12 * 1024 * 1024))),
});
