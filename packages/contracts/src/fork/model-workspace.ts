import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const finite = Schema.Number.check(Schema.isFinite());
export const ModelPoint = Schema.Tuple([finite, finite, finite]);
export const ModelSection = Schema.Struct({
  enabled: Schema.Boolean,
  axis: Schema.Literals(["x", "y", "z"]),
  offset: finite,
  flipped: Schema.Boolean,
  caps: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export const ModelProjection = Schema.Literals(["perspective", "orthographic"]);
export type ModelProjection = typeof ModelProjection.Type;
export const ModelCamera = Schema.Struct({
  projection: ModelProjection.pipe(
    Schema.withDecodingDefault(Effect.succeed("perspective" as const)),
  ),
  position: ModelPoint,
  target: ModelPoint,
  near: finite,
  far: finite,
  wireframe: Schema.Boolean,
  overhangs: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
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
export const ModelQuaternion = Schema.Tuple([finite, finite, finite, finite]);
export type ModelQuaternion = typeof ModelQuaternion.Type;
/** Rotation about the part's bounding-box centre, in x, y, z, w order. */
export const ModelOrientation = Schema.Struct({
  quaternion: ModelQuaternion,
  sourceRevision: identity.sourceRevision,
});
export type ModelOrientation = typeof ModelOrientation.Type;
const unitQuaternion = ModelQuaternion.check(
  Schema.makeFilter(([x, y, z, w]) => Math.abs(Math.hypot(x, y, z, w) - 1) < 1e-3, {
    message: "Use a unit quaternion [x, y, z, w].",
  }),
);
/** Stored values are normalized on use so an old row cannot break the workspace. */
export function normalizeQuaternion(q: ModelQuaternion): ModelQuaternion {
  const scale = Math.max(...q.map(Math.abs));
  if (!scale || !Number.isFinite(scale)) return [0, 0, 0, 1];
  const scaled = q.map((value) => value / scale);
  const length = Math.hypot(...scaled) * (q[3] < 0 ? -1 : 1);
  return [scaled[0]! / length, scaled[1]! / length, scaled[2]! / length, scaled[3]! / length];
}
/** Row-major rotation matrix shared by browser previews and server renders. */
export function quaternionMatrix(q: ModelQuaternion) {
  const [x, y, z, w] = normalizeQuaternion(q);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ] as const;
}
export const ModelSavedView = Schema.Struct({ ...identity, camera: ModelCamera });
export const ModelCircle = Schema.Struct({
  center: ModelPoint,
  normal: ModelPoint,
  diameter: finite.check(Schema.isGreaterThan(0)),
  sides: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 3, maximum: 128 }))),
});
export type ModelCircle = typeof ModelCircle.Type;
export const ModelMeasurement = Schema.Struct({
  ...identity,
  kind: Schema.Literals(["distance", "circle"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("distance" as const)),
  ),
  circle: Schema.optional(ModelCircle),
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
  orientation: Schema.NullOr(ModelOrientation).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  views: Schema.Array(ModelSavedView).check(Schema.isMaxLength(30)),
  measurements: Schema.Array(ModelMeasurement).check(Schema.isMaxLength(100)),
  annotations: Schema.Array(ModelAnnotation).check(Schema.isMaxLength(30)),
  presets: Schema.Array(ModelCapturePreset).check(Schema.isMaxLength(20)),
  variants: Schema.Array(ModelVariant).check(Schema.isMaxLength(24)),
});
export const ModelWorkspaceOperation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("orientation"),
    item: Schema.NullOr(
      Schema.Struct({ quaternion: unitQuaternion, sourceRevision: identity.sourceRevision }),
    ),
  }),
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
  orientation: null,
  views: [],
  measurements: [],
  annotations: [],
  presets: [],
  variants: [],
};
