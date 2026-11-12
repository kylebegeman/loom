import * as Schema from "effect/Schema";
import { ProjectId, NonNegativeInt, PositiveInt } from "../baseSchemas.ts";
import {
  VaultProfile,
  VaultProfileResolution,
  VaultProfileDefinition,
  VaultProfilePreview,
} from "./vault-profiles.ts";

export const VaultProfileRegistryRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  activeProfileId: Schema.NullOr(Schema.String),
  profiles: Schema.Array(VaultProfile).check(Schema.isMaxLength(32)),
  receipts: Schema.Array(Schema.Struct({ id: Schema.String, fingerprint: Schema.String })).check(
    Schema.isMaxLength(32),
  ),
});
export const VaultProfileRunRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: Schema.String,
  threadId: Schema.String,
  runId: Schema.String,
  resolution: VaultProfileResolution,
  createdAt: Schema.optional(Schema.String),
});
export const VaultProfileRetiredRecord = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  environmentId: Schema.String,
  projectId: Schema.String,
  threadId: Schema.String,
  runId: Schema.String,
  createdAt: Schema.NullOr(Schema.String),
  retiredAt: Schema.String,
  operationId: Schema.String,
  actor: Schema.String,
});
export const VaultProfileRecordValue = Schema.Union([
  VaultProfileRegistryRecord,
  VaultProfileRunRecord,
  VaultProfileRetiredRecord,
]);
const RecordKey = Schema.String.check(Schema.isPattern(/^(?:registry|runs\/[a-f0-9]{64})$/u));
export const ACCOUNT_PROFILE_RECORD_ROUTE = "/api/loom/account/profile-record";
export const AccountProfileRecordRequest = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("preview"),
    projectId: ProjectId,
    profile: VaultProfileDefinition,
  }),
  Schema.Struct({ kind: Schema.Literal("read"), projectId: ProjectId, key: RecordKey }),
  Schema.Struct({ kind: Schema.Literal("keys"), projectId: ProjectId }),
  Schema.Struct({
    kind: Schema.Literal("write"),
    projectId: ProjectId,
    key: RecordKey,
    value: VaultProfileRecordValue,
    expectedVersion: NonNegativeInt,
  }),
]);
export type AccountProfileRecordRequest = typeof AccountProfileRecordRequest.Type;
export const AccountProfileRecordResponse = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("preview"), preview: VaultProfilePreview }),
  Schema.Struct({
    kind: Schema.Literal("read"),
    record: Schema.NullOr(Schema.Struct({ value: VaultProfileRecordValue, version: PositiveInt })),
  }),
  Schema.Struct({
    kind: Schema.Literal("keys"),
    keys: Schema.Array(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u))),
  }),
  Schema.Struct({ kind: Schema.Literal("write"), version: PositiveInt }),
]);
export type AccountProfileRecordResponse = typeof AccountProfileRecordResponse.Type;
export const AccountProfileRecordEnvelope = Schema.Struct({
  payload: Schema.String.check(Schema.isMaxLength(2 * 1024 * 1024)),
  proof: Schema.String.check(Schema.isMaxLength(16_384)),
});
