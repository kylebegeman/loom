import * as Schema from "effect/Schema";
import { VaultProfile, VaultProfileResolution } from "@t3tools/contracts/fork";

export const Registry = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  activeProfileId: Schema.NullOr(Schema.String),
  profiles: Schema.Array(VaultProfile).check(Schema.isMaxLength(32)),
  receipts: Schema.Array(Schema.Struct({ id: Schema.String, fingerprint: Schema.String })).check(
    Schema.isMaxLength(32),
  ),
});
export const Pin = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: Schema.String,
  threadId: Schema.String,
  runId: Schema.String,
  resolution: VaultProfileResolution,
  createdAt: Schema.optional(Schema.String),
});
export const encodeRunKey = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ threadId: Schema.String, runId: Schema.NullOr(Schema.String) }),
  ),
);
