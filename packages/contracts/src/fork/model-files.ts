import * as Schema from "effect/Schema";
import { ThreadId } from "../baseSchemas.ts";

export const ModelFileRef = Schema.Struct({
  threadId: ThreadId,
  /** Workspace-relative path. */
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
});

export const SignedFile = Schema.Struct({
  /** Relative to the environment's HTTP base URL; resolve with resolveAssetUrl. */
  relativeUrl: Schema.String,
  expiresAt: Schema.Number,
  sizeBytes: Schema.Number,
  modifiedAt: Schema.String,
  /** Changes whenever the bytes change; used as the viewer's cache key. */
  revision: Schema.String,
});

export const ScadRenderResult = Schema.Struct({
  status: Schema.Literals(["ok", "error", "cancelled"]),
  mesh: Schema.NullOr(SignedFile), // binary STL or 3MF
  meshFormat: Schema.NullOr(Schema.Literals(["stl", "3mf"])),
  cached: Schema.Boolean,
  durationMs: Schema.Number,
  log: Schema.Array(
    Schema.Struct({
      level: Schema.Literals(["echo", "warning", "error", "trace", "info"]),
      text: Schema.String,
    }),
  ),
  summary: Schema.NullOr(
    Schema.Struct({
      manifold: Schema.NullOr(Schema.Boolean),
      facets: Schema.NullOr(Schema.Int),
      vertices: Schema.NullOr(Schema.Int),
      boundingBox: Schema.NullOr(
        Schema.Struct({ min: Schema.Array(Schema.Number), max: Schema.Array(Schema.Number) }),
      ),
    }),
  ),
});

export type ModelFileRef = typeof ModelFileRef.Type;
export type SignedFile = typeof SignedFile.Type;
export type ScadRenderResult = typeof ScadRenderResult.Type;
