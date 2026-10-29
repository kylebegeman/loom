import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  VaultApprovalRetryInput,
  VaultApprovalRetryOperation,
  type VaultApprovalRetryReport,
  vaultSshDestination,
  vaultGitDestination,
  vaultGitHubDestination,
  VAULT_APPROVAL_PENDING_MS,
  VAULT_APPROVAL_RETENTION_MS,
  VaultApprovalCancel,
  type VaultApprovalRequesterStatus,
  VaultApprovalCreate,
  VaultApprovalRequest,
  VaultApprovalChange,
  type VaultApprovalInbox,
  VaultError,
  VaultOwnerPolicyChange,
  type VaultOwnerPolicy,
  VaultGrant,
  VaultGrantMutation,
  VaultGrantBatchMutation,
  VaultGrantBatchResult,
  type VaultGrantBatchPreview,
  VaultAuditEvent,
  type VaultAccessAction,
  type VaultAccessDecision,
  type VaultDecisionInput,
  type VaultDeniedDetail,
  type VaultPolicySnapshot,
  type VaultGrantPreview,
  type VaultAccessExplanation,
  type VaultReadinessInput,
  type VaultReadinessReport,
  type VaultDelegateInput,
  type VaultItemList,
  type VaultItemReveal,
  type VaultItemValue,
  type VaultItemPage,
  type VaultAccessCatalog,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import * as ApprovalNotifications from "./ApprovalNotifications.ts";
import { evaluateVaultPolicy, grantAttenuates, grantMatchesWorkload } from "./VaultPolicy.ts";

import { isVaultRunRunning, readVaultThreadShell, type VaultLiveThread } from "./active-run.ts";
import * as AccessPolicy from "./AccessPolicy.ts";
import { decodePolicy, encodePolicy, type Policy } from "./AccessPolicy.ts";

const decodeOwnerPolicyChange = Schema.decodeUnknownEffect(VaultOwnerPolicyChange, {
  onExcessProperty: "error",
});
const encodeOwnerPolicyChange = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      input: VaultOwnerPolicyChange,
      actor: Schema.String,
    }),
  ),
);
const isAdministrator = Schema.is(AccessPolicy.OperationIntent.fields.reviewedBy);
const decodeModeChange = Schema.decodeUnknownEffect(AccessPolicy.ModeChange, {
  onExcessProperty: "error",
});
const decodeIntentProposal = Schema.decodeUnknownEffect(AccessPolicy.IntentProposal, {
  onExcessProperty: "error",
});
const decodeIntentReview = Schema.decodeUnknownEffect(AccessPolicy.IntentReview, {
  onExcessProperty: "error",
});
const decodeIntentReservation = Schema.decodeUnknownEffect(AccessPolicy.IntentReservation, {
  onExcessProperty: "error",
});
const decodeIntentClose = Schema.decodeUnknownEffect(AccessPolicy.IntentClose, {
  onExcessProperty: "error",
});
const decodeMigrationPreviewInput = Schema.decodeUnknownEffect(AccessPolicy.MigrationPreviewInput, {
  onExcessProperty: "error",
});
const encodeRetryOperation = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      protocol: Schema.Literal("loom-vault-retry-v1"),
      environmentId: Schema.String,
      requester: ThreadId,
      requestId: Schema.String,
      waitingOperation: Schema.NullOr(
        Schema.Struct({ operationId: Schema.String, runId: Schema.String }),
      ),
      proposedOperationId: Schema.String,
      operation: VaultApprovalRetryOperation,
    }),
  ),
);
const decodeApprovalRetry = Schema.decodeUnknownEffect(VaultApprovalRetryInput);
const isApprovalCancel = Schema.is(VaultApprovalCancel);
const isApprovalCreate = Schema.is(VaultApprovalCreate);
const isApprovalChange = Schema.is(VaultApprovalChange);
const encodeApprovalCreate = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ input: VaultApprovalCreate, actor: Schema.String })),
);
const encodeApprovalChange = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ input: VaultApprovalChange, actor: Schema.String })),
);
const decodeMutation = Schema.decodeUnknownOption(VaultGrantMutation);
const decodeBatchMutation = Schema.decodeUnknownOption(VaultGrantBatchMutation);
const encodeBatchMutation = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ mutation: VaultGrantBatchMutation, actor: Schema.String })),
);
const isAuditActor = Schema.is(VaultAuditEvent.fields.actor);
const encodeMutation = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ mutation: VaultGrantMutation, actor: Schema.String })),
);
const EMPTY: Policy = {
  schemaVersion: 1,
  revision: 0,
  grants: [],
  audit: [],
  omittedAuditEvents: 0,
  receipts: [],
};
const UNKNOWN = [
  "External credential copies and provider-side revocation are not tracked.",
  "Automatic workload launch and external consumers are not verified by this policy observation.",
];

const PREVIEW_UNKNOWN = [...UNKNOWN, "Profile bindings are not tracked by this change preview."];
const NOT_GRANTED = new Set<VaultAccessDecision["reason"]>([
  "no-grant",
  "scope",
  "not-active",
  "not-yet-valid",
  "expired",
  "invalid-lineage",
]);
// Denials name the causes an agent can act on. Unavailable items and protected credentials keep
// the plain denial: they have their own restore and approval flows.
const deniedDetail = (
  reason: VaultAccessDecision["reason"],
): { readonly detail?: VaultDeniedDetail } =>
  reason === "workload-inactive" || reason === "caller-permission"
    ? { detail: reason }
    : NOT_GRANTED.has(reason)
      ? { detail: "not-granted" }
      : {};

const RETRY_REPAIRS = {
  "refresh-request":
    "Refresh your request and prepare again using its current revision. This check cannot execute work.",
  "wait-for-decision":
    "Wait for a human decision, then refresh the request before preparing an explicit retry.",
  "request-new-approval":
    "Review the terminal or stale request. New work needs a fresh request bound to the current run; do not replay the old operation.",
  "review-operation":
    "Review the exact item, version, destination and command. A changed proposal must be prepared again; a digest does not authorize it.",
  "select-supported-item":
    "Select the corresponding dedicated SSH key or GitHub connection, then request access for that item.",
  "restore-runtime":
    "Restore the intended active full-access/default run, then refresh and prepare again. Request access again if the run changed.",
  "review-access":
    "Ask an eligible approver to review current access. Preparation cannot change grants or approve its own request.",
  "inspect-outcome":
    "Inspect the previous operation's remote or local effects before considering a new attempt. Do not blindly repeat a possibly completed write.",
  "recheck-adapter":
    "Use the normal operation adapter for a separate explicit attempt. It must recheck current access, destination, trust and connector/broker state; this report grants no execution.",
} satisfies Record<VaultApprovalRetryReport["nextStep"], string>;

export class VaultAccess extends Context.Service<
  VaultAccess,
  {
    // Internal preparation only: no transport or dispatcher invokes these methods.
    readonly protectionMigrationPreview: (
      input: AccessPolicy.MigrationPreviewInput,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<
      {
        readonly sourceStorageVersion: number;
        readonly proposal: AccessPolicy.ProtectedPolicy;
        readonly canMigrate: false;
      },
      VaultError
    >;
    readonly credentialModeChange: (
      input: AccessPolicy.ModeChange,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<typeof AccessPolicy.CredentialMode.Type, VaultError>;
    readonly intentPreview: (
      input: AccessPolicy.IntentProposal,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<
      {
        readonly binding: typeof AccessPolicy.IntentBinding.Type;
        readonly policyRevision: number;
        readonly expiresNoLaterThan: number;
        readonly canExecute: false;
      },
      VaultError
    >;
    readonly intentReview: (
      input: AccessPolicy.IntentReview,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<AccessPolicy.IntentObservation, VaultError>;
    readonly intentReserve: (
      input: AccessPolicy.IntentReservation,
      requester: ThreadId,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<AccessPolicy.IntentObservation, VaultError>;
    readonly intentStatus: (
      id: string,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<AccessPolicy.IntentObservation, VaultError>;
    readonly intentClose: (
      input: AccessPolicy.IntentClose,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<AccessPolicy.IntentObservation, VaultError>;
    readonly approvalPrepareRetry: (
      input: VaultApprovalRetryInput,
      requester: ThreadId,
    ) => Effect.Effect<VaultApprovalRetryReport, VaultError>;
    readonly approvalRetain: Effect.Effect<number, VaultError>;
    readonly approvalStatus: (
      id: string,
      requester: ThreadId,
    ) => Effect.Effect<VaultApprovalRequesterStatus, VaultError>;
    readonly approvalCancel: (
      input: VaultApprovalCancel,
      requester: ThreadId,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultApprovalRequest, VaultError>;
    readonly approvalContext: (input: {
      readonly threadId: ThreadId;
      readonly projectId: string;
      readonly itemId: string;
      readonly itemVersion: number;
      readonly runId: string | null;
      readonly restrictMetadata: boolean;
    }) => Effect.Effect<ReadonlyArray<VaultApprovalRequest>, VaultError>;
    readonly approvalInbox: Effect.Effect<VaultApprovalInbox, VaultError>;
    readonly approvalCreate: (
      input: VaultApprovalCreate,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
      wait?: boolean,
    ) => Effect.Effect<VaultApprovalRequest, VaultError>;
    readonly approvalChange: (
      input: VaultApprovalChange,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultApprovalRequest, VaultError>;
    readonly catalog: Effect.Effect<VaultAccessCatalog, VaultError>;
    readonly snapshot: Effect.Effect<VaultPolicySnapshot, VaultError>;
    readonly reveal: (
      input: VaultItemReveal,
      actor: string,
      destinationThreadId?: ThreadId,
    ) => Effect.Effect<VaultItemValue, VaultError>;
    readonly setOwnerPolicy: (
      input: VaultOwnerPolicyChange,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultPolicySnapshot, VaultError>;
    readonly apply: (
      input: VaultGrantMutation,
      actor: string,
      authorize?: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultGrant, VaultError>;
    readonly applyBatch: (
      input: VaultGrantBatchMutation,
      actor: string,
      authorize?: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultGrantBatchResult, VaultError>;
    readonly previewBatch: (
      input: VaultGrantBatchMutation,
      actor: string,
    ) => Effect.Effect<VaultGrantBatchPreview, VaultError>;
    readonly preview: (
      input: VaultGrantMutation,
      actor: string,
    ) => Effect.Effect<VaultGrantPreview, VaultError>;
    readonly explain: (
      input: VaultDecisionInput,
      restrictMetadata?: boolean,
    ) => Effect.Effect<VaultAccessExplanation, VaultError>;
    readonly readiness: (
      input: VaultReadinessInput,
    ) => Effect.Effect<VaultReadinessReport, VaultError>;
    readonly require: (
      threadId: ThreadId,
      itemId: string,
      action: VaultAccessAction,
      destination: string | null,
      live?: VaultLiveThread,
    ) => Effect.Effect<void, VaultError>;
    readonly listForThread: (
      input: VaultItemList,
      threadId: ThreadId,
    ) => Effect.Effect<VaultItemPage, VaultError>;
    readonly delegate: (
      input: VaultDelegateInput,
      threadId: ThreadId,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultGrant, VaultError>;
  }
>()("t3/fork/vault/VaultAccess") {}

const make = Effect.gen(function* () {
  const notifications = yield* ApprovalNotifications.ApprovalNotifications;
  const store = yield* OpenBaoStore.OpenBaoStore;
  const core = yield* VaultCore.VaultCore;
  const threads = yield* ThreadManagementService;
  const projects = yield* ProjectStoreV2;
  const identity = yield* ServerEnvironmentIdentity;
  const crypto = yield* Crypto.Crypto;
  const environmentId = yield* identity.getEnvironmentId;
  const hash = (input: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(input)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
    );
  const path = `environments/${yield* hash(environmentId)}/access-policy`;
  const eventId = crypto.randomUUIDv4().pipe(
    Effect.map((value) => value.replaceAll("-", "")),
    Effect.mapError(() => new VaultError({ reason: "unavailable" })),
  );
  const load = Effect.fnUntraced(function* () {
    const record = yield* store.read(path);
    if (record === null) return { policy: EMPTY, version: 0 };
    const value = decodePolicy(Redacted.value(record.value));
    if (
      Option.isNone(value) ||
      new Set(value.value.grants.map((grant) => grant.definition.id)).size !==
        value.value.grants.length ||
      new Set(value.value.approvals?.map((r) => r.request.id)).size !==
        (value.value.approvals?.length ?? 0) ||
      (value.value.schemaVersion === 4 && value.value.environmentId !== environmentId) ||
      (value.value.ownerPolicy !== undefined &&
        value.value.ownerPolicy.environmentId !== environmentId)
    )
      return yield* new VaultError({ reason: "invalid-response" });
    return { policy: value.value, version: record.version };
  });
  const persist = Effect.fnUntraced(function* (policy: Policy, version: number) {
    const encoded = yield* encodePolicy(
      policy.schemaVersion === 4 || policy.approvals === undefined
        ? policy
        : { ...policy, schemaVersion: 3 },
    ).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-input" })));
    yield* store.write(path, Redacted.make(encoded), version);
  });
  const withAudit = (policy: Policy, event: VaultAuditEvent): Policy => ({
    ...policy,
    audit: [...policy.audit, event].slice(-256),
    omittedAuditEvents: policy.omittedAuditEvents + (policy.audit.length === 256 ? 1 : 0),
  });
  const ownerPolicyView = (policy: Policy): VaultOwnerPolicy => ({
    environmentId,
    ownerId: policy.ownerPolicy?.ownerId ?? null,
    mode: policy.ownerPolicy?.mode ?? "restricted",
    revision: policy.revision,
    updatedAt: policy.ownerPolicy?.updatedAt ?? null,
    updatedBy: policy.ownerPolicy?.updatedBy ?? null,
  });
  const snapshotView = (policy: Policy): VaultPolicySnapshot => ({
    environmentId,
    revision: policy.revision,
    ownerPolicy: ownerPolicyView(policy),
    grants: policy.grants,
    audit: policy.audit.toReversed().slice(0, 50),
    omittedAuditEvents: policy.omittedAuditEvents + Math.max(0, policy.audit.length - 50),
  });
  const subject = Effect.fnUntraced(function* (threadId: ThreadId, live?: VaultLiveThread) {
    const thread =
      live?.shell.id === threadId
        ? live.shell
        : yield* readVaultThreadShell(threads, threadId).pipe(
            Effect.mapError(() => new VaultError({ reason: "unavailable" })),
          );
    if (thread === null || thread.deletedAt !== null || thread.archivedAt !== null)
      return yield* new VaultError({ reason: "denied" });
    return { threadId, projectId: thread.projectId, thread };
  });
  // Preparation is covered by the preview/apply operation's span.
  const validateLineage = Effect.fnUntraced(function* (
    grant: VaultGrant,
    grants: ReadonlyArray<VaultGrant>,
  ) {
    const definition = grant.definition;
    if (definition.parentId !== null) {
      const parent = grants.find((value) => value.definition.id === definition.parentId);
      if (!parent || parent.state !== "active" || !grantAttenuates(parent, grant))
        return yield* new VaultError({ reason: "denied" });
      const seen = new Set([definition.id]);
      let ancestor: VaultGrant | undefined = parent;
      while (ancestor) {
        if (seen.has(ancestor.definition.id)) return yield* new VaultError({ reason: "denied" });
        seen.add(ancestor.definition.id);
        ancestor = grants.find((value) => value.definition.id === ancestor?.definition.parentId);
      }
    }
  });
  const prepare = Effect.fnUntraced(function* (
    input: VaultGrantMutation,
    policy: Policy,
    actor: string,
    deferLineage = false,
  ) {
    if (!actor.trim() || actor.length > 256 || Option.isNone(decodeMutation(input)))
      return yield* new VaultError({ reason: "invalid-input" });
    if (input.expectedRevision !== policy.revision)
      return yield* new VaultError({ reason: "conflict" });
    const id = input.change.type === "save" ? input.change.grant.id : input.change.id;
    const current = policy.grants.find((grant) => grant.definition.id === id);
    if (current?.state === "revoked") return yield* new VaultError({ reason: "denied" });
    if (input.change.type === "state") {
      if (
        policy.approvals?.some((r) => r.request.grantId === id) &&
        input.change.state !== "revoked"
      )
        return yield* new VaultError({ reason: "denied" });
      if (!current) return yield* new VaultError({ reason: "not-found" });
      return {
        ...current,
        state: input.change.state,
        revision: current.revision + 1,
        updatedBy: actor,
      };
    }
    const definition = input.change.grant;
    if (policy.approvals?.some((r) => r.request.grantId === definition.id))
      return yield* new VaultError({ reason: "denied" });
    if (definition.principal.kind === "thread") {
      const target = yield* subject(ThreadId.make(definition.principal.id));
      if (definition.projectId !== null && definition.projectId !== target.projectId)
        return yield* new VaultError({ reason: "invalid-input" });
    } else {
      if (definition.projectId !== null && definition.projectId !== definition.principal.id)
        return yield* new VaultError({ reason: "invalid-input" });
      const project = yield* projects
        .get(ProjectId.make(definition.principal.id))
        .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
      if (Option.isNone(project)) return yield* new VaultError({ reason: "not-found" });
    }
    const grant: VaultGrant = {
      definition,
      state: current?.state ?? "active",
      revision: (current?.revision ?? 0) + 1,
      createdBy: current?.createdBy ?? actor,
      updatedBy: actor,
    };
    if (!deferLineage) yield* validateLineage(grant, policy.grants);
    if (!current && policy.grants.length >= 128)
      return yield* new VaultError({ reason: "invalid-input" });
    return grant;
  });
  const apply = Effect.fn("VaultAccess.apply")(function* (
    input: VaultGrantMutation,
    actor: string,
    authorize?: Effect.Effect<void, VaultError>,
  ) {
    if (Option.isNone(decodeMutation(input)))
      return yield* new VaultError({ reason: "invalid-input" });
    const fingerprint = yield* hash(
      yield* encodeMutation({ mutation: input, actor }).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      ),
    );
    // Audit traffic can race policy edits without changing the user-visible policy revision.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { policy, version } = yield* load();
      yield* authorize ?? Effect.void;
      if (policy.ownerReceipts?.some((value) => value.id === input.operationId))
        return yield* new VaultError({ reason: "conflict" });
      if (policy.batchReceipts?.some((value) => value.id === input.operationId))
        return yield* new VaultError({ reason: "conflict" });
      const receipt = policy.receipts.find((value) => value.id === input.operationId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          return yield* new VaultError({ reason: "conflict" });
        return receipt.result;
      }
      const grant = yield* prepare(input, policy, actor);
      const changed = {
        ...policy,
        revision: policy.revision + 1,
        grants: [
          ...policy.grants.filter((value) => value.definition.id !== grant.definition.id),
          grant,
        ],
        receipts: [...policy.receipts, { id: input.operationId, fingerprint, result: grant }].slice(
          -32,
        ),
      };
      const next = withAudit(changed, {
        id: yield* eventId,
        at: yield* Clock.currentTimeMillis,
        actor,
        type: "grant-change",
        itemId: null,
        grantId: grant.definition.id,
        action: null,
        reason: grant.state,
        policyRevision: changed.revision,
      });
      yield* authorize ?? Effect.void;
      const saved = yield* persist(next, version).pipe(Effect.result);
      if (saved._tag === "Success") return grant;
      if (saved.failure.reason !== "conflict") return yield* saved.failure;
    }
    return yield* new VaultError({ reason: "conflict" });
  });
  const prepareBatch = Effect.fn("VaultAccess.prepareBatch")(function* (
    input: VaultGrantBatchMutation,
    policy: Policy,
    actor: string,
  ) {
    if (Option.isNone(decodeBatchMutation(input)))
      return yield* new VaultError({ reason: "invalid-input" });
    const grants = yield* Effect.forEach(input.changes, (change) =>
      prepare(
        { operationId: input.operationId, expectedRevision: input.expectedRevision, change },
        policy,
        actor,
        true,
      ),
    );
    const changedIds = new Set(grants.map((grant) => grant.definition.id));
    const finalGrants = [
      ...policy.grants.filter((grant) => !changedIds.has(grant.definition.id)),
      ...grants,
    ];
    if (finalGrants.length > 128) return yield* new VaultError({ reason: "invalid-input" });
    // Resolve every saved lineage against the final policy, independent of input order.
    for (const [index, change] of input.changes.entries())
      if (change.type === "save") yield* validateLineage(grants[index]!, finalGrants);
    return { grants, finalGrants };
  });
  const applyBatch = Effect.fn("VaultAccess.applyBatch")(function* (
    input: VaultGrantBatchMutation,
    actor: string,
    authorize?: Effect.Effect<void, VaultError>,
  ) {
    if (Option.isNone(decodeBatchMutation(input)) || !actor.trim() || actor.length > 256)
      return yield* new VaultError({ reason: "invalid-input" });
    if (actor.startsWith("thread:") || actor === "mcp-client")
      return yield* new VaultError({ reason: "denied", detail: "admin-only" });
    const fingerprint = yield* hash(
      yield* encodeBatchMutation({ mutation: input, actor }).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      ),
    );
    for (let attempt = 0; attempt < 4; attempt++) {
      const { policy, version } = yield* load();
      yield* authorize ?? Effect.void;
      if (policy.receipts.some((value) => value.id === input.operationId))
        return yield* new VaultError({ reason: "conflict" });
      if (policy.ownerReceipts?.some((value) => value.id === input.operationId))
        return yield* new VaultError({ reason: "conflict" });
      const receipt = policy.batchReceipts?.find((value) => value.id === input.operationId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          return yield* new VaultError({ reason: "conflict" });
        return receipt.result;
      }
      const { grants, finalGrants } = yield* prepareBatch(input, policy, actor);
      const result: VaultGrantBatchResult = { policyRevision: policy.revision + 1, grants };
      let next: Policy = {
        ...policy,
        revision: result.policyRevision,
        grants: finalGrants,
        batchReceipts: [
          ...(policy.batchReceipts ?? []),
          { id: input.operationId, fingerprint, result },
        ].slice(-32),
      };
      const at = yield* Clock.currentTimeMillis;
      for (const grant of grants)
        next = withAudit(next, {
          id: yield* eventId,
          at,
          actor,
          type: "grant-change",
          itemId: null,
          grantId: grant.definition.id,
          action: null,
          reason: grant.state,
          policyRevision: result.policyRevision,
        });
      yield* authorize ?? Effect.void;
      const saved = yield* persist(next, version).pipe(Effect.result);
      if (saved._tag === "Success") return result;
      if (saved.failure.reason !== "conflict") return yield* saved.failure;
    }
    return yield* new VaultError({ reason: "conflict" });
  });
  // A call that evaluates several actions for one thread and item shares these reads, and
  // reads the active run at most once.
  const decisionReads = Effect.fnUntraced(function* (
    input: VaultDecisionInput,
    live?: VaultLiveThread,
  ) {
    const workload = yield* subject(input.threadId, live);
    const item = yield* core.inspect(input.itemId);
    let running: boolean | undefined = live?.shell === workload.thread ? live.running : undefined;
    const isRunning = Effect.suspend(() =>
      running !== undefined
        ? Effect.succeed(running)
        : isVaultRunRunning(threads, workload.thread).pipe(
            Effect.tap((value) =>
              Effect.sync(() => {
                running = value;
              }),
            ),
          ),
    );
    return { workload, item, isRunning };
  });
  const evaluate = Effect.fnUntraced(function* (
    policy: Policy,
    input: VaultDecisionInput,
    { workload, item, isRunning }: Effect.Success<ReturnType<typeof decisionReads>>,
  ) {
    const staleApprovals = new Set(
      (policy.approvals ?? [])
        .filter(
          (r) =>
            r.request.grantId !== null &&
            r.request.itemId === input.itemId &&
            (r.request.itemVersion !== item?.version ||
              (r.request.waitingOperation != null &&
                r.request.waitingOperation.runId !== workload.thread.activeRunId)),
        )
        .map((r) => r.request.grantId),
    );
    const currentGrants = policy.grants.filter((g) => !staleApprovals.has(g.definition.id));
    const now = yield* Clock.currentTimeMillis;
    const ordinary = evaluateVaultPolicy(currentGrants, workload, input, now, policy.revision);
    const evaluated = evaluateVaultPolicy(
      currentGrants,
      workload,
      input,
      now,
      policy.revision,
      ownerPolicyView(policy),
    );
    let result: VaultAccessDecision =
      input.action !== "manage" &&
      (item === null || (input.action !== "inspect" && item.state !== "active"))
        ? { ...evaluated, allowed: false, reason: "item-unavailable" }
        : evaluated;
    // Reviewed operation intents still require their exact real grant and revision.
    const ordinaryResult =
      input.action !== "manage" &&
      (item === null || (input.action !== "inspect" && item.state !== "active"))
        ? { ...ordinary, allowed: false, reason: "item-unavailable" as const }
        : ordinary;
    if (evaluated.basis === "owner-trusted") {
      if (
        workload.thread.runtimeMode !== "full-access" ||
        workload.thread.interactionMode !== "default"
      )
        result = { ...result, allowed: false, reason: "caller-permission" };
      else if (!(yield* isRunning))
        result = { ...result, allowed: false, reason: "workload-inactive" };
    }
    const protection = AccessPolicy.credentialUseRefusal(policy, input.itemId);
    if (input.action !== "inspect" && protection)
      result = {
        ...result,
        allowed: false,
        reason: protection,
        grantId: null,
        grantRevision: null,
        expiresAt: null,
        lineage: [],
      };
    if (
      (input.action === "manage" || input.action === "delegate") &&
      (workload.thread.runtimeMode !== "full-access" ||
        workload.thread.interactionMode !== "default")
    )
      result = { ...result, allowed: false, reason: "caller-permission" };
    if (input.action !== "inspect" && workload.thread.activeRunId === null)
      result = { ...result, allowed: false, reason: "workload-inactive" };
    return { workload, item, result, ordinaryResult };
  });
  const decision = Effect.fnUntraced(function* (
    policy: Policy,
    input: VaultDecisionInput,
    live?: VaultLiveThread,
  ) {
    return yield* evaluate(policy, input, yield* decisionReads(input, live));
  });
  const requireAccess = Effect.fn("VaultAccess.require")(function* (
    threadId: ThreadId,
    itemId: string,
    action: VaultAccessAction,
    destination: string | null,
    live?: VaultLiveThread,
  ) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { policy, version } = yield* load();
      // The caller's thread read is current only for the first attempt; a retry after a
      // concurrent policy write reads the thread again, as every attempt did before.
      const { result, workload, item } = yield* decision(
        policy,
        { threadId, itemId, action, destination },
        attempt === 0 ? live : undefined,
      );
      const next = withAudit(policy, {
        id: yield* eventId,
        at: yield* Clock.currentTimeMillis,
        actor: `thread:${threadId}`,
        type: "decision",
        itemId,
        grantId: result.grantId,
        action,
        reason: result.reason,
        policyRevision: policy.revision,
        authorization: {
          category: result.basis ?? "grant",
          environmentId,
          ownerId: policy.ownerPolicy?.ownerId ?? null,
          threadId,
          runId: workload.thread.activeRunId,
          destinationDigest: destination === null ? null : yield* hash(destination),
          itemKind: item?.kind ?? null,
        },
      });
      const persisted = yield* persist(next, version).pipe(Effect.result);
      if (persisted._tag === "Failure") {
        if (persisted.failure.reason === "conflict") continue;
        return yield* persisted.failure;
      }
      if (!result.allowed)
        return yield* new VaultError({ reason: "denied", ...deniedDetail(result.reason) });
      return;
    }
    return yield* new VaultError({ reason: "conflict" });
  });
  const approvalView = (
    request: VaultApprovalRequest,
    policy: Policy,
    now: number,
  ): VaultApprovalRequest => {
    const grant = policy.grants.find((g) => g.definition.id === request.grantId);
    return {
      ...request,
      state:
        request.state === "pending" && now >= request.requestExpiresAt
          ? "expired"
          : request.state === "approved" && (!grant || grant.state !== "active")
            ? "revoked"
            : request.state === "approved" &&
                request.approvedUntil !== null &&
                now >= request.approvedUntil
              ? "expired"
              : request.state,
    };
  };
  const retainedApprovals = (policy: Policy, now: number) =>
    (policy.approvals ?? []).filter(
      (r) => now < r.request.requestedAt + VAULT_APPROVAL_RETENTION_MS,
    );
  // Untraced: pure policy trimming inside callers' retry loops, covered by their spans.
  const trimApprovals = Effect.fnUntraced(function* (policy: Policy, now: number) {
    const approvals = retainedApprovals(policy, now);
    const removed = (policy.approvals?.length ?? 0) - approvals.length;
    if (removed === 0) return { policy, removed };
    const discarded = new Set(
      (policy.approvals ?? [])
        .filter((r) => now >= r.request.requestedAt + VAULT_APPROVAL_RETENTION_MS)
        .map((r) => r.request.grantId),
    );
    // Never discard version/run binding for a live grant, even if an inconsistent ledger claims it is old.
    if (
      policy.grants.some(
        (g) =>
          discarded.has(g.definition.id) &&
          (g.definition.expiresAt === null || now < g.definition.expiresAt),
      )
    )
      return yield* new VaultError({ reason: "invalid-response" });
    return {
      removed,
      policy: {
        ...policy,
        revision: policy.revision + 1,
        approvals,
        grants: policy.grants.filter((g) => !discarded.has(g.definition.id)),
      },
    };
  });
  const approvalRetain = Effect.gen(function* () {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { policy, version } = yield* load();
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.forEach(
        policy.approvals ?? [],
        ({ request }) => notifications.changed(approvalView(request, policy, now), true),
        { discard: true },
      );
      const trimmed = yield* trimApprovals(policy, now);
      if (trimmed.removed === 0) return 0;
      const saved = yield* persist(trimmed.policy, version).pipe(Effect.result);
      if (saved._tag === "Success") return trimmed.removed;
      if (saved.failure.reason !== "conflict") return yield* saved.failure;
    }
    return yield* new VaultError({ reason: "conflict" });
  });
  const requesterRecord = (policy: Policy, id: string, requester: ThreadId, now: number) => {
    const record = retainedApprovals(policy, now).find(
      (r) =>
        r.request.id === id &&
        r.request.threadId === requester &&
        r.request.requestedBy === `thread:${requester}`,
    );
    return record ? Effect.succeed(record) : Effect.fail(new VaultError({ reason: "not-found" }));
  };
  const approvalStatusFromPolicy = Effect.fnUntraced(function* (
    policy: Policy,
    now: number,
    id: string,
    requester: ThreadId,
  ) {
    const target = yield* subject(requester);
    const stored = yield* requesterRecord(policy, id, requester, now);
    const request = approvalView(stored.request, policy, now);
    let operationState: VaultApprovalRequesterStatus["operationState"];
    if (request.state !== "pending" && request.state !== "approved") operationState = request.state;
    else if (!request.waitingOperation) operationState = "unbound";
    else if (
      request.waitingOperation.runId !== target.thread.activeRunId ||
      request.projectId !== target.projectId
    )
      operationState = "stale-run";
    else {
      const item = yield* core.inspect(request.itemId);
      if (!item || item.state !== "active" || item.version !== request.itemVersion)
        operationState = "stale-item";
      else if (request.state === "pending") operationState = "waiting";
      else {
        const evaluated = yield* decision(policy, {
          threadId: requester,
          itemId: request.itemId,
          action: request.action,
          destination: request.destination,
        });
        operationState =
          evaluated.workload.thread.activeRunId !== request.waitingOperation.runId
            ? "stale-run"
            : evaluated.result.allowed
              ? "retry-requires-explicit-operation"
              : "access-denied";
      }
    }
    const notificationOutcome = (yield* notifications.outcomes([request]))[0];
    return {
      request,
      ...(notificationOutcome ? { notificationOutcome } : {}),
      checkedAt: now,
      operationState,
      automaticResumption: false as const,
      allowOnceConsumption: false as const,
      canExecute: false as const,
    };
  });
  const approvalStatus = Effect.fn("VaultAccess.approvalStatus")(function* (
    id: string,
    requester: ThreadId,
  ) {
    const { policy } = yield* load();
    return yield* approvalStatusFromPolicy(policy, yield* Clock.currentTimeMillis, id, requester);
  });
  const approvalPrepareRetry = Effect.fn("VaultAccess.approvalPrepareRetry")(function* (
    raw: VaultApprovalRetryInput,
    requester: ThreadId,
  ) {
    const input = yield* decodeApprovalRetry(raw).pipe(
      Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
    );
    const { policy, version: policyVersion } = yield* load();
    const status = yield* approvalStatusFromPolicy(
      policy,
      yield* Clock.currentTimeMillis,
      input.id,
      requester,
    );
    const { request } = status;
    const operationDigest = yield* hash(
      yield* encodeRetryOperation({
        protocol: "loom-vault-retry-v1",
        environmentId,
        requester,
        requestId: request.id,
        waitingOperation: request.waitingOperation ?? null,
        proposedOperationId: input.waitingOperationId,
        operation: input.operation,
      }).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-input" }))),
    );
    const proposed = input.operation;
    const destination =
      proposed.kind === "github-api"
        ? vaultGitHubDestination(proposed.input.repository)
        : proposed.kind === "git-ssh"
          ? vaultGitDestination(proposed.target, proposed.input.repository)
          : vaultSshDestination(proposed.target);
    const version =
      proposed.kind === "ssh"
        ? proposed.input.command.expectedVersion
        : proposed.input.expectedVersion;
    const effects: VaultApprovalRetryReport["effects"] =
      proposed.kind === "ssh"
        ? "remote-write-or-unknown"
        : proposed.kind === "git-ssh"
          ? proposed.input.action === "fetch"
            ? "local-write"
            : "read"
          : ["pr-comment", "issue-comment", "issue-create"].includes(
                proposed.input.operation.action,
              )
            ? "remote-write-or-unknown"
            : "read";
    let retryState: VaultApprovalRetryReport["retryState"] = "blocked-request";
    if (input.expectedRevision !== request.revision) retryState = "stale-request";
    else if (
      !request.waitingOperation ||
      request.waitingOperation.operationId !== input.waitingOperationId ||
      proposed.input.id !== request.itemId ||
      version !== request.itemVersion ||
      request.action !== "use" ||
      destination !== request.destination
    )
      retryState = "operation-mismatch";
    else if (
      input.previousOperationDigest !== undefined &&
      input.previousOperationDigest !== operationDigest
    )
      retryState = "operation-changed";
    else if (status.operationState === "retry-requires-explicit-operation") {
      const item = yield* core.inspect(request.itemId);
      const evaluated = yield* decision(policy, {
        threadId: requester,
        itemId: request.itemId,
        action: "use",
        destination,
      });
      if (item?.kind !== (proposed.kind === "github-api" ? "service-connection" : "ssh-key"))
        retryState = "unsupported-item";
      else if (
        evaluated.workload.thread.activeRunId !== request.waitingOperation.runId ||
        evaluated.workload.projectId !== request.projectId ||
        evaluated.workload.thread.runtimeMode !== "full-access" ||
        evaluated.workload.thread.interactionMode !== "default"
      )
        retryState = "runtime-denied";
      else if (!evaluated.result.allowed) retryState = "access-denied";
      else if (input.previousOutcome === "unknown" && effects !== "read")
        retryState = "requires-outcome-review";
      else retryState = "policy-valid-recheck-adapter";
    }
    // A concurrent policy commit invalidates the observation instead of quietly reusing its checks.
    const latest = yield* load();
    const latestStatus = yield* approvalStatusFromPolicy(
      latest.policy,
      yield* Clock.currentTimeMillis,
      input.id,
      requester,
    );
    if (latest.version !== policyVersion || latestStatus.operationState !== status.operationState)
      retryState = "context-changed";
    if (retryState === "policy-valid-recheck-adapter") {
      const current = yield* subject(requester);
      if (
        current.thread.runtimeMode !== "full-access" ||
        current.thread.interactionMode !== "default"
      )
        retryState = "runtime-denied";
    }
    const nextStep: VaultApprovalRetryReport["nextStep"] =
      retryState === "blocked-request"
        ? latestStatus.operationState === "waiting"
          ? "wait-for-decision"
          : "request-new-approval"
        : retryState === "context-changed" || retryState === "stale-request"
          ? "refresh-request"
          : retryState === "operation-mismatch" || retryState === "operation-changed"
            ? "review-operation"
            : retryState === "unsupported-item"
              ? "select-supported-item"
              : retryState === "runtime-denied"
                ? "restore-runtime"
                : retryState === "access-denied"
                  ? "review-access"
                  : retryState === "requires-outcome-review"
                    ? "inspect-outcome"
                    : "recheck-adapter";
    return {
      status: latestStatus,
      operationDigest,
      policyRevision: latest.policy.revision,
      nextStep,
      repair: RETRY_REPAIRS[nextStep],
      retryState,
      effects,
      adapterValidation: "required" as const,
      automaticResumption: false as const,
      allowOnceConsumption: false as const,
      canExecute: false as const,
    };
  });
  const requireAdministrator = (actor: string) =>
    isAdministrator(actor)
      ? Effect.void
      : Effect.fail(new VaultError({ reason: "denied", detail: "admin-only" }));
  const requireProtectedPolicy = (policy: Policy) =>
    policy.schemaVersion === 4
      ? Effect.succeed(policy)
      : Effect.fail(new VaultError({ reason: "denied" }));
  const observeIntent = Effect.fn("VaultAccess.observeIntent")(function* (
    intent: AccessPolicy.OperationIntent,
  ): Effect.fn.Return<AccessPolicy.IntentObservation> {
    const checkedAt = yield* Clock.currentTimeMillis;
    return {
      intent:
        intent.state === "reviewed" && checkedAt >= intent.expiresAt
          ? { ...intent, state: "expired" }
          : intent,
      checkedAt,
      canExecute: false,
      automaticResumption: false,
      allowOnceConsumption: false,
    };
  });
  const sameBinding = (
    a: typeof AccessPolicy.IntentBinding.Type,
    b: typeof AccessPolicy.IntentBinding.Type,
  ) => JSON.stringify(a) === JSON.stringify(b);
  const intentBinding = Effect.fn("VaultAccess.intentBinding")(function* (
    policy: AccessPolicy.ProtectedPolicy,
    input: AccessPolicy.IntentProposal,
  ) {
    const request = policy.approvals?.find(
      (entry) => entry.request.id === input.requestId,
    )?.request;
    const now = yield* Clock.currentTimeMillis;
    if (
      !request ||
      !request.waitingOperation ||
      (request.state !== "pending" && request.state !== "approved") ||
      request.revision !== input.expectedRequestRevision ||
      request.waitingOperation.operationId !== input.waitingOperationId ||
      now >= request.requestExpiresAt ||
      request.action !== "use"
    )
      return yield* new VaultError({ reason: "denied" });
    const mode = policy.credentialModes.find((entry) => entry.itemId === request.itemId);
    if (!mode || mode.mode !== "one-time") return yield* new VaultError({ reason: "denied" });
    const evaluated = yield* decision(policy, {
      threadId: request.threadId,
      itemId: request.itemId,
      action: "use",
      destination: request.destination,
    });
    const thread = evaluated.workload.thread;
    const item = evaluated.item;
    const grant = evaluated.ordinaryResult;
    const operation = input.operation;
    const destination =
      operation.kind === "github-api"
        ? vaultGitHubDestination(operation.input.repository)
        : operation.kind === "git-ssh"
          ? vaultGitDestination(operation.target, operation.input.repository)
          : vaultSshDestination(operation.target);
    const itemVersion =
      operation.kind === "ssh"
        ? operation.input.command.expectedVersion
        : operation.input.expectedVersion;
    if (
      !item ||
      item.state !== "active" ||
      item.version !== request.itemVersion ||
      item.version !== itemVersion ||
      operation.input.id !== item.id ||
      item.kind !== (operation.kind === "github-api" ? "service-connection" : "ssh-key") ||
      destination !== request.destination ||
      evaluated.workload.projectId !== request.projectId ||
      thread.activeRunId !== request.waitingOperation.runId ||
      thread.runtimeMode !== "full-access" ||
      thread.interactionMode !== "default" ||
      !grant.allowed ||
      !grant.grantId ||
      !grant.grantRevision
    )
      return yield* new VaultError({ reason: "denied" });
    const operationDigest = yield* hash(
      yield* encodeRetryOperation({
        protocol: "loom-vault-retry-v1",
        environmentId,
        requester: request.threadId,
        requestId: request.id,
        waitingOperation: request.waitingOperation,
        proposedOperationId: input.waitingOperationId,
        operation,
      }).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-input" }))),
    );
    const binding: typeof AccessPolicy.IntentBinding.Type = {
      environmentId,
      itemId: item.id,
      itemVersion: item.version,
      modeRevision: mode.revision,
      requestId: request.id,
      requestRevision: request.revision,
      waitingOperationId: input.waitingOperationId,
      threadId: request.threadId,
      projectId: evaluated.workload.projectId,
      runId: request.waitingOperation.runId,
      action: "use",
      destination,
      adapter: operation.kind,
      operationDigest,
      grantId: grant.grantId,
      grantRevision: grant.grantRevision,
    };
    return {
      binding,
      deadline: Math.min(
        request.requestExpiresAt,
        grant.expiresAt ?? Number.MAX_SAFE_INTEGER,
        now + 300_000,
      ),
    };
  });
  const intentWrite = Effect.fn("VaultAccess.intentWrite")(function* (
    policy: AccessPolicy.ProtectedPolicy,
    version: number,
    intent: AccessPolicy.OperationIntent,
    actor: string,
  ) {
    const next = withAudit(
      {
        ...policy,
        revision: policy.revision + 1,
        intents: [...policy.intents.filter((entry) => entry.id !== intent.id), intent],
      },
      {
        id: yield* eventId,
        at: yield* Clock.currentTimeMillis,
        actor,
        type: "decision",
        itemId: intent.binding.itemId,
        grantId: intent.binding.grantId,
        action: "use",
        reason: `intent-${intent.state}`,
        policyRevision: policy.revision + 1,
      },
    );
    // One CAS only. A replay or ambiguous acknowledgement never returns a fresh opportunity.
    yield* persist(next, version);
    return yield* observeIntent(intent);
  });
  const approvalCreate = Effect.fn("VaultAccess.approvalCreate")(function* (
    input: VaultApprovalCreate,
    actor: string,
    authorize: Effect.Effect<void, VaultError>,
  ) {
    if (!isApprovalCreate(input) || !actor.trim() || actor.length > 256)
      return yield* new VaultError({ reason: "invalid-input" });
    const fingerprint = yield* hash(
      yield* encodeApprovalCreate({ input, actor }).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      ),
    );
    for (let attempt = 0; attempt < 4; attempt++) {
      yield* authorize;
      const loaded = yield* load();
      const { policy } = yield* trimApprovals(loaded.policy, yield* Clock.currentTimeMillis);
      const version = loaded.version;
      const old = policy.approvals?.find((r) => r.request.id === input.id);
      if (old) {
        if (old.fingerprint !== fingerprint) return yield* new VaultError({ reason: "conflict" });
        const request = approvalView(old.request, policy, yield* Clock.currentTimeMillis);
        yield* notifications.changed(request);
        return request;
      }
      if (
        (policy.approvals?.length ?? 0) >= 128 ||
        policy.grants.some((g) => g.definition.id === input.id)
      )
        return yield* new VaultError({ reason: "conflict" });
      const target = yield* subject(input.threadId),
        item = yield* core.inspect(input.itemId);
      if (!item || item.state !== "active") return yield* new VaultError({ reason: "not-found" });
      const waitingOperation =
        target.thread.activeRunId === null
          ? null
          : { operationId: input.waitingOperationId ?? input.id, runId: target.thread.activeRunId };
      if (
        waitingOperation &&
        retainedApprovals(policy, yield* Clock.currentTimeMillis).some(
          (r) =>
            r.request.threadId === input.threadId &&
            r.request.waitingOperation?.runId === waitingOperation.runId &&
            r.request.waitingOperation.operationId === waitingOperation.operationId,
        )
      )
        return yield* new VaultError({ reason: "conflict" });
      const now = yield* Clock.currentTimeMillis;
      const request: VaultApprovalRequest = {
        ...input,
        waitingOperation,
        projectId: target.projectId,
        itemVersion: item.version,
        policyRevision: policy.revision,
        revision: 1,
        requestedBy: actor,
        requestedAt: now,
        requestExpiresAt: now + VAULT_APPROVAL_PENDING_MS,
        state: "pending",
        decidedBy: null,
        approvedUntil: null,
        grantId: null,
      };
      const base = policy.schemaVersion === 4 ? policy : { ...policy, schemaVersion: 3 as const };
      const next: Policy = {
        ...base,
        approvals: [...(policy.approvals ?? []), { request, fingerprint, lastOperation: null }],
      };
      yield* authorize;
      const result = yield* persist(next, version).pipe(Effect.result);
      if (result._tag === "Success") {
        yield* notifications.changed(request);
        yield* notifications.pending(request);
        return request;
      }
      if (result.failure.reason !== "conflict") return yield* result.failure;
    }
    return yield* new VaultError({ reason: "conflict" });
  });
  const approvalChange = Effect.fn("VaultAccess.approvalChange")(function* (
    input: VaultApprovalChange,
    actor: string,
    authorize: Effect.Effect<void, VaultError>,
    requester?: ThreadId,
  ) {
    if (!isApprovalChange(input) || !actor.trim() || actor.length > 256)
      return yield* new VaultError({ reason: "invalid-input" });
    if (
      requester
        ? input.decision !== "cancel" || actor !== `thread:${requester}`
        : actor.startsWith("thread:")
    )
      return yield* new VaultError({ reason: "denied" });
    const fingerprint = yield* hash(
      yield* encodeApprovalChange({ input, actor }).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      ),
    );
    for (let attempt = 0; attempt < 4; attempt++) {
      yield* authorize;
      const { policy, version } = yield* load();
      const now = yield* Clock.currentTimeMillis;
      if (requester) yield* subject(requester);
      const stored = requester
        ? yield* requesterRecord(policy, input.id, requester, now)
        : retainedApprovals(policy, now).find((r) => r.request.id === input.id);
      if (!stored) return yield* new VaultError({ reason: "not-found" });
      if (stored.lastOperation?.id === input.operationId) {
        if (stored.lastOperation.fingerprint !== fingerprint)
          return yield* new VaultError({ reason: "conflict" });
        return approvalView(stored.request, policy, yield* Clock.currentTimeMillis);
      }
      if (
        stored.request.revision !== input.expectedRevision ||
        (!requester && policy.revision !== input.expectedPolicyRevision)
      )
        return yield* new VaultError({ reason: "conflict" });
      const request = stored.request;
      let grants = policy.grants;
      let grantId = request.grantId,
        approvedUntil = request.approvedUntil;
      if (input.decision === "revoke") {
        if (request.state !== "approved" || !grantId)
          return yield* new VaultError({ reason: "conflict" });
        grants = grants.map((g) =>
          g.definition.id === grantId
            ? { ...g, state: "revoked" as const, revision: g.revision + 1, updatedBy: actor }
            : g,
        );
      } else {
        if (request.state !== "pending" || now >= request.requestExpiresAt)
          return yield* new VaultError({ reason: "conflict" });
        if (input.decision === "approve") {
          if (AccessPolicy.credentialUseRefusal(policy, request.itemId))
            return yield* new VaultError({ reason: "denied" });
          const target = yield* subject(request.threadId),
            item = yield* core.inspect(request.itemId);
          if (
            (request.waitingOperation != null &&
              request.waitingOperation.runId !== target.thread.activeRunId) ||
            target.projectId !== request.projectId ||
            !item ||
            item.state !== "active" ||
            item.version !== request.itemVersion
          )
            return yield* new VaultError({ reason: "conflict" });
          if (grants.length >= 128 || grants.some((g) => g.definition.id === request.id))
            return yield* new VaultError({ reason: "conflict" });
          grantId = request.id;
          approvedUntil = now + input.durationMs;
          const grant = yield* prepare(
            {
              operationId: input.operationId,
              expectedRevision: policy.revision,
              change: {
                type: "save",
                grant: {
                  id: grantId,
                  label: "Temporary Vault approval",
                  principal: { kind: "thread", id: request.threadId },
                  projectId: request.projectId,
                  itemIds: [request.itemId],
                  actions: [request.action],
                  destination: request.destination,
                  notBefore: now,
                  expiresAt: approvedUntil,
                  parentId: null,
                },
              },
            },
            policy,
            actor,
          );
          grants = [...grants, grant];
        }
      }
      const changed: VaultApprovalRequest = {
        ...request,
        revision: request.revision + 1,
        state:
          input.decision === "approve"
            ? "approved"
            : input.decision === "deny"
              ? "denied"
              : input.decision === "cancel"
                ? "cancelled"
                : "revoked",
        decidedBy: actor,
        approvedUntil,
        grantId,
      };
      const updated = {
        ...policy,
        revision: policy.revision + 1,
        grants,
        approvals: (policy.approvals ?? []).map((r) =>
          r.request.id === input.id
            ? { ...r, request: changed, lastOperation: { id: input.operationId, fingerprint } }
            : r,
        ),
      };
      const next = withAudit(updated, {
        id: yield* eventId,
        at: now,
        actor,
        type: "grant-change",
        itemId: request.itemId,
        grantId,
        action: request.action,
        reason: `approval-${changed.state}`,
        policyRevision: updated.revision,
      });
      yield* authorize;
      if (
        input.decision !== "revoke" &&
        (yield* Clock.currentTimeMillis) >= request.requestExpiresAt
      )
        return yield* new VaultError({ reason: "conflict" });
      const result = yield* persist(next, version).pipe(Effect.result);
      if (result._tag === "Success") {
        const request = approvalView(changed, next, yield* Clock.currentTimeMillis);
        yield* notifications.changed(request);
        return request;
      }
      if (result.failure.reason !== "conflict") return yield* result.failure;
    }
    return yield* new VaultError({ reason: "conflict" });
  });
  return VaultAccess.of({
    protectionMigrationPreview: Effect.fn("VaultAccess.protectionMigrationPreview")(
      function* (raw, actor, authorize) {
        const input = yield* decodeMigrationPreviewInput(raw).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        );
        yield* requireAdministrator(actor);
        yield* authorize;
        const { policy, version } = yield* load();
        if (policy.schemaVersion === 4 || policy.revision !== input.expectedPolicyRevision)
          return yield* new VaultError({ reason: "conflict" });
        const inventory = Effect.gen(function* () {
          const items: VaultItemPage["items"][number][] = [];
          let cursor: string | null = null;
          do {
            const page: VaultItemPage = yield* core.list({ cursor, includeArchived: true });
            items.push(...page.items);
            if (items.length > 128) return yield* new VaultError({ reason: "invalid-input" });
            if (page.nextCursor !== null && cursor !== null && page.nextCursor <= cursor)
              return yield* new VaultError({ reason: "invalid-response" });
            cursor = page.nextCursor;
          } while (cursor !== null);
          return items
            .map((item) => ({ id: item.id, version: item.version }))
            .sort((a, b) => a.id.localeCompare(b.id));
        });
        const items = yield* inventory;
        const sameInventory = (
          a: ReadonlyArray<{ readonly id: string; readonly version: number }>,
          b: ReadonlyArray<{ readonly id: string; readonly version: number }>,
        ) =>
          a.length === b.length &&
          a.every((item, i) => item.id === b[i]?.id && item.version === b[i]?.version);
        if (
          new Set(input.selections.map((entry) => entry.itemId)).size !== input.selections.length ||
          !sameInventory(
            items,
            input.selections
              .map((entry) => ({ id: entry.itemId, version: entry.itemVersion }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          )
        )
          return yield* new VaultError({ reason: "conflict" });
        yield* authorize;
        if (!sameInventory(yield* inventory, items) || (yield* load()).version !== version)
          return yield* new VaultError({ reason: "conflict" });
        const now = yield* Clock.currentTimeMillis;
        const proposal: AccessPolicy.ProtectedPolicy = {
          ...policy,
          schemaVersion: 4,
          environmentId,
          revision: policy.revision + 1,
          credentialModes: input.selections.map((entry) => ({
            itemId: entry.itemId,
            mode: entry.mode,
            revision: 1,
            updatedBy: actor,
            updatedAt: now,
          })),
          intents: [],
        };
        return { sourceStorageVersion: version, proposal, canMigrate: false };
      },
    ),
    credentialModeChange: Effect.fn("VaultAccess.credentialModeChange")(
      function* (raw, actor, authorize) {
        const input = yield* decodeModeChange(raw).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        );
        yield* requireAdministrator(actor);
        yield* authorize;
        const loaded = yield* load();
        const policy = yield* requireProtectedPolicy(loaded.policy);
        if (policy.revision !== input.expectedPolicyRevision)
          return yield* new VaultError({ reason: "conflict" });
        const old = policy.credentialModes.find((entry) => entry.itemId === input.itemId);
        if (old?.mode === "one-time" && input.mode !== "one-time")
          return yield* new VaultError({ reason: "denied" });
        const check = Effect.gen(function* () {
          const item = yield* core.inspect(input.itemId);
          if (!item || item.state !== "active" || item.version !== input.itemVersion)
            return yield* new VaultError({ reason: "conflict" });
        });
        yield* check;
        yield* authorize;
        yield* check;
        const now = yield* Clock.currentTimeMillis;
        if (old && now < old.updatedAt) return yield* new VaultError({ reason: "unavailable" });
        if (old?.mode === input.mode) return old;
        const mode = {
          itemId: input.itemId,
          mode: input.mode,
          revision: (old?.revision ?? 0) + 1,
          updatedBy: actor,
          updatedAt: now,
        };
        const next = withAudit(
          {
            ...policy,
            revision: policy.revision + 1,
            credentialModes: [
              ...policy.credentialModes.filter((entry) => entry.itemId !== input.itemId),
              mode,
            ],
          },
          {
            id: yield* eventId,
            at: now,
            actor,
            type: "grant-change",
            itemId: input.itemId,
            grantId: null,
            action: "manage",
            reason: "credential-protection-change",
            policyRevision: policy.revision + 1,
          },
        );
        yield* persist(next, loaded.version);
        return mode;
      },
    ),
    intentPreview: Effect.fn("VaultAccess.intentPreview")(function* (raw, actor, authorize) {
      const input = yield* decodeIntentProposal(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      yield* requireAdministrator(actor);
      yield* authorize;
      const loaded = yield* load();
      const policy = yield* requireProtectedPolicy(loaded.policy);
      const prepared = yield* intentBinding(policy, input);
      yield* authorize;
      const latest = yield* intentBinding(policy, input);
      if (
        !sameBinding(latest.binding, prepared.binding) ||
        (yield* load()).version !== loaded.version
      )
        return yield* new VaultError({ reason: "conflict" });
      return {
        binding: latest.binding,
        policyRevision: policy.revision,
        expiresNoLaterThan: Math.min(prepared.deadline, latest.deadline),
        canExecute: false,
      };
    }),
    intentReview: Effect.fn("VaultAccess.intentReview")(function* (raw, actor, authorize) {
      const input = yield* decodeIntentReview(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      yield* requireAdministrator(actor);
      yield* authorize;
      const loaded = yield* load();
      const policy = yield* requireProtectedPolicy(loaded.policy);
      if (
        policy.revision !== input.expectedPolicyRevision ||
        policy.intents.length >= 128 ||
        policy.intents.some(
          (entry) =>
            entry.id === input.id ||
            entry.binding.requestId === input.requestId ||
            ((entry.state === "reserved" || entry.state === "unknown") &&
              entry.binding.itemId ===
                policy.approvals?.find((entry) => entry.request.id === input.requestId)?.request
                  .itemId),
        )
      )
        return yield* new VaultError({ reason: "conflict" });
      const prepared = yield* intentBinding(policy, input);
      if (input.reviewedDigest !== prepared.binding.operationDigest)
        return yield* new VaultError({ reason: "conflict" });
      yield* authorize;
      const latest = yield* intentBinding(policy, input);
      const now = yield* Clock.currentTimeMillis;
      if (
        !sameBinding(latest.binding, prepared.binding) ||
        now >= input.expiresAt ||
        input.expiresAt > Math.min(prepared.deadline, latest.deadline)
      )
        return yield* new VaultError({ reason: "conflict" });
      return yield* intentWrite(
        policy,
        loaded.version,
        {
          id: input.id,
          binding: latest.binding,
          revision: 1,
          reviewedBy: actor,
          reviewedAt: now,
          expiresAt: input.expiresAt,
          updatedAt: now,
          state: "reviewed",
          reservationId: null,
        },
        actor,
      );
    }),
    intentReserve: Effect.fn("VaultAccess.intentReserve")(function* (raw, requester, authorize) {
      const input = yield* decodeIntentReservation(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      yield* authorize;
      const loaded = yield* load();
      const policy = yield* requireProtectedPolicy(loaded.policy);
      const intent = policy.intents.find((entry) => entry.id === input.id);
      if (
        policy.revision !== input.expectedPolicyRevision ||
        !intent ||
        intent.state !== "reviewed" ||
        intent.revision !== input.expectedIntentRevision ||
        intent.binding.threadId !== requester ||
        // Reviews of one item can coexist, so a reservation must recheck that no other intent for
        // the item is in flight or awaiting reconciliation. intentWrite CASes this policy version.
        policy.intents.some(
          (entry) =>
            entry.id !== intent.id &&
            entry.binding.itemId === intent.binding.itemId &&
            (entry.state === "reserved" || entry.state === "unknown"),
        )
      )
        return yield* new VaultError({ reason: "conflict" });
      const prepared = yield* intentBinding(policy, input);
      if (!sameBinding(intent.binding, prepared.binding))
        return yield* new VaultError({ reason: "conflict" });
      yield* authorize;
      const latest = yield* intentBinding(policy, input);
      const reservationId = yield* eventId;
      const now = yield* Clock.currentTimeMillis;
      if (
        now < intent.updatedAt ||
        now >= intent.expiresAt ||
        !sameBinding(intent.binding, latest.binding)
      )
        return yield* new VaultError({ reason: "conflict" });
      return yield* intentWrite(
        policy,
        loaded.version,
        {
          ...intent,
          state: "reserved",
          reservationId,
          revision: intent.revision + 1,
          updatedAt: now,
        },
        `thread:${requester}`,
      );
    }),
    intentStatus: Effect.fn("VaultAccess.intentStatus")(function* (id, actor, authorize) {
      yield* requireAdministrator(actor);
      yield* authorize;
      const policy = yield* requireProtectedPolicy((yield* load()).policy);
      const intent = policy.intents.find((entry) => entry.id === id);
      if (!intent) return yield* new VaultError({ reason: "not-found" });
      return yield* observeIntent(intent);
    }),
    intentClose: Effect.fn("VaultAccess.intentClose")(function* (raw, actor, authorize) {
      const input = yield* decodeIntentClose(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      yield* requireAdministrator(actor);
      yield* authorize;
      const loaded = yield* load();
      const policy = yield* requireProtectedPolicy(loaded.policy);
      const intent = policy.intents.find((entry) => entry.id === input.id);
      if (
        policy.revision !== input.expectedPolicyRevision ||
        !intent ||
        intent.revision !== input.expectedIntentRevision ||
        (intent.state !== "reviewed" && intent.state !== "reserved")
      )
        return yield* new VaultError({ reason: "conflict" });
      yield* authorize;
      const now = yield* Clock.currentTimeMillis;
      if (now < intent.updatedAt) return yield* new VaultError({ reason: "unavailable" });
      return yield* intentWrite(
        policy,
        loaded.version,
        {
          ...intent,
          state: intent.state === "reserved" ? "unknown" : "revoked",
          revision: intent.revision + 1,
          updatedAt: now,
        },
        actor,
      );
    }),
    reveal: Effect.fn("VaultAccess.reveal")(function* (input, actor, destinationThreadId) {
      if (!isAuditActor(actor)) return yield* new VaultError({ reason: "invalid-input" });
      // Human disclosure requires a durable audit; broker reads use their own audited authority.
      for (let attempt = 0; attempt < 4; attempt++) {
        const { policy, version } = yield* load();
        // The audit write below is conditional on this read's version, so a policy change
        // after it fails the write and this attempt's value is never returned.
        const value = yield* core.reveal(input, version === 0 ? null : policy);
        const next = withAudit(policy, {
          id: yield* eventId,
          at: yield* Clock.currentTimeMillis,
          actor,
          type: "decision",
          itemId: value.item.id,
          grantId: null,
          action: "reveal",
          reason:
            destinationThreadId === undefined
              ? "allowed"
              : `Allowed for secret request in thread ${destinationThreadId}`,
          policyRevision: policy.revision,
        });
        const persisted = yield* persist(next, version).pipe(Effect.result);
        if (persisted._tag === "Success") return value;
        if (persisted.failure.reason !== "conflict") return yield* persisted.failure;
      }
      return yield* new VaultError({ reason: "conflict" });
    }),
    approvalPrepareRetry,
    approvalRetain,
    approvalStatus,
    approvalCancel: Effect.fn("VaultAccess.approvalCancel")(
      function* (input, requester, authorize) {
        if (!isApprovalCancel(input)) return yield* new VaultError({ reason: "invalid-input" });
        return yield* approvalChange(
          {
            id: input.id,
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
            expectedPolicyRevision: 0,
            decision: "cancel",
            durationMs: 300_000,
          },
          `thread:${requester}`,
          authorize,
          requester,
        );
      },
    ),
    approvalCreate: Effect.fn("VaultAccess.requestApproval")(function* (
      input,
      actor,
      authorize,
      wait = false,
    ) {
      if (wait && actor !== `thread:${input.threadId}`)
        return yield* new VaultError({ reason: "denied" });
      const request = yield* approvalCreate(input, actor, authorize);
      if (!wait) return request;
      yield* notifications.waitForDecision(request);
      const { policy } = yield* load();
      const status = yield* approvalStatusFromPolicy(
        policy,
        yield* Clock.currentTimeMillis,
        request.id,
        input.threadId,
      );
      return status.request;
    }),
    approvalChange,
    approvalContext: Effect.fn("VaultAccess.approvalContext")(function* (input) {
      const { policy } = yield* load(),
        now = yield* Clock.currentTimeMillis;
      // This diagnostic path must not resolve context for other requesters or unrelated inbox rows.
      return retainedApprovals(policy, now)
        .filter(
          ({ request: r }) =>
            r.threadId === input.threadId &&
            r.projectId === input.projectId &&
            r.itemId === input.itemId &&
            (!input.restrictMetadata || r.requestedBy === `thread:${input.threadId}`),
        )
        .map(({ request }) => approvalView(request, policy, now))
        .filter(
          (r) =>
            !["pending", "approved"].includes(r.state) ||
            (r.itemVersion === input.itemVersion &&
              (!r.waitingOperation || r.waitingOperation.runId === input.runId)),
        );
    }),
    approvalInbox: Effect.gen(function* () {
      const { policy } = yield* load(),
        now = yield* Clock.currentTimeMillis;
      const requests = retainedApprovals(policy, now)
        .map((r) => approvalView(r.request, policy, now))
        .toReversed();
      return {
        policyRevision: policy.revision,
        retention: { maxAgeMs: VAULT_APPROVAL_RETENTION_MS, maxRequests: 128 as const },
        requests,
        notifications: "stubbed" as const,
        notificationOutcomes: yield* notifications.outcomes(requests),
        reviewContext: yield* Effect.gen(function* () {
          const names = yield* Effect.all(
            {
              threads: Effect.forEach(
                [...new Set(requests.map((r) => r.threadId))],
                (id) =>
                  readVaultThreadShell(threads, id).pipe(
                    Effect.orElseSucceed(() => null),
                    Effect.map((value) => [id, value] as const),
                  ),
                { concurrency: 4 },
              ),
              projects: Effect.forEach(
                [...new Set(requests.map((r) => r.projectId))],
                (id) =>
                  projects.get(ProjectId.make(id), { includeDeleted: true }).pipe(
                    Effect.map(Option.getOrNull),
                    Effect.orElseSucceed(() => null),
                    Effect.map((value) => [id, value] as const),
                  ),
                { concurrency: 4 },
              ),
              items: Effect.forEach(
                [...new Set(requests.map((r) => r.itemId))],
                (id) =>
                  core.inspect(id).pipe(
                    Effect.orElseSucceed(() => null),
                    Effect.map((value) => [id, value] as const),
                  ),
                { concurrency: 4 },
              ),
            },
            { concurrency: 3 },
          );
          const threadMap = new Map(names.threads),
            projectMap = new Map(names.projects),
            itemMap = new Map(names.items);
          return requests.map((r) => {
            const thread = threadMap.get(r.threadId),
              project = projectMap.get(r.projectId),
              item = itemMap.get(r.itemId);
            const state =
              !thread || !project || !item
                ? ("unavailable" as const)
                : thread.projectId !== r.projectId ||
                    thread.archivedAt !== null ||
                    thread.deletedAt !== null ||
                    project.deletedAt != null ||
                    item.state !== "active" ||
                    item.version !== r.itemVersion ||
                    (r.waitingOperation != null && r.waitingOperation.runId !== thread.activeRunId)
                  ? ("changed" as const)
                  : ("current" as const);
            return {
              requestId: r.id,
              threadTitle: thread?.title?.slice(0, 200) || null,
              projectTitle: project?.title?.slice(0, 200) || null,
              itemLabel: item?.label ?? null,
              state,
            };
          });
        }),
      };
    }),
    catalog: Effect.gen(function* () {
      const shell = yield* threads.getShellSnapshot();
      const projectList = yield* projects.listShells();
      const available = shell.threads.filter(
        (thread) => thread.deletedAt === null && thread.archivedAt === null,
      );
      return {
        subjects: [
          ...projectList.slice(0, 250).map((project) => ({
            principal: { kind: "project" as const, id: project.id },
            label: project.title,
            projectId: project.id,
          })),
          ...available.slice(0, 250).map((thread) => ({
            principal: { kind: "thread" as const, id: thread.id },
            label: thread.title,
            projectId: thread.projectId,
          })),
        ],
        truncated: projectList.length > 250 || available.length > 250,
      };
    }).pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" }))),
    snapshot: Effect.map(load(), ({ policy }) => snapshotView(policy)),
    setOwnerPolicy: Effect.fn("VaultAccess.setOwnerPolicy")(function* (raw, actor, authorize) {
      const input = yield* decodeOwnerPolicyChange(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      // This is a declaration of a single-owner environment, not a global identity directory.
      // The transport proves human owner administration; agents cannot make this declaration.
      if (
        !isAdministrator(actor) ||
        actor === "mcp-client" ||
        ["client:", "broker:", "host:", "library:", "loom-host:"].some((prefix) =>
          actor.startsWith(prefix),
        )
      )
        return yield* new VaultError({ reason: "denied" });
      const fingerprint = yield* hash(
        yield* encodeOwnerPolicyChange({ input, actor }).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        ),
      );
      for (let attempt = 0; attempt < 4; attempt++) {
        yield* authorize;
        const { policy, version } = yield* load();
        if (policy.ownerPolicy && policy.ownerPolicy.ownerSubject !== actor)
          return yield* new VaultError({ reason: "denied" });
        if (
          policy.receipts.some((entry) => entry.id === input.operationId) ||
          policy.batchReceipts?.some((entry) => entry.id === input.operationId)
        )
          return yield* new VaultError({ reason: "conflict" });
        const receipt = policy.ownerReceipts?.find((entry) => entry.id === input.operationId);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            return yield* new VaultError({ reason: "conflict" });
          yield* authorize;
          // A replay observes current state and never re-enables a subsequently disabled policy.
          return snapshotView(policy);
        }
        if (policy.revision !== input.expectedRevision)
          return yield* new VaultError({ reason: "conflict" });
        const now = yield* Clock.currentTimeMillis;
        if (policy.ownerPolicy && now < policy.ownerPolicy.updatedAt)
          return yield* new VaultError({ reason: "unavailable" });
        const ownerId = policy.ownerPolicy?.ownerId ?? (yield* eventId);
        const revision = policy.revision + 1;
        const next = withAudit(
          {
            ...policy,
            revision,
            ownerPolicy: {
              environmentId,
              ownerId,
              ownerSubject: actor,
              mode: input.mode,
              updatedAt: now,
              updatedBy: actor,
            },
            ownerReceipts: [
              ...(policy.ownerReceipts ?? []),
              { id: input.operationId, fingerprint, revision },
            ].slice(-32),
          },
          {
            id: yield* eventId,
            at: now,
            actor,
            type: "owner-policy-change",
            itemId: null,
            grantId: null,
            action: null,
            reason: input.mode,
            policyRevision: revision,
            authorization: {
              category: "owner-policy-change",
              environmentId,
              ownerId,
              threadId: null,
              runId: null,
              destinationDigest: null,
              itemKind: null,
            },
          },
        );
        yield* authorize;
        const saved = yield* persist(next, version).pipe(Effect.result);
        if (saved._tag === "Success") return snapshotView(next);
        if (saved.failure.reason !== "conflict") return yield* saved.failure;
      }
      return yield* new VaultError({ reason: "conflict" });
    }),
    apply,
    applyBatch,
    previewBatch: Effect.fn("VaultAccess.previewBatch")(function* (input, actor) {
      const { policy } = yield* load();
      const { grants, finalGrants } = yield* prepareBatch(input, policy, actor);
      const impacted = new Set(grants.map((grant) => grant.definition.id));
      const combined = [...policy.grants, ...finalGrants];
      for (let count = 0; count < finalGrants.length; count++)
        for (const grant of combined)
          if (grant.definition.parentId !== null && impacted.has(grant.definition.parentId))
            impacted.add(grant.definition.id);
      return {
        policyRevision: policy.revision,
        grants,
        affectedGrantIds: [...impacted],
        knownItemIds: [
          ...new Set(
            combined
              .filter((grant) => impacted.has(grant.definition.id))
              .flatMap((grant) => grant.definition.itemIds),
          ),
        ],
        unknowns: PREVIEW_UNKNOWN,
      };
    }),
    require: requireAccess,
    preview: Effect.fn("VaultAccess.preview")(function* (input, actor) {
      const { policy } = yield* load();
      const grant = yield* prepare(input, policy, actor);
      const impacted = new Set([grant.definition.id]);
      for (let count = 0; count < policy.grants.length; count++)
        for (const other of policy.grants)
          if (other.definition.parentId !== null && impacted.has(other.definition.parentId))
            impacted.add(other.definition.id);
      return {
        policyRevision: policy.revision,
        grant,
        affectedGrantIds: [...impacted],
        knownItemIds: [
          ...new Set(
            policy.grants
              .filter((value) => impacted.has(value.definition.id))
              .flatMap((value) => value.definition.itemIds)
              .concat(grant.definition.itemIds),
          ),
        ],
        unknowns: PREVIEW_UNKNOWN,
      };
    }),
    explain: Effect.fn("VaultAccess.explain")(function* (input, restrictMetadata) {
      const { policy } = yield* load();
      const reads = yield* decisionReads(input);
      const { workload, item, result } = yield* evaluate(policy, input, reads);
      // The metadata check differs only in its action, so it shares this call's policy, thread,
      // item and active-run reads instead of reading them all again.
      const inspect =
        restrictMetadata && input.action !== "inspect"
          ? (yield* evaluate(policy, { ...input, action: "inspect" }, reads)).result
          : result;
      return {
        environmentId,
        threadId: input.threadId,
        projectId: workload.projectId,
        item: restrictMetadata && !inspect.allowed ? null : item,
        decision: result,
        recentDecisions: policy.audit
          .toReversed()
          .filter(
            (event) =>
              event.type === "decision" &&
              event.actor === `thread:${input.threadId}` &&
              event.itemId === input.itemId,
          )
          .slice(0, 10),
        unknowns: UNKNOWN,
      };
    }),
    listForThread: Effect.fn("VaultAccess.listForThread")(function* (input, threadId) {
      const { policy } = yield* load();
      const workload = yield* subject(threadId);
      // Owner access gates the caller, not the items. Fail with the cause rather than return an
      // empty page, which reads as "no such connection" and leads agents to recreate one.
      if (policy.ownerPolicy?.mode === "owner-trusted") {
        if (
          workload.thread.runtimeMode !== "full-access" ||
          workload.thread.interactionMode !== "default"
        )
          return yield* new VaultError({ reason: "denied", detail: "caller-permission" });
        if (!(yield* isVaultRunRunning(threads, workload.thread)))
          return yield* new VaultError({ reason: "denied", detail: "workload-inactive" });
      }
      const page = yield* core.list(input);
      const now = yield* Clock.currentTimeMillis;
      return {
        nextCursor: page.nextCursor,
        items: page.items.filter(
          (item) =>
            evaluateVaultPolicy(
              policy.grants,
              workload,
              { itemId: item.id, action: "inspect", destination: null },
              now,
              policy.revision,
              ownerPolicyView(policy),
            ).allowed,
        ),
      };
    }),
    delegate: Effect.fn("VaultAccess.delegate")(function* (input, threadId, authorize) {
      const caller = yield* subject(threadId);
      const target = yield* subject(input.childThreadId);
      if (
        target.thread.lineage.parentThreadId !== threadId ||
        target.thread.lineage.relationshipToParent !== "subagent" ||
        target.projectId !== caller.projectId ||
        input.grant.principal.kind !== "thread" ||
        input.grant.principal.id !== input.childThreadId ||
        input.grant.parentId === null
      )
        return yield* new VaultError({ reason: "denied" });
      const recheck = Effect.gen(function* () {
        yield* authorize;
        const { policy } = yield* load();
        const parent = policy.grants.find((value) => value.definition.id === input.grant.parentId);
        const existing = policy.grants.find((value) => value.definition.id === input.grant.id);
        if (
          existing &&
          (existing.createdBy !== `thread:${threadId}` ||
            existing.definition.parentId !== input.grant.parentId ||
            existing.definition.principal.id !== input.childThreadId)
        )
          return yield* new VaultError({ reason: "denied" });
        if (
          !parent ||
          !grantMatchesWorkload(parent, caller) ||
          parent.state !== "active" ||
          !parent.definition.actions.includes("delegate")
        )
          return yield* new VaultError({ reason: "denied" });
        for (const itemId of input.grant.itemIds) {
          const allowed = evaluateVaultPolicy(
            policy.grants,
            caller,
            { itemId, action: "delegate", destination: input.grant.destination },
            yield* Clock.currentTimeMillis,
            policy.revision,
          );
          if (
            AccessPolicy.credentialUseRefusal(policy, itemId) ||
            !allowed.allowed ||
            allowed.grantId !== parent.definition.id
          )
            return yield* new VaultError({ reason: "denied" });
        }
      });
      return yield* apply(
        {
          operationId: input.operationId,
          expectedRevision: input.expectedRevision,
          change: { type: "save", grant: input.grant },
        },
        `thread:${threadId}`,
        recheck,
      );
    }),
    readiness: Effect.fn("VaultAccess.readiness")(function* (input) {
      const checkedAt = yield* Clock.currentTimeMillis;
      const workload = yield* subject(input.threadId);
      const backend = yield* core.status;
      const checks: VaultReadinessReport["checks"][number][] = [
        {
          id: "backend",
          state: backend.state === "ready" ? "passed" : "blocked",
          reason:
            backend.state === "ready"
              ? "Vault connection is available; item writes were not exercised."
              : backend.state,
          repair:
            backend.state === "ready"
              ? "No repair needed."
              : "Check the environment's OpenBao connection and refresh.",
        },
        {
          id: "workload",
          state: workload.thread.activeRunId !== null ? "passed" : "blocked",
          reason:
            workload.thread.activeRunId !== null
              ? "Authenticated active Loom thread."
              : "Thread has no active run.",
          repair: "Check the intended runner's live thread, not a terminal login.",
        },
      ];
      const decisions: VaultAccessDecision[] = [];
      if (backend.state === "ready") {
        const { policy } = yield* load();
        const trusted = policy.ownerPolicy?.mode === "owner-trusted";
        const ownerWorkload =
          trusted &&
          workload.thread.runtimeMode === "full-access" &&
          workload.thread.interactionMode === "default" &&
          (yield* isVaultRunRunning(threads, workload.thread));
        checks.push({
          id: "owner-policy",
          state: !trusted || ownerWorkload ? "passed" : "blocked",
          reason: trusted
            ? "Owner-trusted environment policy covers routine metadata inspection and brokered use."
            : "Restricted environment policy requires current grants.",
          repair:
            !trusted || ownerWorkload
              ? "No repair needed."
              : "Restore this environment's active full-access/default run and refresh.",
        });
        for (const [index, requirement] of input.requirements.entries()) {
          const result = yield* decision(policy, { ...requirement, threadId: input.threadId });
          decisions.push(result.result);
          checks.push({
            id: `grant:${requirement.itemId}:${requirement.action}:${index}`,
            state: result.result.allowed ? "passed" : "blocked",
            reason: result.result.reason,
            repair: result.result.allowed
              ? "No repair needed."
              : trusted && (requirement.action === "inspect" || requirement.action === "use")
                ? "Inspect current item lifecycle, credential protection and live workload; owner trust does not bypass these checks."
                : "Inspect the item and grant; restore or request access from an administrator.",
          });
        }
      }
      const needsDelivery = input.requirements.some(
        (value) => value.action === "use" || value.action === "reveal" || value.action === "export",
      );
      if (needsDelivery || input.requirements.length === 0)
        checks.push({
          id: "broker-delivery",
          state: "unsupported",
          reason:
            "This readiness check does not perform an enrolled-broker or credential-use probe.",
          repair:
            "Run a supported signed SSH operation to verify that destination. Provider launch and Git readiness are not verified here.",
        });
      return {
        environmentId,
        threadId: input.threadId,
        checkedAt,
        freshUntil: checkedAt + 60_000,
        context: "loom-server",
        backend,
        checks,
        decisions,
        ready: checks.every((check) => check.state === "passed"),
      };
    }),
  });
});
export const layer = Layer.effect(VaultAccess, make);

export const reactor = Layer.effectDiscard(
  Effect.gen(function* () {
    const service = yield* VaultAccess;
    yield* service.approvalRetain.pipe(
      Effect.catch(() => Effect.void),
      Effect.repeat(Schedule.spaced("1 minute")),
      Effect.forkScoped,
    );
  }),
);
