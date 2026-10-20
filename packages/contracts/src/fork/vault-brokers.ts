import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { VaultError, VaultItemId } from "./vault-core.ts";

const Time = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Label = TrimmedNonEmptyString.check(Schema.isMaxLength(120));
export const VaultBrokerPublicKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9+/]{59}=$/));
export const VaultBrokerPlatform = Schema.Literals(["darwin", "linux"]);
export const VaultBrokerFingerprint = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const VaultBrokerNonce = VaultBrokerFingerprint;
export const VaultBrokerSignature = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9+/]{86}==$/));
const reasons = {
  "invalid-proof": "The broker identity proof is invalid or has already been used.",
  expired: "This broker challenge has expired. Create a new invitation or retry the heartbeat.",
  disabled: "This broker identity is disabled. Enroll a new identity to restore access.",
  "approval-pending":
    "The broker has claimed its invitation and is waiting for administrator approval.",
  capacity: "The broker registry is full. Cancel unused invitations before trying again.",
  "local-state":
    "The broker identity directory must be private, outside projects and readable only by its owner.",
  unsupported:
    "This broker mode supports macOS and Linux foreground services. Automatic boot setup is not installed.",
  configuration: "Use an HTTPS Loom server origin, or loopback HTTP for isolated development.",
  unavailable:
    "The broker could not contact its Loom control plane. No new access is available offline.",
} as const;
export class VaultBrokerError extends Schema.TaggedError<VaultBrokerError>()("VaultBrokerError", {
  reason: Schema.Literals(
    Object.keys(reasons) as [keyof typeof reasons, ...Array<keyof typeof reasons>],
  ),
}) {
  override get message() {
    return reasons[this.reason];
  }
}
export const VaultBrokerMachine = Schema.Struct({
  id: VaultItemId,
  label: Label,
  platform: VaultBrokerPlatform,
  publicKey: VaultBrokerPublicKey,
  fingerprint: VaultBrokerFingerprint,
  state: Schema.Literals(["active", "disabled"]),
  revision: PositiveInt,
  approvedBy: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  approvedAt: Time,
  lastSeenAt: Schema.NullOr(Time),
  leaseUntil: Time,
});
export type VaultBrokerMachine = typeof VaultBrokerMachine.Type;
export const VaultBrokerEnrollment = Schema.Struct({
  id: VaultItemId,
  label: Label,
  platform: VaultBrokerPlatform,
  publicKey: VaultBrokerPublicKey,
  fingerprint: VaultBrokerFingerprint,
  state: Schema.Literals(["waiting-for-claim", "awaiting-approval"]),
  expiresAt: Time,
});
export type VaultBrokerEnrollment = typeof VaultBrokerEnrollment.Type;
export const VaultBrokerInvitation = Schema.Struct({
  protocol: Schema.Literal(1),
  environmentId: TrimmedNonEmptyString,
  enrollmentId: VaultItemId,
  nonce: VaultBrokerNonce,
  fingerprint: VaultBrokerFingerprint,
  expiresAt: Time,
});
export type VaultBrokerInvitation = typeof VaultBrokerInvitation.Type;
export const VaultBrokerBegin = Schema.Struct({
  operationId: VaultItemId,
  expectedRevision: NonNegativeInt,
  publicKey: VaultBrokerPublicKey,
  label: Label,
  platform: VaultBrokerPlatform,
});
export type VaultBrokerBegin = typeof VaultBrokerBegin.Type;
export const VaultBrokerMutation = Schema.Struct({
  operationId: VaultItemId,
  expectedRevision: NonNegativeInt,
  change: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("approve"),
      enrollmentId: VaultItemId,
      fingerprint: VaultBrokerFingerprint,
    }),
    Schema.Struct({ type: Schema.Literal("cancel"), enrollmentId: VaultItemId }),
    Schema.Struct({ type: Schema.Literal("disable"), machineId: VaultItemId }),
  ]),
});
export type VaultBrokerMutation = typeof VaultBrokerMutation.Type;
export const VaultBrokerEvent = Schema.Struct({
  id: VaultItemId,
  at: Time,
  actor: Schema.String.check(Schema.isMaxLength(256)),
  kind: Schema.Literals(["invited", "claimed", "approved", "cancelled", "disabled", "renewed"]),
  machineId: VaultItemId,
});
export const VaultBrokerSnapshot = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  revision: NonNegativeInt,
  machines: Schema.Array(VaultBrokerMachine).check(Schema.isMaxLength(64)),
  enrollments: Schema.Array(VaultBrokerEnrollment).check(Schema.isMaxLength(16)),
  events: Schema.Array(VaultBrokerEvent).check(Schema.isMaxLength(128)),
  omittedEvents: NonNegativeInt,
});
export type VaultBrokerSnapshot = typeof VaultBrokerSnapshot.Type;
export const VaultBrokerMutationResult = Schema.Struct({
  revision: NonNegativeInt,
  machine: Schema.NullOr(VaultBrokerMachine),
});
export type VaultBrokerMutationResult = typeof VaultBrokerMutationResult.Type;
export const VaultBrokerClaim = Schema.Struct({
  invitation: VaultBrokerInvitation,
  signature: VaultBrokerSignature,
});
export type VaultBrokerClaim = typeof VaultBrokerClaim.Type;
export const VaultBrokerClaimResult = Schema.Struct({
  machineId: VaultItemId,
  state: Schema.Literal("awaiting-approval"),
});
export const VaultBrokerHeartbeatChallenge = Schema.Struct({
  protocol: Schema.Literal(1),
  environmentId: TrimmedNonEmptyString,
  machineId: VaultItemId,
  requestId: VaultItemId,
  operation: Schema.Literal("heartbeat"),
  nonce: VaultBrokerNonce,
  expiresAt: Time,
});
export type VaultBrokerHeartbeatChallenge = typeof VaultBrokerHeartbeatChallenge.Type;
export const VaultBrokerHeartbeat = Schema.Struct({
  challenge: VaultBrokerHeartbeatChallenge,
  signature: VaultBrokerSignature,
});
export type VaultBrokerHeartbeat = typeof VaultBrokerHeartbeat.Type;
export const VaultBrokerHeartbeatResult = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  machineId: VaultItemId,
  leaseUntil: Time,
  renewAfter: Time,
  credentialDelivery: Schema.Literal("unsupported"),
});
export type VaultBrokerHeartbeatResult = typeof VaultBrokerHeartbeatResult.Type;
export const VaultBrokerChallengeRequest = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  machineId: VaultItemId,
  requestId: VaultItemId,
  at: Time,
  signature: VaultBrokerSignature,
});
export type VaultBrokerChallengeRequest = typeof VaultBrokerChallengeRequest.Type;
export const vaultBrokerChallengeMessage = (
  input: Omit<VaultBrokerChallengeRequest, "signature">,
) =>
  JSON.stringify([
    "loom-vault-broker-challenge-v1",
    input.environmentId,
    input.machineId,
    input.requestId,
    input.at,
  ]);
export const VAULT_BROKER_WS_METHODS = {
  snapshot: "loom.vault-brokers.snapshot",
  begin: "loom.vault-brokers.begin",
  apply: "loom.vault-brokers.apply",
} as const;
const failure = Schema.Union([VaultError, VaultBrokerError, EnvironmentAuthorizationError]);
export const VaultBrokerRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_BROKER_WS_METHODS.snapshot, {
    payload: Schema.Struct({}),
    success: VaultBrokerSnapshot,
    error: failure,
  }),
  Rpc.make(VAULT_BROKER_WS_METHODS.begin, {
    payload: VaultBrokerBegin,
    success: VaultBrokerInvitation,
    error: failure,
  }),
  Rpc.make(VAULT_BROKER_WS_METHODS.apply, {
    payload: VaultBrokerMutation,
    success: VaultBrokerMutationResult,
    error: failure,
  }),
);

export const vaultBrokerClaimMessage = (invite: VaultBrokerInvitation) =>
  JSON.stringify([
    "loom-vault-broker-enrollment-v1",
    invite.environmentId,
    invite.enrollmentId,
    invite.nonce,
    invite.fingerprint,
    invite.expiresAt,
  ]);
export const vaultBrokerHeartbeatMessage = (challenge: VaultBrokerHeartbeatChallenge) =>
  JSON.stringify([
    "loom-vault-broker-heartbeat-v1",
    challenge.environmentId,
    challenge.machineId,
    challenge.requestId,
    challenge.operation,
    challenge.nonce,
    challenge.expiresAt,
  ]);
