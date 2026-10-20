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
      "original-identity-required",
      "source-changed",
      "source-unavailable",
      "item-changed",
      "replacement-unavailable",
      "unsupported-source",
      "expired",
      "invalid-state",
      "verification-required",
      "verification-scope",
      "unsupported-operation",
      "unsafe-source",
      "verification-busy",
      "receipt-changed",
      "verification-timeout",
      "cancelled",
    ]),
  },
) {
  override get message() {
    switch (this.reason) {
      case "original-identity-required":
        return "Choose a separate development SSH key matching the explicit original user, host and port. Personal agents and replacement credentials are not fallbacks.";
      case "verification-required":
        return "A fresh successful verification receipt is required. Verify the replacement and refresh.";
      case "verification-scope":
        return "Git transport previews require SSH repository-read evidence. GitHub API evidence cannot authorize a Git transport change.";
      case "unsupported-operation":
        return "This preview supports repository reads only. Read evidence cannot establish push access.";
      case "unsafe-source":
        return "This source contains authentication or ambiguous local routing. Prepare a separate reviewed replacement without it.";
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
export const VaultReplacementPreviewInput = Schema.Struct({
  id: VaultItemId,
  kind: Schema.Literals(["cutover", "rollback"]),
  expectedOperationId: VaultItemId,
});
export type VaultReplacementPreviewInput = typeof VaultReplacementPreviewInput.Type;
export const VaultReplacementPreview = Schema.Struct({
  kind: VaultReplacementPreviewInput.fields.kind,
  planId: VaultItemId,
  projectId: ProjectId,
  previewId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  checkedAt: Schema.Int,
  validUntil: Schema.Int,
  verificationOperationId: VaultItemId,
  verifiedOperation: Schema.Literal("ssh-repository-read"),
  hostFingerprint: text,
  source: VaultMigrationDependency,
  replacement: Schema.Struct({
    itemId: VaultItemId,
    expectedVersion: PositiveInt,
    destination: text,
    repository: text,
  }),
  from: Schema.Literals(["existing-project-git", "vault-mediated-git-read"]),
  to: Schema.Literals(["existing-project-git", "vault-mediated-git-read"]),
  rollbackBasis: Schema.Literal("hypothetical-forward-route"),
  originalAccess: Schema.Literal("not-verified"),
  conflictGuard: Schema.Literal("exact-source-and-forward-route-required"),
  configurationSnapshot: Schema.Literal("not-captured"),
  workloadAuthorization: Schema.Literal("not-evaluated"),
  providerRevocation: Schema.Literal("unknown-after-verification"),
  configurationWrites: Schema.Literal(false),
  canCutover: Schema.Literal(false),
  canRollback: Schema.Literal(false),
}).check(
  Schema.makeFilter(
    (preview) =>
      preview.validUntil > preview.checkedAt &&
      preview.source.direction === "fetch" &&
      preview.source.transport === "ssh" &&
      !preview.source.embeddedAuthentication &&
      preview.source.gitPath === preview.replacement.repository &&
      (preview.kind === "cutover"
        ? preview.from === "existing-project-git" && preview.to === "vault-mediated-git-read"
        : preview.from === "vault-mediated-git-read" && preview.to === "existing-project-git"),
  ),
);
export type VaultReplacementPreview = typeof VaultReplacementPreview.Type;
export const VaultOriginalVerify = Schema.Struct({
  ...VaultReplacementVerify.fields,
  original: Schema.Struct({ itemId: VaultItemId, expectedVersion: PositiveInt }),
  developmentOnly: Schema.Literal(true),
  reviewedOriginalRoute: Schema.Literal(true),
});
export type VaultOriginalVerify = typeof VaultOriginalVerify.Type;
export const VaultOriginalVerificationStatus = Schema.Struct({
  ...VaultReplacementVerificationStatus.fields,
  role: Schema.Literal("original-development-route"),
  identityBinding: Schema.Literal("explicit-development-selection"),
  ambientAuthentication: Schema.Literal("not-evaluated"),
  canRollback: Schema.Literal(false),
  configurationWrites: Schema.Literal(false),
}).check(
  Schema.makeFilter(
    (status) => status.receipt === null || status.receipt.scope === "ssh-git-transport",
  ),
);
export type VaultOriginalVerificationStatus = typeof VaultOriginalVerificationStatus.Type;
export const VaultRecoverySnapshotInput = Schema.Struct({
  id: VaultItemId,
  expectedReplacementOperationId: VaultItemId,
  expectedOriginalOperationId: VaultItemId,
});
export type VaultRecoverySnapshotInput = typeof VaultRecoverySnapshotInput.Type;
export const VaultRecoverySnapshotPreview = Schema.Struct({
  planId: VaultItemId,
  projectId: ProjectId,
  designId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  checkedAt: Schema.Int,
  validUntil: Schema.Int,
  source: VaultMigrationDependency,
  original: VaultReplacementVerificationReceipt,
  replacement: VaultReplacementVerificationReceipt,
  originalAccess: Schema.Literal("selected-development-key-read-verified"),
  ambientAuthentication: Schema.Literal("not-evaluated"),
  workloadAuthorization: Schema.Literal("not-evaluated"),
  snapshotState: Schema.Literal("design-only"),
  configurationSnapshot: Schema.Literal("not-captured"),
  proposedStorage: Schema.Literal("existing-replacement-ledger"),
  proposedCapture: Schema.Literal("selected-nonsecret-fetch-entry-and-route-manifest"),
  proposedRecovery: Schema.Literal("journal-with-preimage-and-postimage-reconciliation"),
  captureEngine: Schema.Literal("unimplemented"),
  concurrentWriterStrategy: Schema.Literal("unresolved"),
  privateMaterial: Schema.Literal("references-only"),
  globalSshConfiguration: Schema.Literal("excluded"),
  canCutover: Schema.Literal(false),
  canRollback: Schema.Literal(false),
  configurationWrites: Schema.Literal(false),
}).check(
  Schema.makeFilter(
    (preview) =>
      preview.validUntil > preview.checkedAt &&
      preview.source.direction === "fetch" &&
      preview.original.state === "passed" &&
      preview.replacement.state === "passed" &&
      preview.original.scope === "ssh-git-transport" &&
      preview.replacement.scope === "ssh-git-transport" &&
      preview.original.planId === preview.planId &&
      preview.replacement.planId === preview.planId &&
      preview.original.itemId !== preview.replacement.itemId &&
      preview.original.gitPath === preview.source.gitPath &&
      preview.replacement.gitPath === preview.source.gitPath &&
      preview.original.validUntil !== null &&
      preview.replacement.validUntil !== null &&
      preview.validUntil <= preview.original.validUntil &&
      preview.validUntil <= preview.replacement.validUntil,
  ),
);
export type VaultRecoverySnapshotPreview = typeof VaultRecoverySnapshotPreview.Type;
export const VAULT_MIGRATION_INVENTORY_WS_METHODS = {
  originalVerify: "loom.vault-migration.original-verify",
  originalVerification: "loom.vault-migration.original-verification",
  recoveryPreview: "loom.vault-migration.recovery-preview",
  preview: "loom.vault-migration.replacement-preview",
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
  Rpc.make(V.originalVerify, {
    payload: VaultOriginalVerify,
    success: VaultOriginalVerificationStatus,
    error,
  }),
  Rpc.make(V.originalVerification, {
    payload: Schema.Struct({ id: VaultItemId }),
    success: VaultOriginalVerificationStatus,
    error,
  }),
  Rpc.make(V.recoveryPreview, {
    payload: VaultRecoverySnapshotInput,
    success: VaultRecoverySnapshotPreview,
    error,
  }),
  Rpc.make(V.preview, {
    payload: VaultReplacementPreviewInput,
    success: VaultReplacementPreview,
    error,
  }),
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
