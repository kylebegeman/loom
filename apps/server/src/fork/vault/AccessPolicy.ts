import { ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import {
  VaultApprovalRequest,
  VaultApprovalRetryInput,
  VaultAuditEvent,
  VaultGrant,
  VaultItemId,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const Counter = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const Revision = Counter.check(Schema.isGreaterThan(0));
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Actor = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.makeFilter(
    (value) =>
      value.trim() === value &&
      [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
  ),
);
const StoredApproval = Schema.Struct({
  request: VaultApprovalRequest,
  fingerprint: Schema.String,
  lastOperation: Schema.NullOr(Schema.Struct({ id: Schema.String, fingerprint: Schema.String })),
});
const fields = {
  approvals: Schema.optionalKey(Schema.Array(StoredApproval).check(Schema.isMaxLength(128))),
  revision: Counter,
  grants: Schema.Array(VaultGrant).check(Schema.isMaxLength(128)),
  audit: Schema.Array(VaultAuditEvent).check(Schema.isMaxLength(256)),
  omittedAuditEvents: Counter,
  receipts: Schema.Array(
    Schema.Struct({ id: Schema.String, fingerprint: Schema.String, result: VaultGrant }),
  ).check(Schema.isMaxLength(32)),
};
// This is the pre-protection codec: optional fields cannot make its evaluators protection-aware.
export const LegacyPolicy = Schema.Struct({ schemaVersion: Schema.Literals([1, 2, 3]), ...fields });
export const CredentialMode = Schema.Struct({
  itemId: VaultItemId,
  mode: Schema.Literals(["ordinary", "one-time"]),
  revision: Revision,
  updatedBy: Actor,
  updatedAt: Counter,
});
export const IntentBinding = Schema.Struct({
  environmentId: Actor,
  itemId: VaultItemId,
  itemVersion: Revision,
  modeRevision: Revision,
  requestId: VaultItemId,
  requestRevision: Revision,
  waitingOperationId: VaultItemId,
  threadId: ThreadId,
  projectId: ProjectId,
  runId: RunId,
  action: Schema.Literal("use"),
  destination: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  adapter: Schema.Literals(["ssh", "git-ssh", "github-api"]),
  operationDigest: Digest,
  grantId: VaultItemId,
  grantRevision: Revision,
});
export const OperationIntent = Schema.Struct({
  id: VaultItemId,
  binding: IntentBinding,
  revision: Revision,
  reviewedBy: Actor.check(Schema.makeFilter((value) => !value.startsWith("thread:"))),
  reviewedAt: Counter,
  expiresAt: Counter,
  updatedAt: Counter,
  state: Schema.Literals(["reviewed", "reserved", "revoked", "expired", "completed", "unknown"]),
  reservationId: Schema.NullOr(VaultItemId),
}).check(
  Schema.makeFilter(
    (value) =>
      value.expiresAt > value.reviewedAt &&
      value.expiresAt <= value.reviewedAt + 300_000 &&
      value.updatedAt >= value.reviewedAt &&
      (value.state === "reviewed" || value.state === "revoked" || value.state === "expired"
        ? value.reservationId === null
        : value.reservationId !== null),
  ),
);
export type OperationIntent = typeof OperationIntent.Type;
export const ProtectedPolicy = Schema.Struct({
  ...fields,
  schemaVersion: Schema.Literal(4),
  environmentId: Actor,
  credentialModes: Schema.Array(CredentialMode).check(Schema.isMaxLength(128)),
  intents: Schema.Array(OperationIntent).check(Schema.isMaxLength(128)),
}).check(
  Schema.makeFilter(
    (value) =>
      new Set(value.credentialModes.map((entry) => entry.itemId)).size ===
        value.credentialModes.length &&
      new Set(value.intents.map((entry) => entry.id)).size === value.intents.length &&
      new Set(value.intents.map((entry) => entry.binding.requestId)).size ===
        value.intents.length &&
      new Set(value.intents.flatMap((entry) => (entry.reservationId ? [entry.reservationId] : [])))
        .size === value.intents.filter((entry) => entry.reservationId !== null).length &&
      value.intents.every(
        (entry) =>
          entry.binding.environmentId === value.environmentId &&
          value.credentialModes.some(
            (mode) =>
              mode.itemId === entry.binding.itemId &&
              mode.mode === "one-time" &&
              mode.revision === entry.binding.modeRevision,
          ),
      ),
  ),
);
export type ProtectedPolicy = typeof ProtectedPolicy.Type;
export type Policy = typeof LegacyPolicy.Type | ProtectedPolicy;
const legacy = Schema.decodeUnknownOption(LegacyPolicy);
const protectedPolicy = Schema.decodeUnknownOption(ProtectedPolicy, { onExcessProperty: "error" });
export const decodePolicy = (input: unknown): Option.Option<Policy> => {
  const modern = protectedPolicy(input);
  const decoded: Option.Option<Policy> = Option.isSome(modern) ? modern : legacy(input);
  if (Option.isNone(decoded)) return decoded;
  const policy = decoded.value;
  if (
    new Set(policy.grants.map((grant) => grant.definition.id)).size !== policy.grants.length ||
    new Set(policy.approvals?.map((entry) => entry.request.id)).size !==
      (policy.approvals?.length ?? 0)
  )
    return Option.none();
  return decoded;
};
export const encodePolicy = Schema.encodeEffect(Schema.Union([LegacyPolicy, ProtectedPolicy]));
export const credentialUseRefusal = (policy: Policy, itemId: string) => {
  if (policy.schemaVersion !== 4) return null;
  const mode = policy.credentialModes.find((entry) => entry.itemId === itemId);
  return !mode
    ? ("classification-required" as const)
    : mode.mode === "one-time"
      ? ("approval-required" as const)
      : null;
};
export const IntentProposal = Schema.Struct({
  requestId: VaultItemId,
  expectedRequestRevision: Revision,
  waitingOperationId: VaultItemId,
  operation: VaultApprovalRetryInput.fields.operation,
});
export type IntentProposal = typeof IntentProposal.Type;
export const IntentReview = Schema.Struct({
  ...IntentProposal.fields,
  id: VaultItemId,
  expectedPolicyRevision: Counter,
  reviewedDigest: Digest,
  expiresAt: Counter,
});
export type IntentReview = typeof IntentReview.Type;
export const ModeChange = Schema.Struct({
  itemId: VaultItemId,
  itemVersion: Revision,
  expectedPolicyRevision: Counter,
  mode: CredentialMode.fields.mode,
});
export type ModeChange = typeof ModeChange.Type;
export const MigrationSelection = Schema.Struct({
  itemId: VaultItemId,
  itemVersion: Revision,
  mode: CredentialMode.fields.mode,
});

export type MigrationSelection = typeof MigrationSelection.Type;
export type IntentObservation = {
  readonly intent: OperationIntent;
  readonly checkedAt: number;
  readonly canExecute: false;
  readonly automaticResumption: false;
  readonly allowOnceConsumption: false;
};
export const IntentReservation = Schema.Struct({
  ...IntentProposal.fields,
  id: VaultItemId,
  expectedIntentRevision: Revision,
  expectedPolicyRevision: Counter,
});
export type IntentReservation = typeof IntentReservation.Type;
export const IntentClose = Schema.Struct({
  id: VaultItemId,
  expectedIntentRevision: Revision,
  expectedPolicyRevision: Counter,
});
export type IntentClose = typeof IntentClose.Type;
export const MigrationPreviewInput = Schema.Struct({
  expectedPolicyRevision: Counter,
  selections: Schema.Array(MigrationSelection).check(Schema.isMaxLength(128)),
});
export type MigrationPreviewInput = typeof MigrationPreviewInput.Type;
