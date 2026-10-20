import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { ProjectId, PositiveInt } from "../baseSchemas.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { VaultError, VaultItemId, VaultItemSummary } from "./vault-core.ts";

export class VaultReplacementError extends Schema.TaggedError<VaultReplacementError>()(
  "VaultReplacementError",
  {
    reason: Schema.Literals([
      "source-changed",
      "source-unavailable",
      "item-changed",
      "replacement-unavailable",
      "unsupported-source",
      "expired",
      "invalid-state",
      "verification-busy",
      "receipt-changed",
      "verification-timeout",
      "cancelled",
    ]),
  },
) {
  override get message() {
    switch (this.reason) {
      case "verification-busy":
        return "A verification is already running. Refresh its receipt.";
      case "receipt-changed":
        return "The verification receipt changed. Refresh before starting another check.";
      case "verification-timeout":
        return "Verification exceeded its time limit. Refresh its receipt before trying again.";
      case "cancelled":
        return "This replacement plan was cancelled. Prepare a new plan.";
      case "source-changed":
        return "The inspected project configuration changed. Refresh inventory and prepare a new plan.";
      case "source-unavailable":
        return "The project's local Git metadata is unavailable. Restore access and refresh inventory.";
      case "item-changed":
        return "The replacement record changed or is inactive. Choose its current version in a new plan.";
      case "replacement-unavailable":
        return "The selected replacement could not be inspected. Check its adapter and Vault access.";
      case "unsupported-source":
        return "This source and replacement adapter do not match. SSH aliases and local rewrites need separate review.";
      case "expired":
        return "This replacement review expired. Prepare a new plan.";
      case "invalid-state":
        return "This replacement plan cannot be reviewed now. Refresh its status.";
    }
  }
}
const text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
export const VaultMigrationDependency = Schema.Struct({
  remote: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_./-]{1,100}$/)),
  direction: Schema.Literals(["fetch", "push"]),
  position: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4095 })),
  transport: Schema.Literals(["ssh", "https", "other"]),
  hostname: Schema.NullOr(text),
  port: Schema.NullOr(PositiveInt),
  repository: Schema.NullOr(text),
  gitPath: Schema.NullOr(text),
  embeddedAuthentication: Schema.Boolean,
});
export type VaultMigrationDependency = typeof VaultMigrationDependency.Type;
export const VaultMigrationProject = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  state: Schema.Literals(["inspected", "unavailable"]),
  dependencies: Schema.Array(VaultMigrationDependency).check(Schema.isMaxLength(40)),
  omittedDependencies: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  localSshCommand: Schema.Boolean,
  localCredentialHelper: Schema.Boolean,
  localUrlRewrite: Schema.Boolean,
});
export type VaultMigrationProject = typeof VaultMigrationProject.Type;
export const VaultMigrationInventoryInput = Schema.Struct({ cursor: Schema.NullOr(ProjectId) });
export type VaultMigrationInventoryInput = typeof VaultMigrationInventoryInput.Type;
export const VaultMigrationInventoryPage = Schema.Struct({
  checkedAt: Schema.Int,
  projects: Schema.Array(VaultMigrationProject).check(Schema.isMaxLength(10)),
  nextCursor: Schema.NullOr(ProjectId),
  coverage: Schema.Literal("registered-project-local-config-only"),
  credentialIdentity: Schema.Literal("unknown"),
  externalConsumers: Schema.Literal("not-discovered"),
  accessVerification: Schema.Literal("not-performed"),
});
export type VaultMigrationInventoryPage = typeof VaultMigrationInventoryPage.Type;
export const VaultReplacementSelection = Schema.Struct({
  adapter: Schema.Literals(["ssh", "github"]),
  itemId: VaultItemId,
  expectedVersion: PositiveInt,
});
export const VaultReplacementPrepare = Schema.Struct({
  id: VaultItemId,
  projectId: ProjectId,
  dependency: VaultMigrationDependency,
  replacement: VaultReplacementSelection,
  developmentOnly: Schema.Literal(true),
});
export type VaultReplacementPrepare = typeof VaultReplacementPrepare.Type;
export const VaultReplacementPlan = Schema.Struct({
  id: VaultItemId,
  projectId: ProjectId,
  projectTitle: Schema.String,
  dependency: VaultMigrationDependency,
  replacement: Schema.Struct({
    ...VaultReplacementSelection.fields,
    label: VaultItemSummary.fields.label,
    destination: text,
    hostTrust: Schema.Literals(["pinned", "missing", "not-applicable"]),
    scope: Schema.Literals(["ssh-git-transport", "github-api-and-gh-only"]),
  }),
  developmentOnly: Schema.Literal(true),
  state: Schema.Literals(["prepared", "reviewed", "cancelled", "expired"]),
  createdAt: Schema.Int,
  expiresAt: Schema.Int,
});
export type VaultReplacementPlan = typeof VaultReplacementPlan.Type;
export const VaultReplacementResult = Schema.Struct({
  plan: VaultReplacementPlan,
  validation: Schema.Literals([
    "current",
    "not-checked",
    "source-changed",
    "source-unavailable",
    "item-changed",
    "replacement-unavailable",
  ]),
  verification: Schema.Literal("required"),
  canCutover: Schema.Literal(false),
});
export type VaultReplacementResult = typeof VaultReplacementResult.Type;
export const VaultReplacementList = Schema.Struct({ cursor: Schema.NullOr(VaultItemId) });
export type VaultReplacementList = typeof VaultReplacementList.Type;
export const VaultReplacementPage = Schema.Struct({
  items: Schema.Array(VaultReplacementResult).check(Schema.isMaxLength(25)),
  nextCursor: Schema.NullOr(VaultItemId),
});
export type VaultReplacementPage = typeof VaultReplacementPage.Type;
export const VaultReplacementReview = Schema.Struct({
  id: VaultItemId,
  reviewed: Schema.Literal(true),
});
export type VaultReplacementReview = typeof VaultReplacementReview.Type;

export const VaultVerificationFailure = Schema.Literals([
  "denied",
  "source-changed",
  "source-unavailable",
  "item-changed",
  "replacement-unavailable",
  "cancelled",
  "expired",
  "untrusted-host",
  "unsupported",
  "unavailable",
  "timeout",
  "failed",
]);
export type VaultVerificationFailure = typeof VaultVerificationFailure.Type;
export const VaultReplacementVerificationReceipt = Schema.Struct({
  operationId: VaultItemId,
  planId: VaultItemId,
  itemId: VaultItemId,
  itemVersion: PositiveInt,
  scope: VaultReplacementPlan.fields.replacement.fields.scope,
  destination: text,
  gitPath: Schema.NullOr(text),
  state: Schema.Literals(["running", "passed", "failed"]),
  startedAt: Schema.Int,
  deadlineAt: Schema.Int,
  completedAt: Schema.NullOr(Schema.Int),
  validUntil: Schema.NullOr(Schema.Int),
  failure: Schema.NullOr(VaultVerificationFailure),
  hostFingerprint: Schema.NullOr(text),
}).check(
  Schema.makeFilter(
    (receipt) =>
      (receipt.scope === "ssh-git-transport"
        ? receipt.gitPath !== null
        : receipt.gitPath === null) &&
      (receipt.state === "running"
        ? receipt.completedAt === null && receipt.validUntil === null && receipt.failure === null
        : receipt.completedAt !== null &&
          (receipt.state === "passed"
            ? receipt.validUntil !== null &&
              receipt.failure === null &&
              (receipt.scope !== "ssh-git-transport" || receipt.hostFingerprint !== null)
            : receipt.validUntil === null && receipt.failure !== null)),
  ),
);
export type VaultReplacementVerificationReceipt = typeof VaultReplacementVerificationReceipt.Type;
export const VaultReplacementVerificationStatus = Schema.Struct({
  planId: VaultItemId,
  planState: VaultReplacementPlan.fields.state,
  receipt: Schema.NullOr(VaultReplacementVerificationReceipt),
  freshness: Schema.Literals([
    "not-run",
    "running",
    "current",
    "expired",
    "invalidated",
    "failed",
    "interrupted",
  ]),
  invalidatedBy: Schema.NullOr(VaultVerificationFailure),
  workloadAuthorization: Schema.Literal("not-evaluated"),
  canCutover: Schema.Literal(false),
});
export type VaultReplacementVerificationStatus = typeof VaultReplacementVerificationStatus.Type;
export const VaultReplacementVerify = Schema.Struct({
  id: VaultItemId,
  operationId: VaultItemId,
  expectedOperationId: Schema.NullOr(VaultItemId),
  contactDestination: Schema.Literal(true),
});
export type VaultReplacementVerify = typeof VaultReplacementVerify.Type;
export const VAULT_MIGRATION_INVENTORY_WS_METHODS = {
  verify: "loom.vault-migration.replacement-verify",
  verification: "loom.vault-migration.replacement-verification",
  inventory: "loom.vault-migration.inventory",
  prepare: "loom.vault-migration.replacement-prepare",
  inspect: "loom.vault-migration.replacement-inspect",
  list: "loom.vault-migration.replacements",
  review: "loom.vault-migration.replacement-review",
  cancel: "loom.vault-migration.replacement-cancel",
} as const;
const V = VAULT_MIGRATION_INVENTORY_WS_METHODS;
const error = Schema.Union([VaultError, VaultReplacementError, EnvironmentAuthorizationError]);
export const VaultMigrationInventoryRpcGroup = RpcGroup.make(
  Rpc.make(V.verify, {
    payload: VaultReplacementVerify,
    success: VaultReplacementVerificationStatus,
    error,
  }),
  Rpc.make(V.verification, {
    payload: Schema.Struct({ id: VaultItemId }),
    success: VaultReplacementVerificationStatus,
    error,
  }),
  Rpc.make(V.inventory, {
    payload: VaultMigrationInventoryInput,
    success: VaultMigrationInventoryPage,
    error,
  }),
  Rpc.make(V.prepare, { payload: VaultReplacementPrepare, success: VaultReplacementResult, error }),
  Rpc.make(V.inspect, {
    payload: Schema.Struct({ id: VaultItemId }),
    success: VaultReplacementResult,
    error,
  }),
  Rpc.make(V.list, { payload: VaultReplacementList, success: VaultReplacementPage, error }),
  Rpc.make(V.review, { payload: VaultReplacementReview, success: VaultReplacementResult, error }),
  Rpc.make(V.cancel, {
    payload: Schema.Struct({ id: VaultItemId }),
    success: VaultReplacementResult,
    error,
  }),
);
