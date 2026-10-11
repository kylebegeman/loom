import * as Schema from "effect/Schema";
import { CheckpointId, NonNegativeInt, PositiveInt, RunId, ThreadId } from "../baseSchemas.ts";
import type { ScadRenderResult, SignedFile } from "./model-preview-3d.ts";

export const MODEL_HISTORY_PAGE_MAX = 50;
const FileRef = Schema.Struct({
  threadId: ThreadId,
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
});
export const ModelHistoryInput = Schema.Struct({
  file: FileRef,
  cursor: Schema.optional(Schema.NullOr(PositiveInt)),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MODEL_HISTORY_PAGE_MAX })),
  ),
});
export const ModelHistoryVersion = Schema.Struct({
  checkpointId: CheckpointId,
  runId: Schema.NullOr(RunId),
  turn: NonNegativeInt,
  capturedAt: Schema.DateTimeUtc,
  present: Schema.Boolean,
  contentKey: Schema.NullOr(Schema.String),
  sizeBytes: Schema.NullOr(NonNegativeInt),
  changed: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
  resolvedAnnotations: Schema.Array(Schema.String).check(Schema.isMaxLength(30)),
});
export const ModelHistory = Schema.Struct({
  versions: Schema.Array(ModelHistoryVersion).check(Schema.isMaxLength(MODEL_HISTORY_PAGE_MAX)),
  nextCursor: Schema.NullOr(PositiveInt),
  latestTurn: Schema.NullOr(PositiveInt),
  current: Schema.Struct({ present: Schema.Boolean, contentKey: Schema.NullOr(Schema.String) }),
  threadRunning: Schema.Boolean,
  unavailable: Schema.NullOr(Schema.Literals(["not-git"])),
});
export const ModelHistoryVersionInput = Schema.Struct({
  file: FileRef,
  checkpointId: CheckpointId,
  allowLarge: Schema.optional(Schema.Boolean),
});
/** Construct after the existing render schemas to avoid an initialization cycle. */
export const historyVersionResultSchema = <
  S extends Schema.Top & { readonly Type: SignedFile },
  R extends Schema.Top & { readonly Type: ScadRenderResult },
>(
  signedFile: S,
  render: R,
) =>
  Schema.Struct({
    checkpointId: CheckpointId,
    status: Schema.Literals(["ok", "error", "cancelled"]),
    mesh: Schema.NullOr(signedFile),
    meshFormat: Schema.NullOr(Schema.Literals(["stl", "3mf", "obj", "glb", "gltf"])),
    render: Schema.NullOr(render),
    differingIncludes: Schema.Array(Schema.String).check(Schema.isMaxLength(200)),
  });
export const ModelHistoryRestoreInput = Schema.Struct({
  file: FileRef,
  checkpointId: CheckpointId,
  includeDependencies: Schema.Boolean,
  expectedContentKey: Schema.NullOr(Schema.String),
});
export const ModelHistoryRestoreResult = Schema.Struct({
  undoId: Schema.String,
  restored: Schema.Array(Schema.String),
});
export const ModelHistoryUndoInput = Schema.Struct({
  file: FileRef,
  undoId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});
export type ModelHistoryInput = typeof ModelHistoryInput.Type;
export type ModelHistoryVersion = typeof ModelHistoryVersion.Type;
export type ModelHistory = typeof ModelHistory.Type;
export type ModelHistoryVersionInput = typeof ModelHistoryVersionInput.Type;
export type ModelHistoryVersionResult = {
  readonly checkpointId: CheckpointId;
  readonly status: "ok" | "error" | "cancelled";
  readonly mesh: SignedFile | null;
  readonly meshFormat: "stl" | "3mf" | "obj" | "glb" | "gltf" | null;
  readonly render: ScadRenderResult | null;
  readonly differingIncludes: ReadonlyArray<string>;
};
export type ModelHistoryRestoreInput = typeof ModelHistoryRestoreInput.Type;
export type ModelHistoryRestoreResult = typeof ModelHistoryRestoreResult.Type;
export type ModelHistoryUndoInput = typeof ModelHistoryUndoInput.Type;
