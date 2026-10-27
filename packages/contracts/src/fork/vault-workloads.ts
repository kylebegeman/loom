import { ProviderInstanceId } from "../providerInstance.ts";
import * as Schema from "effect/Schema";
import {
  EnvironmentId,
  ThreadId,
  ProjectId,
  RunId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { VaultItemId } from "./vault-core.ts";
import { VaultBrokerPublicKey, VaultBrokerSignature, VaultBrokerNonce } from "./vault-brokers.ts";

const Time = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Destination = TrimmedNonEmptyString.check(Schema.isMaxLength(2048));
const reasons = {
  "not-configured":
    "No usable broker enrollment was found for this Loom server. Enroll its computer in Settings → Vault → Advanced → Credential brokers and keep the broker running.",
  "invalid-proof":
    "The workload proof is invalid, belongs to another context or has already been used.",
  expired:
    "This workload session or challenge has expired. Open a new session from the active Loom thread.",
  "host-offline":
    "The enrolled host needs a current heartbeat. Start or check its Loom Vault broker.",
  capacity:
    "Too many workload sessions or challenges are pending. Close unused sessions before retrying.",
  unavailable:
    "The workload channel is unavailable. Reconnect to the control plane and open a fresh session after a restart.",
} as const;
export class VaultWorkloadError extends Schema.TaggedError<VaultWorkloadError>()(
  "VaultWorkloadError",
  {
    reason: Schema.Literals(
      Object.keys(reasons) as [keyof typeof reasons, ...Array<keyof typeof reasons>],
    ),
  },
) {
  override get message() {
    return reasons[this.reason];
  }
}
export const VaultWorkloadOpen = Schema.Struct({
  machineId: VaultItemId,
  publicKey: VaultBrokerPublicKey,
  itemId: VaultItemId,
  destination: Destination,
});
export type VaultWorkloadOpen = typeof VaultWorkloadOpen.Type;
export const VaultWorkloadSession = Schema.Struct({
  protocol: Schema.Literal(1),
  id: VaultItemId,
  environmentId: EnvironmentId,
  machineId: VaultItemId,
  threadId: ThreadId,
  projectId: ProjectId,
  runId: RunId,
  providerInstanceId: ProviderInstanceId,
  itemId: VaultItemId,
  destination: Destination,
  publicKey: VaultBrokerPublicKey,
  expiresAt: Time,
});
export type VaultWorkloadSession = typeof VaultWorkloadSession.Type;
export const VaultWorkloadChallengeRequest = Schema.Struct({
  environmentId: EnvironmentId,
  sessionId: VaultItemId,
  requestId: VaultItemId,
  operation: Schema.Literals(["check", "release", "ssh-exec", "git-exec"]),
  payloadDigest: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  at: Time,
  machineSignature: VaultBrokerSignature,
  workloadSignature: VaultBrokerSignature,
});
export type VaultWorkloadChallengeRequest = typeof VaultWorkloadChallengeRequest.Type;
export const VaultWorkloadChallenge = Schema.Struct({
  protocol: Schema.Literal(1),
  environmentId: EnvironmentId,
  machineId: VaultItemId,
  sessionId: VaultItemId,
  requestId: VaultItemId,
  operation: Schema.Literals(["check", "release", "ssh-exec", "git-exec"]),
  payloadDigest: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  nonce: VaultBrokerNonce,
  expiresAt: Time,
});
export type VaultWorkloadChallenge = typeof VaultWorkloadChallenge.Type;
export const VaultWorkloadProof = Schema.Struct({
  challenge: VaultWorkloadChallenge,
  machineSignature: VaultBrokerSignature,
  workloadSignature: VaultBrokerSignature,
});
export type VaultWorkloadProof = typeof VaultWorkloadProof.Type;
export const VaultWorkloadCheck = Schema.Struct({
  session: VaultWorkloadSession,
  checkedAt: Time,
  credentialDelivery: Schema.Literal("unsupported"),
});
export const VaultWorkloadRelease = Schema.Struct({ released: Schema.Literal(true) });
export const vaultWorkloadRequestMessage = (
  input: Omit<VaultWorkloadChallengeRequest, "machineSignature" | "workloadSignature">,
) =>
  JSON.stringify([
    "loom-vault-workload-request-v1",
    input.environmentId,
    input.sessionId,
    input.requestId,
    input.operation,
    input.at,
    ...(input.operation === "ssh-exec" || input.operation === "git-exec"
      ? [input.payloadDigest ?? null]
      : []),
  ]);
export const vaultWorkloadProofMessage = (input: VaultWorkloadChallenge) =>
  JSON.stringify([
    "loom-vault-workload-proof-v1",
    input.protocol,
    input.environmentId,
    input.machineId,
    input.sessionId,
    input.requestId,
    input.operation,
    input.nonce,
    input.expiresAt,
    ...(input.operation === "ssh-exec" || input.operation === "git-exec"
      ? [input.payloadDigest ?? null]
      : []),
  ]);

export const VaultTerminalReadiness = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  runId: Schema.NullOr(RunId),
  checkedAt: Time,
  expiresAt: Time,
  activeRun: Schema.Boolean,
  brokerOnline: Schema.Boolean,
  credentialUse: Schema.Literals([
    "requires-selection-and-current-grant",
    "requires-selection-and-current-policy",
  ]),
});
export type VaultTerminalReadiness = typeof VaultTerminalReadiness.Type;
