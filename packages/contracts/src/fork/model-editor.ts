import * as Schema from "effect/Schema";
import { ThreadId } from "../baseSchemas.ts";
import { ModelCamera, ModelSection, ModelVariant, ModelPoint } from "./model-workspace.ts";
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
  ]),
  enabled: Schema.optional(Schema.Boolean),
  index: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 79 }))),
  factor: Schema.optional(
    Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0.01, maximum: 100 })),
  ),
  name: Schema.optional(Schema.String),
  points: Schema.optional(
    Schema.Array(ModelPoint).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  ),
  request: Schema.optional(Schema.String.check(Schema.isMaxLength(8000))),
  values: Schema.optional(ModelVariant.fields.values),
  camera: Schema.optional(ModelCamera),
  section: Schema.optional(ModelSection),
  wireframe: Schema.optional(Schema.Boolean),
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
  inspector: Schema.NullOr(Schema.String),
  tool: Schema.NullOr(Schema.Literals(["measure", "annotate"])),
  pendingPoint: Schema.NullOr(ModelPoint),
  pendingRegion: Schema.NullOr(Schema.Array(ModelPoint).check(Schema.isMaxLength(64))),
  loading: Schema.Boolean,
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
  png: Schema.optional(Schema.String.check(Schema.isMaxLength(12 * 1024 * 1024))),
});
