import * as Schema from "effect/Schema";
import {
  AuthSessionId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "../index.ts";

export const ACCOUNT_VAULT_RELAY_ROUTE = "/api/loom/account/vault/relay";
export const ACCOUNT_VAULT_VERIFY_ROUTE = "/api/loom/account/vault/verify";
export const ACCOUNT_VAULT_STATUS_ROUTE = "/api/loom/account/vault/status";
export const AccountWorkload = Schema.Struct({
  threadId: ThreadId,
  runId: RunId,
  projectId: ProjectId,
  providerInstanceId: ProviderInstanceId,
  runtimeMode: Schema.Literal("full-access"),
  interactionMode: Schema.Literal("default"),
});
export const AccountMachineLease = Schema.Struct({
  sourceEnvironmentId: EnvironmentId,
  publisherSessionId: AuthSessionId,
  authorityId: Schema.String,
  authorityEpoch: Schema.Number,
  keyFingerprint: Schema.String,
  membershipRevision: Schema.Number,
  membershipEpoch: Schema.Number,
  ownerSubject: Schema.String,
  expiresAt: Schema.Number,
  workload: Schema.optionalKey(AccountWorkload),
  relayGrant: Schema.optionalKey(Schema.String),
});
export type AccountMachineLease = typeof AccountMachineLease.Type;
export type AccountWorkloadLease = AccountMachineLease & {
  readonly workload: typeof AccountWorkload.Type;
};
export const AccountVaultVerification = Schema.Struct({
  grant: Schema.String.check(Schema.isPattern(/^relay:[a-f0-9]{64}$/)),
  payload: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(3 * 1024 * 1024))),
});
export type AccountVaultVerification = typeof AccountVaultVerification.Type;
export const AccountVaultRelayRequest = Schema.Struct({
  route: Schema.Literals(["workload", "provider", "profile", "status"]),
  envelope: Schema.Struct({
    payload: Schema.String.check(Schema.isMaxLength(3 * 1024 * 1024)),
    proof: AccountVaultVerification.fields.grant,
  }),
});
export type AccountVaultRelayRequest = typeof AccountVaultRelayRequest.Type;
