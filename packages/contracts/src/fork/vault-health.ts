import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { VaultError, VaultItemId } from "./vault-core.ts";
const Time = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const VaultHealthClass = Schema.Literals([
  "expiry",
  "authentication",
  "outage",
  "configuration",
]);
export type VaultHealthClass = typeof VaultHealthClass.Type;
export const VaultHealthIssue = Schema.Struct({
  id: Schema.String,
  itemId: VaultItemId,
  itemLabel: Schema.String,
  itemVersion: Schema.Int,
  category: VaultHealthClass,
  state: Schema.Literals(["open", "snoozed", "dismissed", "resolved"]),
  firstSeenAt: Time,
  lastSeenAt: Time,
  resolvedAt: Schema.NullOr(Time),
  occurrences: Schema.Int,
  snoozedUntil: Schema.NullOr(Time),
});
export type VaultHealthIssue = typeof VaultHealthIssue.Type;
export const VaultHealthRule = Schema.Struct({
  itemId: VaultItemId,
  expiresAt: Schema.NullOr(Time),
  warningDays: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 90 })),
  githubRepository: Schema.NullOr(
    Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/)),
  ),
  automatic: Schema.Boolean,
  nextCheckAt: Time,
});
export type VaultHealthRule = typeof VaultHealthRule.Type;
export const VaultHealthSnapshot = Schema.Struct({
  revision: Schema.Int,
  checkedAt: Time,
  rules: Schema.Array(VaultHealthRule),
  issues: Schema.Array(VaultHealthIssue),
  omittedIssues: Schema.Int,
});
export type VaultHealthSnapshot = typeof VaultHealthSnapshot.Type;
export const VaultHealthMutation = Schema.Struct({
  operationId: VaultItemId,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  change: Schema.Union([
    Schema.Struct({ action: Schema.Literal("configure"), rule: VaultHealthRule }),
    Schema.Struct({ action: Schema.Literal("remove-rule"), itemId: VaultItemId }),
    Schema.Struct({
      action: Schema.Literals(["snooze", "unsnooze", "dismiss", "reopen"]),
      issueId: Schema.String.check(Schema.isMaxLength(80)),
      until: Schema.NullOr(Time),
    }),
  ]),
});
export type VaultHealthMutation = typeof VaultHealthMutation.Type;
export const VAULT_HEALTH_WS_METHODS = {
  snapshot: "loom.vault-health.snapshot",
  apply: "loom.vault-health.apply",
  recheck: "loom.vault-health.recheck",
} as const;
export const VaultHealthRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_HEALTH_WS_METHODS.snapshot, {
    payload: Schema.Struct({}),
    success: VaultHealthSnapshot,
    error: Schema.Union([VaultError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(VAULT_HEALTH_WS_METHODS.apply, {
    payload: VaultHealthMutation,
    success: VaultHealthSnapshot,
    error: Schema.Union([VaultError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(VAULT_HEALTH_WS_METHODS.recheck, {
    payload: Schema.Struct({ itemId: VaultItemId }),
    success: VaultHealthSnapshot,
    error: Schema.Union([VaultError, EnvironmentAuthorizationError]),
  }),
);
