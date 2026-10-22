import { OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import {
  VaultApprovalRetryInput,
  VaultApprovalRetryReport,
  VaultApprovalStatusInput,
  VaultApprovalRecoveryStatus,
  VaultApprovalCancel,
  VaultApprovalRequesterStatus,
  VaultApprovalCreate,
  VaultApprovalRequest,
  VaultError,
  VaultOwnerPolicy,
  VaultConnectionRequest,
  VaultConnectionReport,
  VaultPolicySnapshot,
  VaultGrantMutation,
  VaultGrant,
  VaultGrantPreview,
  VaultOwnDecisionInput,
  VaultAccessExplanation,
  VaultReadinessReport,
  VaultDelegateInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultAccessInspector from "./VaultAccessInspector.ts";
import * as VaultReadiness from "./VaultReadiness.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultConnections from "./VaultConnections.ts";
import * as OperationJournal from "./OperationJournal.ts";
const failure = Schema.Union([VaultError, OrchestratorMcpFailure]);
const explainInput = Schema.Struct({
  ...VaultOwnDecisionInput.fields,
  threadId: Schema.optional(ThreadId),
});
const ownReadiness = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  requirements: Schema.Array(VaultOwnDecisionInput).check(Schema.isMaxLength(16)),
});
const dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultAccessToolkit = Toolkit.make(
  Tool.make("loom_vault_owner_policy", {
    description:
      "Read this environment's durable Vault access mode. Owner-trusted mode makes metadata and brokered credential use available to authenticated owner agents without individual grants or profiles. It grants no task authority, raw reveal, export or policy administration. Only the human owner can enable or disable it in Vault settings.",
    success: VaultOwnerPolicy,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_connections_resolve", {
    description:
      "Find a Vault SSH, Git-over-SSH or GitHub connection by resource name, host, repository or safe account metadata. Use connection:{resource:personal-vps}, kind:ssh for a saved VPS, or kind:github with a repository. No project profile is required. A unique compatible connection is selected automatically; ambiguity returns meaningful safe choices. The selected item/version/destination is an operation pin, not permission. Execution rechecks current policy, lifecycle and host trust. Returns specific setup or repair states without secret values. Broker availability and upstream authentication are verified by execution/readiness separately.",
    parameters: VaultConnectionRequest,
    success: VaultConnectionReport,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_access_recovery_status", {
    description:
      "Read only your authenticated thread's retained Vault request and safe operation-journal recovery summary. Reservations and uncertain outcomes require external review, never replay. Missing journal evidence does not prove an operation never ran. This read never writes, reconciles, dispatches or resumes anything. All execution, automatic-resumption and allow-once gates stay closed. Corrupt or unavailable journal evidence fails closed without blocking ordinary approvals.",
    parameters: VaultApprovalStatusInput,
    success: VaultApprovalRecoveryStatus,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_access_retry_prepare", {
    description:
      "Read-only preparation/recovery validation for your own run-bound approved request and a typed SSH, Git-over-SSH or GitHub API proposal. Supply the waiting operation ID, current request revision and previous outcome. Retain the returned operationDigest to detect changed proposals on recovery; it is not an authenticated receipt or execution token. Retained durable reservations and terminal outcomes require review even if you report not-started. Prepared digests must match. Journal outages or corruption fail closed. Unknown write outcomes require external review, never blind replay. The original request approved scope, not this command. No commands are stored or run. Normal adapter validation and fresh access checks remain required. No automatic resumption, allow-once consumption or self-approval.",
    parameters: VaultApprovalRetryInput,
    success: VaultApprovalRetryReport,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_access_request_status", {
    description:
      "Read only your authenticated thread's own Vault request, durable waiting-operation correlation and process-local notification outcome. A saved request is available in the inbox even if no alert was delivered; restart forgets delivery observations and this read never sends an alert. Unknown, other-requester and aged-out IDs return not-found. A retry-ready status is not an execution token: automatic resumption and allow-once consumption remain disabled. Recheck normal access before explicitly retrying an operation.",
    parameters: VaultApprovalStatusInput,
    success: VaultApprovalRequesterStatus,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_access_request_cancel", {
    description:
      "Cancel only your authenticated thread's own pending Vault request, using a stable operation ID and the displayed request revision. This cannot approve, deny or revoke an approved grant. After a race, inspect status before trying again.",
    parameters: VaultApprovalCancel,
    success: VaultApprovalRequest,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_access_request", {
    description:
      "Request temporary Vault access for the authenticated thread. An optional waitingOperationId is an opaque correlation reference; the server binds its own current run. Entries and retry evidence are retained for 24 hours; use new IDs after that window. This records a pending request only; it grants nothing and cannot approve itself. Reuse the same id for retries. A human decides in Loom Vault approvals. After approval, recheck access before explicitly retrying the operation; no automatic resumption or notification transport is provided.",
    parameters: Schema.Struct({
      ...VaultApprovalCreate.fields,
      threadId: Schema.optional(ThreadId),
    }),
    success: VaultApprovalRequest,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_grants", {
    description:
      "Read Vault grant policy and recent decisions as an approved full-access human CLI/MCP client. Threads must use their own access explanation instead.",
    success: VaultPolicySnapshot,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_grants_apply", {
    description:
      "Apply an administrator's reviewed Vault grant mutation using a stable operation ID and current policy revision. Requires a full-access client; agent threads cannot approve their own grants.",
    parameters: VaultGrantMutation,
    success: VaultGrant,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_grants_preview", {
    description:
      "Preview known affected grant descendants and item references without applying anything. Same administrator boundary as grant management; unknown external copies are reported.",
    parameters: VaultGrantMutation,
    success: VaultGrantPreview,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_access_explain", {
    description:
      "Explain this authenticated thread's Vault access using the execution policy evaluator. Full-access administrator clients must supply threadId; a calling thread always uses its own identity. Never returns raw values or another thread's credentials. A reason is a policy explanation, not proof of a successful external login.",
    parameters: explainInput,
    success: VaultAccessExplanation,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_readiness", {
    description:
      "Check declared requirements or optional profile preferences with current provider/run and relevant enrolled-broker presence. A missing optional project profile never blocks access; resolve a resource to check a connection. A configured unreadable or retired run pin still blocks reuse of that pin. Full-access administrator clients must supply threadId; a calling thread always uses its own identity. The result expires after 60 seconds. Missing brokers or delivery adapters are unsupported, never evidence that SSH or GitHub is ready.",
    parameters: ownReadiness,
    success: VaultReadinessReport,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_grants_delegate", {
    description:
      "Delegate a narrower grant to an attested direct subagent thread in the same project. Requires delegate permission on the parent grant. It cannot create a root grant or broaden resources, actions, scope or lifetime.",
    parameters: VaultDelegateInput,
    success: VaultGrant,
    failure,
    dependencies,
  }),
);
export const vaultAccessHandlers = McpToolAccess.toLayer(
  VaultAccessToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    const administrator = Effect.gen(function* () {
      const caller = yield* McpInvocationContext;
      if (caller.thread || caller.client?.access !== "full-access")
        return yield* new VaultError({ reason: "denied" });
      return `client:${caller.client.sessionId}`;
    });
    return {
      loom_vault_owner_policy: McpToolAccess.reads(() =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread) yield* administrator;
          else {
            const threads = yield* ThreadManagementService;
            const thread = yield* threads
              .getThreadShell(caller.thread.threadId)
              .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
            if (!thread || thread.archivedAt !== null || thread.deletedAt !== null)
              return yield* new VaultError({ reason: "denied" });
          }
          return yield* onHost(
            Effect.flatMap(VaultAccess.VaultAccess, (access) =>
              access.snapshot.pipe(
                Effect.flatMap((snapshot) =>
                  snapshot.ownerPolicy
                    ? Effect.succeed(snapshot.ownerPolicy)
                    : Effect.fail(new VaultError({ reason: "unavailable" })),
                ),
              ),
            ),
          );
        }),
      ),
      loom_vault_connections_resolve: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread) return yield* new VaultError({ reason: "denied" });
          return yield* onHost(
            Effect.flatMap(VaultConnections.VaultConnections, (connections) =>
              connections.resolve(input, caller.thread!.threadId),
            ),
          );
        }),
      ),
      loom_vault_access_recovery_status: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread) return yield* new VaultError({ reason: "denied" });
          return yield* onHost(
            Effect.flatMap(OperationJournal.OperationJournal, (journal) =>
              journal.status(input.id, caller.thread!.threadId),
            ),
          );
        }),
      ),
      loom_vault_access_retry_prepare: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread) return yield* new VaultError({ reason: "denied" });
          return yield* onHost(
            Effect.flatMap(OperationJournal.OperationJournal, (journal) =>
              journal.previewRetry(input, caller.thread!.threadId),
            ),
          );
        }),
      ),
      loom_vault_access_request_status: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread) return yield* new VaultError({ reason: "denied" });
          return yield* onHost(
            Effect.flatMap(VaultAccess.VaultAccess, (access) =>
              access.approvalStatus(input.id, caller.thread!.threadId),
            ),
          );
        }),
      ),
      loom_vault_access_request_cancel: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread) return yield* new VaultError({ reason: "denied" });
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.provide(context),
            Effect.asVoid,
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultAccess.VaultAccess, (access) =>
              access.approvalCancel(input, caller.thread!.threadId, authorize),
            ),
          );
        }),
      ),
      loom_vault_access_request: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread) return yield* new VaultError({ reason: "denied" });
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.provide(context),
            Effect.asVoid,
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultAccess.VaultAccess, (access) =>
              access.approvalCreate(
                { ...input, threadId: caller.thread!.threadId },
                `thread:${caller.thread!.threadId}`,
                authorize,
              ),
            ),
          );
        }),
      ),
      loom_vault_grants: McpToolAccess.writesEnvironment(() =>
        administrator.pipe(
          Effect.andThen(
            onHost(Effect.flatMap(VaultAccess.VaultAccess, (access) => access.snapshot)),
          ),
        ),
      ),
      loom_vault_grants_apply: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const actor = yield* administrator;
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.provide(context),
            Effect.asVoid,
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultAccess.VaultAccess, (access) =>
              access.apply(input, actor, authorize),
            ),
          );
        }),
      ),
      loom_vault_grants_preview: McpToolAccess.writesEnvironment((input) =>
        administrator.pipe(
          Effect.flatMap((actor) =>
            onHost(
              Effect.flatMap(VaultAccess.VaultAccess, (access) => access.preview(input, actor)),
            ),
          ),
        ),
      ),
      loom_vault_access_explain: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread) {
            yield* administrator;
            if (!input.threadId) return yield* new VaultError({ reason: "invalid-input" });
          }
          return yield* onHost(
            Effect.flatMap(VaultAccessInspector.VaultAccessInspector, (inspector) =>
              inspector.explain(
                { ...input, threadId: caller.thread?.threadId ?? input.threadId! },
                caller.thread !== undefined,
              ),
            ),
          );
        }),
      ),
      loom_vault_readiness: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread) {
            yield* administrator;
            if (!input.threadId) return yield* new VaultError({ reason: "invalid-input" });
          }
          return yield* onHost(
            Effect.flatMap(VaultReadiness.VaultReadiness, (readiness) =>
              readiness.check({
                requirements: input.requirements,
                threadId: caller.thread?.threadId ?? input.threadId!,
              }),
            ),
          );
        }),
      ),
      loom_vault_grants_delegate: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread) return yield* new VaultError({ reason: "denied" });
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.provide(context),
            Effect.asVoid,
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultAccess.VaultAccess, (access) =>
              access.delegate(input, caller.thread!.threadId, authorize),
            ),
          );
        }),
      ),
    };
  }),
);
