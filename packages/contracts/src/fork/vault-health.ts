import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { ProjectId } from "../baseSchemas.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { VaultProfilePinList, VaultProfilePin } from "./vault-profiles.ts";
import { VaultSshTarget } from "./vault-ssh.ts";
import { VaultError, VaultItemId } from "./vault-core.ts";
const Time = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const VaultHealthClass = Schema.Literals([
  "expiry",
  "authentication",
  "outage",
  "configuration",
]);
export type VaultHealthClass = typeof VaultHealthClass.Type;
export const VaultHealthOutageTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("github") }),
  Schema.Struct({
    kind: Schema.Literal("ssh"),
    hostname: VaultSshTarget.fields.hostname,
    port: VaultSshTarget.fields.port,
  }),
]);
export type VaultHealthOutageTarget = typeof VaultHealthOutageTarget.Type;
export const VaultHealthIssue = Schema.Struct({
  id: Schema.String,
  itemId: VaultItemId,
  itemLabel: Schema.String,
  itemVersion: Schema.Int,
  category: VaultHealthClass,
  outageTarget: Schema.optional(VaultHealthOutageTarget),
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
  sshValidation: Schema.optional(Schema.Boolean),
  githubRepository: Schema.NullOr(
    Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/)),
  ),
  automatic: Schema.Boolean,
  nextCheckAt: Time,
}).check(Schema.makeFilter((rule) => !rule.sshValidation || rule.githubRepository === null));
export type VaultHealthRule = typeof VaultHealthRule.Type;
export const VaultHealthSnapshot = Schema.Struct({
  revision: Schema.Int,
  checkedAt: Time,
  rules: Schema.Array(VaultHealthRule),
  issues: Schema.Array(VaultHealthIssue),
  omittedIssues: Schema.Int,
  outageGroups: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        target: VaultHealthOutageTarget,
        issueIds: Schema.Array(Schema.String).check(Schema.isMinLength(2), Schema.isMaxLength(256)),
      }),
    ).check(Schema.isMaxLength(128)),
  ),
});
export type VaultHealthSnapshot = typeof VaultHealthSnapshot.Type;
export const VaultHealthRecheckResult = Schema.Struct({
  snapshot: VaultHealthSnapshot,
  outcome: Schema.Literals(["checked", "rate-limited", "unconfigured"]),
});
export type VaultHealthRecheckResult = typeof VaultHealthRecheckResult.Type;
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
export const VaultHealthContextInput = Schema.Struct({
  itemId: VaultItemId,
  cursor: Schema.NullOr(ProjectId),
});
export type VaultHealthContextInput = typeof VaultHealthContextInput.Type;
const discoveryLimits = {
  externalConsumers: Schema.Literal("not-discovered"),
  providerCopies: Schema.Literal("unknown"),
  authorization: Schema.Literal("not-evaluated"),
};
export const VaultHealthContextPage = Schema.Struct({
  itemId: VaultItemId,
  checkedAt: Time,
  inspectedProjects: Schema.Int,
  coverage: Schema.optional(
    Schema.Struct({
      ...discoveryLimits,
      scope: Schema.Literal("project-page"),
      unattributedGrants: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
  scannedProjects: Schema.optional(
    Schema.Array(Schema.Struct({ id: ProjectId, title: Schema.String })).check(
      Schema.isMaxLength(10),
    ),
  ),
  nextCursor: Schema.NullOr(ProjectId),
  projects: Schema.Array(
    Schema.Struct({
      id: ProjectId,
      title: Schema.String,
      profiles: Schema.Array(
        Schema.Struct({
          id: VaultItemId,
          label: Schema.String,
          state: Schema.Literals(["active", "archived"]),
          isDefault: Schema.Boolean,
          requirements: Schema.Array(Schema.String),
        }),
      ),
      grants: Schema.Array(
        Schema.Struct({
          id: VaultItemId,
          label: Schema.String,
          principalKind: Schema.Literals(["project", "thread"]),
          state: Schema.Literals(["active", "suspended", "revoked"]),
          expiresAt: Schema.NullOr(Time),
        }),
      ),
    }),
  ).check(Schema.isMaxLength(10)),
});
export type VaultHealthContextPage = typeof VaultHealthContextPage.Type;
export const VaultHealthRetainedInput = Schema.Struct({
  ...VaultProfilePinList.fields,
  itemId: VaultItemId,
});
export type VaultHealthRetainedInput = typeof VaultHealthRetainedInput.Type;
export const VaultHealthRetainedPage = Schema.Struct({
  itemId: VaultItemId,
  projectId: ProjectId,
  checkedAt: Time,
  inspectedSelections: Schema.Int,
  coverage: Schema.optional(
    Schema.Struct({ ...discoveryLimits, scope: Schema.Literal("retained-page") }),
  ),
  unattributableSelections: Schema.Int,
  nextCursor: VaultProfilePinList.fields.cursor,
  items: Schema.Array(
    Schema.Struct({
      id: VaultProfilePin.fields.id,
      threadId: VaultProfilePin.fields.threadId,
      runId: VaultProfilePin.fields.runId,
      version: VaultProfilePin.fields.version,
      runState: VaultProfilePin.fields.runState,
      canRetire: Schema.Boolean,
      profileId: VaultItemId,
      profileLabel: Schema.String,
      profileVersion: Schema.Int,
      bindings: Schema.Array(Schema.Struct({ name: Schema.String, itemVersion: Schema.Int })).check(
        Schema.isMaxLength(16),
      ),
    }),
  ).check(Schema.isMaxLength(25)),
});
export type VaultHealthRetainedPage = typeof VaultHealthRetainedPage.Type;
export const VAULT_HEALTH_WS_METHODS = {
  snapshot: "loom.vault-health.snapshot",
  context: "loom.vault-health.context",
  retained: "loom.vault-health.retained",
  apply: "loom.vault-health.apply",
  recheck: "loom.vault-health.recheck",
} as const;
export const VaultHealthRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_HEALTH_WS_METHODS.retained, {
    payload: VaultHealthRetainedInput,
    success: VaultHealthRetainedPage,
    error: Schema.Union([VaultError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(VAULT_HEALTH_WS_METHODS.context, {
    payload: VaultHealthContextInput,
    success: VaultHealthContextPage,
    error: Schema.Union([VaultError, EnvironmentAuthorizationError]),
  }),
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
    success: VaultHealthRecheckResult,
    error: Schema.Union([VaultError, EnvironmentAuthorizationError]),
  }),
);
