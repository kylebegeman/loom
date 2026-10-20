import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { ThreadId, TrimmedNonEmptyString, NonNegativeInt, PositiveInt } from "../baseSchemas.ts";
import { VaultError, VaultItemId, VaultItemSummary, VaultCoreStatus } from "./vault-core.ts";

const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const Time = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
export const VaultAccessAction = Schema.Literals([
  "inspect",
  "manage",
  "use",
  "reveal",
  "export",
  "delegate",
]);
export type VaultAccessAction = typeof VaultAccessAction.Type;
export const VaultPrincipal = Schema.Struct({
  kind: Schema.Literals(["thread", "project"]),
  id: Id,
});
export const VaultGrantDefinition = Schema.Struct({
  id: VaultItemId,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  principal: VaultPrincipal,
  itemIds: Schema.Array(VaultItemId).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  actions: Schema.Array(VaultAccessAction).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
  projectId: Schema.NullOr(Id),
  destination: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(2048))),
  notBefore: Time,
  expiresAt: Schema.NullOr(Time),
  parentId: Schema.NullOr(VaultItemId),
}).check(
  Schema.makeFilter((value) => value.expiresAt === null || value.expiresAt > value.notBefore),
);
export type VaultGrantDefinition = typeof VaultGrantDefinition.Type;
export const VaultGrant = Schema.Struct({
  definition: VaultGrantDefinition,
  state: Schema.Literals(["active", "suspended", "revoked"]),
  revision: PositiveInt,
  createdBy: Id,
  updatedBy: Id,
});
export type VaultGrant = typeof VaultGrant.Type;
export const VaultGrantSave = Schema.Struct({
  type: Schema.Literal("save"),
  grant: VaultGrantDefinition,
});
export const VaultGrantStateChange = Schema.Struct({
  type: Schema.Literal("state"),
  id: VaultItemId,
  state: VaultGrant.fields.state,
});
export const VaultGrantMutation = Schema.Struct({
  operationId: VaultItemId,
  expectedRevision: NonNegativeInt,
  change: Schema.Union([VaultGrantSave, VaultGrantStateChange]),
});
export type VaultGrantMutation = typeof VaultGrantMutation.Type;
export const VaultDecisionReason = Schema.Literals([
  "allowed",
  "no-grant",
  "scope",
  "not-active",
  "not-yet-valid",
  "expired",
  "invalid-lineage",
  "item-unavailable",
  "workload-inactive",
  "caller-permission",
]);
export const VaultAccessDecision = Schema.Struct({
  allowed: Schema.Boolean,
  reason: VaultDecisionReason,
  grantId: Schema.NullOr(VaultItemId),
  grantRevision: Schema.NullOr(PositiveInt),
  expiresAt: Schema.NullOr(Time),
  policyRevision: NonNegativeInt,
  lineage: Schema.Array(VaultItemId),
});
export type VaultAccessDecision = typeof VaultAccessDecision.Type;
export const VaultDecisionInput = Schema.Struct({
  threadId: ThreadId,
  itemId: VaultItemId,
  action: VaultAccessAction,
  destination: VaultGrantDefinition.fields.destination,
});
export type VaultDecisionInput = typeof VaultDecisionInput.Type;
export const VaultOwnDecisionInput = Schema.Struct({
  itemId: VaultItemId,
  action: VaultAccessAction,
  destination: VaultGrantDefinition.fields.destination,
});
export const VaultAuditEvent = Schema.Struct({
  id: VaultItemId,
  at: Time,
  actor: Id,
  type: Schema.Literals(["grant-change", "decision"]),
  itemId: Schema.NullOr(VaultItemId),
  grantId: Schema.NullOr(VaultItemId),
  action: Schema.NullOr(VaultAccessAction),
  reason: Schema.String,
  policyRevision: NonNegativeInt,
});
export type VaultAuditEvent = typeof VaultAuditEvent.Type;
export const VaultPolicySnapshot = Schema.Struct({
  environmentId: Id,
  revision: NonNegativeInt,
  grants: Schema.Array(VaultGrant).check(Schema.isMaxLength(128)),
  audit: Schema.Array(VaultAuditEvent),
  omittedAuditEvents: NonNegativeInt,
});
export type VaultPolicySnapshot = typeof VaultPolicySnapshot.Type;
export const VaultGrantPreview = Schema.Struct({
  policyRevision: NonNegativeInt,
  grant: VaultGrant,
  affectedGrantIds: Schema.Array(VaultItemId),
  knownItemIds: Schema.Array(VaultItemId),
  unknowns: Schema.Array(Schema.String),
});
export type VaultGrantPreview = typeof VaultGrantPreview.Type;
export const VaultAccessExplanation = Schema.Struct({
  environmentId: Id,
  threadId: ThreadId,
  projectId: Id,
  item: Schema.NullOr(VaultItemSummary),
  decision: VaultAccessDecision,
  recentDecisions: Schema.Array(VaultAuditEvent),
  unknowns: Schema.Array(Schema.String),
});
export type VaultAccessExplanation = typeof VaultAccessExplanation.Type;
export const VaultReadinessInput = Schema.Struct({
  threadId: ThreadId,
  requirements: Schema.Array(VaultOwnDecisionInput).check(Schema.isMaxLength(16)),
});
export type VaultReadinessInput = typeof VaultReadinessInput.Type;
export const VaultReadinessReport = Schema.Struct({
  environmentId: Id,
  threadId: ThreadId,
  checkedAt: Time,
  freshUntil: Time,
  context: Schema.Literal("loom-server"),
  ready: Schema.Boolean,
  backend: VaultCoreStatus,
  checks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      state: Schema.Literals(["passed", "blocked", "unsupported"]),
      reason: Schema.String,
      repair: Schema.String,
    }),
  ),
  decisions: Schema.Array(VaultAccessDecision),
});
export type VaultReadinessReport = typeof VaultReadinessReport.Type;
export const VaultDelegateInput = Schema.Struct({
  operationId: VaultItemId,
  expectedRevision: NonNegativeInt,
  childThreadId: ThreadId,
  grant: VaultGrantDefinition,
});
export type VaultDelegateInput = typeof VaultDelegateInput.Type;
export const VaultAccessCatalog = Schema.Struct({
  subjects: Schema.Array(
    Schema.Struct({ principal: VaultPrincipal, label: Schema.String, projectId: Id }),
  ),
  truncated: Schema.Boolean,
});
export type VaultAccessCatalog = typeof VaultAccessCatalog.Type;
export const VaultApprovalCreate = Schema.Struct({
  id: VaultItemId,
  threadId: ThreadId,
  itemId: VaultItemId,
  action: VaultAccessAction,
  destination: VaultGrantDefinition.fields.destination,
});
export type VaultApprovalCreate = typeof VaultApprovalCreate.Type;
export const VaultApprovalRequest = Schema.Struct({
  ...VaultApprovalCreate.fields,
  projectId: Schema.String,
  itemVersion: PositiveInt,
  policyRevision: NonNegativeInt,
  revision: PositiveInt,
  requestedBy: Schema.String,
  requestedAt: Time,
  requestExpiresAt: Time,
  state: Schema.Literals(["pending", "approved", "denied", "cancelled", "expired", "revoked"]),
  decidedBy: Schema.NullOr(Schema.String),
  approvedUntil: Schema.NullOr(Time),
  grantId: Schema.NullOr(VaultItemId),
}).check(
  Schema.makeFilter(
    (request) =>
      request.requestExpiresAt > request.requestedAt &&
      (request.grantId === null) === (request.approvedUntil === null) &&
      (request.grantId === null ||
        (request.grantId === request.id &&
          request.approvedUntil! > request.requestedAt &&
          request.decidedBy !== null)) &&
      ((request.state !== "approved" && request.state !== "revoked") || request.grantId !== null),
  ),
);
export type VaultApprovalRequest = typeof VaultApprovalRequest.Type;
export const VaultApprovalChange = Schema.Struct({
  id: VaultItemId,
  operationId: VaultItemId,
  expectedRevision: PositiveInt,
  expectedPolicyRevision: NonNegativeInt,
  decision: Schema.Literals(["approve", "deny", "cancel", "revoke"]),
  durationMs: Schema.Literals([300_000, 900_000]),
});
export type VaultApprovalChange = typeof VaultApprovalChange.Type;
export const VaultApprovalInbox = Schema.Struct({
  policyRevision: NonNegativeInt,
  requests: Schema.Array(VaultApprovalRequest).check(Schema.isMaxLength(128)),
  notifications: Schema.Literal("stubbed"),
});
export type VaultApprovalInbox = typeof VaultApprovalInbox.Type;

export const VAULT_ACCESS_WS_METHODS = {
  approvalInbox: "loom.vault-approvals.inbox",
  approvalCreate: "loom.vault-approvals.request",
  approvalChange: "loom.vault-approvals.decide",
  catalog: "loom.vault-grants.catalog",
  snapshot: "loom.vault-grants.snapshot",
  apply: "loom.vault-grants.apply",
  preview: "loom.vault-access-inspector.preview",
  explain: "loom.vault-access-inspector.explain",
  readiness: "loom.vault-readiness.check",
} as const;
const error = Schema.Union([VaultError, EnvironmentAuthorizationError]);
export const VaultAccessRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_ACCESS_WS_METHODS.approvalInbox, {
    payload: Schema.Struct({}),
    success: VaultApprovalInbox,
    error,
  }),
  Rpc.make(VAULT_ACCESS_WS_METHODS.approvalCreate, {
    payload: VaultApprovalCreate,
    success: VaultApprovalRequest,
    error,
  }),
  Rpc.make(VAULT_ACCESS_WS_METHODS.approvalChange, {
    payload: VaultApprovalChange,
    success: VaultApprovalRequest,
    error,
  }),
  Rpc.make(VAULT_ACCESS_WS_METHODS.catalog, {
    payload: Schema.Struct({}),
    success: VaultAccessCatalog,
    error,
  }),
  Rpc.make(VAULT_ACCESS_WS_METHODS.snapshot, {
    payload: Schema.Struct({}),
    success: VaultPolicySnapshot,
    error,
  }),
  Rpc.make(VAULT_ACCESS_WS_METHODS.apply, {
    payload: VaultGrantMutation,
    success: VaultGrant,
    error,
  }),
  Rpc.make(VAULT_ACCESS_WS_METHODS.preview, {
    payload: VaultGrantMutation,
    success: VaultGrantPreview,
    error,
  }),
  Rpc.make(VAULT_ACCESS_WS_METHODS.explain, {
    payload: VaultDecisionInput,
    success: VaultAccessExplanation,
    error,
  }),
  Rpc.make(VAULT_ACCESS_WS_METHODS.readiness, {
    payload: VaultReadinessInput,
    success: VaultReadinessReport,
    error,
  }),
);
