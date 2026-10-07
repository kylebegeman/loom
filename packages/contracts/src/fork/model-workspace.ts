import * as Schema from "effect/Schema";
const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const finite = Schema.Number.check(Schema.isFinite());
export const ModelPoint = Schema.Tuple([finite, finite, finite]);
export const ModelSection = Schema.Struct({
  enabled: Schema.Boolean,
  axis: Schema.Literals(["x", "y", "z"]),
  offset: finite,
  flipped: Schema.Boolean,
});
export const ModelCamera = Schema.Struct({
  position: ModelPoint,
  target: ModelPoint,
  near: finite,
  far: finite,
  wireframe: Schema.Boolean,
  gridVisible: Schema.Boolean,
  axesVisible: Schema.Boolean,
  navigationMode: Schema.Literals(["orbit", "pan"]),
  section: ModelSection,
});
const values = Schema.Record(text(100), Schema.String.check(Schema.isMaxLength(2000))).check(
  Schema.isMaxProperties(256),
);
const identity = {
  id: text(100),
  name: text(100),
  sourceRevision: Schema.String.check(Schema.isMaxLength(200)),
};
export const ModelSavedView = Schema.Struct({ ...identity, camera: ModelCamera });
export const ModelMeasurement = Schema.Struct({
  ...identity,
  start: ModelPoint,
  end: ModelPoint,
  visible: Schema.Boolean,
});
export const ModelAnnotation = Schema.Struct({
  ...identity,
  points: Schema.Array(ModelPoint).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  referenceImage: Schema.NullOr(Schema.String.check(Schema.isMaxLength(50000))),
  request: text(4000),
  status: Schema.Literals(["open", "review", "accepted"]),
  reviewedRevision: Schema.NullOr(Schema.String),
  camera: ModelCamera,
  parameters: values,
});
export const ModelCapturePreset = Schema.Struct({
  id: text(100),
  name: text(100),
  viewIds: Schema.Array(text(100)).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
  includeMeasurements: Schema.Boolean,
});
export const ModelVariant = Schema.Struct({
  ...identity,
  values,
  thumbnail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(50000))),
  dimensions: Schema.NullOr(ModelPoint),
  triangles: Schema.NullOr(Schema.Int),
  renderedRevision: Schema.NullOr(Schema.String),
  origin: Schema.Literals(["user", "agent"]),
});
export const ModelWorkspace = Schema.Struct({
  views: Schema.Array(ModelSavedView).check(Schema.isMaxLength(30)),
  measurements: Schema.Array(ModelMeasurement).check(Schema.isMaxLength(100)),
  annotations: Schema.Array(ModelAnnotation).check(Schema.isMaxLength(30)),
  presets: Schema.Array(ModelCapturePreset).check(Schema.isMaxLength(20)),
  variants: Schema.Array(ModelVariant).check(Schema.isMaxLength(24)),
});
export const ModelWorkspaceOperation = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("view"), item: ModelSavedView }),
  Schema.Struct({ kind: Schema.Literal("measurement"), item: ModelMeasurement }),
  Schema.Struct({ kind: Schema.Literal("annotation"), item: ModelAnnotation }),
  Schema.Struct({ kind: Schema.Literal("preset"), item: ModelCapturePreset }),
  Schema.Struct({ kind: Schema.Literal("variant"), item: ModelVariant }),
  Schema.Struct({
    kind: Schema.Literal("remove"),
    collection: Schema.Literals(["views", "measurements", "annotations", "presets", "variants"]),
    id: text(100),
  }),
]);
export type ModelPoint = typeof ModelPoint.Type;
export type ModelSection = typeof ModelSection.Type;
export type ModelCamera = typeof ModelCamera.Type;
export type ModelSavedView = typeof ModelSavedView.Type;
export type ModelMeasurement = typeof ModelMeasurement.Type;
export type ModelAnnotation = typeof ModelAnnotation.Type;
export type ModelCapturePreset = typeof ModelCapturePreset.Type;
export type ModelVariant = typeof ModelVariant.Type;
export type ModelWorkspace = typeof ModelWorkspace.Type;
export type ModelWorkspaceOperation = typeof ModelWorkspaceOperation.Type;
export const EMPTY_MODEL_WORKSPACE: ModelWorkspace = {
  views: [],
  measurements: [],
  annotations: [],
  presets: [],
  variants: [],
};
