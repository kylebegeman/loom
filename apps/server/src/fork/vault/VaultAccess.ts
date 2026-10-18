import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  VaultGrant,
  VaultGrantMutation,
  VaultAuditEvent,
  type VaultAccessAction,
  type VaultAccessDecision,
  type VaultDecisionInput,
  type VaultPolicySnapshot,
  type VaultGrantPreview,
  type VaultAccessExplanation,
  type VaultReadinessInput,
  type VaultReadinessReport,
  type VaultDelegateInput,
  type VaultItemList,
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
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import { evaluateVaultPolicy, grantAttenuates, grantMatchesWorkload } from "./VaultPolicy.ts";

const Policy = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  grants: Schema.Array(VaultGrant).check(Schema.isMaxLength(128)),
  audit: Schema.Array(VaultAuditEvent).check(Schema.isMaxLength(256)),
  omittedAuditEvents: Schema.Int,
  receipts: Schema.Array(
    Schema.Struct({ id: Schema.String, fingerprint: Schema.String, result: VaultGrant }),
  ).check(Schema.isMaxLength(32)),
});
type Policy = typeof Policy.Type;
const decodePolicy = Schema.decodeUnknownOption(Policy);
const encodePolicy = Schema.encodeEffect(Policy);
const decodeMutation = Schema.decodeUnknownOption(VaultGrantMutation);
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
  "Broker leases, approvals and profile bindings are not implemented; their consumers are unknown.",
];

export class VaultAccess extends Context.Service<
  VaultAccess,
  {
    readonly catalog: Effect.Effect<VaultAccessCatalog, VaultError>;
    readonly snapshot: Effect.Effect<VaultPolicySnapshot, VaultError>;
    readonly apply: (
      input: VaultGrantMutation,
      actor: string,
      authorize?: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultGrant, VaultError>;
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
        value.value.grants.length
    )
      return yield* new VaultError({ reason: "invalid-response" });
    return { policy: value.value, version: record.version };
  });
  const persist = Effect.fnUntraced(function* (policy: Policy, version: number) {
    const encoded = yield* encodePolicy(policy).pipe(
      Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
    );
    yield* store.write(path, Redacted.make(encoded), version);
  });
  const withAudit = (policy: Policy, event: VaultAuditEvent): Policy => ({
    ...policy,
    audit: [...policy.audit, event].slice(-256),
    omittedAuditEvents: policy.omittedAuditEvents + (policy.audit.length === 256 ? 1 : 0),
  });
  const subject = Effect.fnUntraced(function* (threadId: ThreadId) {
    const thread = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
    if (thread === null || thread.deletedAt !== null || thread.archivedAt !== null)
      return yield* new VaultError({ reason: "denied" });
    return { threadId, projectId: thread.projectId, thread };
  });
  const prepare = Effect.fnUntraced(function* (
    input: VaultGrantMutation,
    policy: Policy,
    actor: string,
  ) {
    if (!actor.trim() || actor.length > 256 || Option.isNone(decodeMutation(input)))
      return yield* new VaultError({ reason: "invalid-input" });
    if (input.expectedRevision !== policy.revision)
      return yield* new VaultError({ reason: "conflict" });
    const id = input.change.type === "save" ? input.change.grant.id : input.change.id;
    const current = policy.grants.find((grant) => grant.definition.id === id);
    if (current?.state === "revoked") return yield* new VaultError({ reason: "denied" });
    if (input.change.type === "state") {
      if (!current) return yield* new VaultError({ reason: "not-found" });
      return {
        ...current,
        state: input.change.state,
        revision: current.revision + 1,
        updatedBy: actor,
      };
    }
    const definition = input.change.grant;
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
    if (definition.parentId !== null) {
      const parent = policy.grants.find((value) => value.definition.id === definition.parentId);
      if (!parent || parent.state !== "active" || !grantAttenuates(parent, grant))
        return yield* new VaultError({ reason: "denied" });
      const seen = new Set([definition.id]);
      let ancestor: VaultGrant | undefined = parent;
      while (ancestor) {
        if (seen.has(ancestor.definition.id)) return yield* new VaultError({ reason: "denied" });
        seen.add(ancestor.definition.id);
        ancestor = policy.grants.find(
          (value) => value.definition.id === ancestor?.definition.parentId,
        );
      }
    }
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
  const decision = Effect.fnUntraced(function* (policy: Policy, input: VaultDecisionInput) {
    const workload = yield* subject(input.threadId);
    const item = yield* core.inspect(input.itemId);
    const evaluated = evaluateVaultPolicy(
      policy.grants,
      workload,
      input,
      yield* Clock.currentTimeMillis,
      policy.revision,
    );
    let result: VaultAccessDecision =
      input.action !== "manage" &&
      (item === null || (input.action !== "inspect" && item.state !== "active"))
        ? { ...evaluated, allowed: false, reason: "item-unavailable" }
        : evaluated;
    if (
      (input.action === "manage" || input.action === "delegate") &&
      (workload.thread.runtimeMode !== "full-access" ||
        workload.thread.interactionMode !== "default")
    )
      result = { ...result, allowed: false, reason: "caller-permission" };
    if (input.action !== "inspect" && workload.thread.activeRunId === null)
      result = { ...result, allowed: false, reason: "workload-inactive" };
    return { workload, item, result };
  });
  const requireAccess = Effect.fn("VaultAccess.require")(function* (
    threadId: ThreadId,
    itemId: string,
    action: VaultAccessAction,
    destination: string | null,
  ) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { policy, version } = yield* load();
      const { result } = yield* decision(policy, { threadId, itemId, action, destination });
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
      });
      const persisted = yield* persist(next, version).pipe(Effect.result);
      if (persisted._tag === "Failure") {
        if (persisted.failure.reason === "conflict") continue;
        return yield* persisted.failure;
      }
      if (!result.allowed) return yield* new VaultError({ reason: "denied" });
      return;
    }
    return yield* new VaultError({ reason: "conflict" });
  });
  return VaultAccess.of({
    catalog: Effect.gen(function* () {
      const shell = yield* threads
        .getShellSnapshot()
        .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
      const projectList = yield* projects
        .listShells()
        .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
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
    }),
    snapshot: Effect.gen(function* () {
      const { policy } = yield* load();
      return {
        environmentId,
        revision: policy.revision,
        grants: policy.grants,
        audit: policy.audit.toReversed().slice(0, 50),
        omittedAuditEvents: policy.omittedAuditEvents + Math.max(0, policy.audit.length - 50),
      };
    }),
    apply,
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
        unknowns: UNKNOWN,
      };
    }),
    explain: Effect.fn("VaultAccess.explain")(function* (input, restrictMetadata) {
      const { policy } = yield* load();
      const { workload, item, result } = yield* decision(policy, input);
      return {
        environmentId,
        threadId: input.threadId,
        projectId: workload.projectId,
        item:
          restrictMetadata &&
          !evaluateVaultPolicy(
            policy.grants,
            workload,
            { ...input, action: "inspect" },
            yield* Clock.currentTimeMillis,
            policy.revision,
          ).allowed
            ? null
            : item,
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
      const page = yield* core.list(input);
      const now = yield* Clock.currentTimeMillis;
      return {
        ...page,
        items: page.items.filter(
          (item) =>
            evaluateVaultPolicy(
              policy.grants,
              workload,
              { itemId: item.id, action: "inspect", destination: null },
              now,
              policy.revision,
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
          if (!allowed.allowed || allowed.grantId !== parent.definition.id)
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
              ? "Authenticated active T3 thread."
              : "Thread has no active run.",
          repair: "Check the intended runner's live thread, not a terminal login.",
        },
      ];
      const decisions: VaultAccessDecision[] = [];
      if (backend.state === "ready") {
        const { policy } = yield* load();
        for (const requirement of input.requirements) {
          const result = yield* decision(policy, { ...requirement, threadId: input.threadId });
          decisions.push(result.result);
          checks.push({
            id: `grant:${requirement.itemId}:${requirement.action}`,
            state: result.result.allowed ? "passed" : "blocked",
            reason: result.result.reason,
            repair: result.result.allowed
              ? "No repair needed."
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
          reason: "No enrolled broker or credential-delivery adapter is installed.",
          repair:
            "Complete broker and delivery setup before claiming unattended SSH or provider access.",
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
