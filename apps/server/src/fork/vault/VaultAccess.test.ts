import * as ApprovalNotifications from "./ApprovalNotifications.ts";
import * as ApprovalNotificationTransport from "./ApprovalNotificationTransport.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  type VaultApprovalRetryInput,
  type VaultOwnerPolicyChange,
  type VaultItemKind,
  type VaultGrantDefinition,
  type VaultGrantMutation,
  type VaultGrantBatchMutation,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Clock from "effect/Clock";
import * as Option from "effect/Option";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as AccessPolicy from "./AccessPolicy.ts";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";

const isLegacyPolicy = Schema.is(AccessPolicy.LegacyPolicy);
const isProtectedPolicy = Schema.is(AccessPolicy.ProtectedPolicy);
const decodeEnvelopeSummary = Schema.decodeUnknownSync(
  Schema.Struct({
    environmentId: Schema.String,
    ownerPolicy: Schema.Unknown,
    policy: Schema.Unknown,
  }),
);
const threadId = ThreadId.make("grant-thread");
const childId = ThreadId.make("child-thread");
const projectId = ProjectId.make("grant-project");
const itemId = "a".repeat(32);
const definition: VaultGrantDefinition = {
  id: "b".repeat(32),
  label: "Development access",
  principal: { kind: "thread", id: threadId },
  itemIds: [itemId],
  actions: ["inspect", "manage", "use", "delegate"],
  projectId,
  destination: null,
  notBefore: 0,
  expiresAt: 60_000,
  parentId: null,
};
const save: VaultGrantMutation = {
  operationId: "c".repeat(32),
  expectedRevision: 0,
  change: { type: "save", grant: definition },
};
const fixture = () => {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const state = {
    loseNextReply: false,
    policyWrites: 0,
    policyWriteAttempts: 0,
    conflictNextPolicyWrite: false,
    notificationsFail: false,
    notificationCalls: 0,
    notificationBarrier: null as {
      started: Deferred.Deferred<void>;
      release: Deferred.Deferred<"delivered">;
    } | null,
    failWrites: false,
    failReads: false,
    readBarrier: null as {
      observed: Deferred.Deferred<void>;
      release: Deferred.Deferred<void>;
    } | null,
    runId: RunId.make("grant-run"),
    active: true,
    deleted: false,
    projectAvailable: true,
    projectDeleted: false,
    approvalRequired: false,
    runStatus: "running" as "running" | "completed" | "cancelled",
    interactionMode: "default" as "default" | "plan",
  };
  const store = OpenBaoStore.OpenBaoStore.of({
    status: Effect.succeed({
      backend: "openbao",
      state: "ready",
      origin: "https://vault.example.test",
    }),
    read: (path) =>
      Effect.gen(function* () {
        if (state.failReads) return yield* new VaultError({ reason: "unavailable" });
        const value = records.get(path) ?? null;
        const barrier = path.endsWith("/access-policy") ? state.readBarrier : null;
        if (barrier) {
          state.readBarrier = null;
          yield* Deferred.succeed(barrier.observed, undefined);
          yield* Deferred.await(barrier.release);
        }
        return value;
      }),
    keys: (prefix) =>
      Effect.sync(() =>
        [...records.keys()]
          .filter((key) => key.startsWith(prefix + "/"))
          .map((key) => key.slice(prefix.length + 1)),
      ),
    write: (path, value, expected) =>
      Effect.suspend(() => {
        if (path.endsWith("/access-policy")) state.policyWriteAttempts++;
        if (path.endsWith("/access-policy") && state.conflictNextPolicyWrite) {
          state.conflictNextPolicyWrite = false;
          const record = records.get(path)!;
          records.set(path, { ...record, version: record.version + 1 });
          return Effect.fail(new VaultError({ reason: "conflict" }));
        }
        if (state.failWrites) return Effect.fail(new VaultError({ reason: "unavailable" }));
        const current = records.get(path)?.version ?? 0;
        if (current !== expected) return Effect.fail(new VaultError({ reason: "conflict" }));
        records.set(path, { value, version: current + 1 });
        if (path.endsWith("/access-policy")) state.policyWrites++;
        if (state.loseNextReply) {
          state.loseNextReply = false;
          return Effect.fail(new VaultError({ reason: "unavailable" }));
        }
        return Effect.succeed(current + 1);
      }),
  });
  const dependencies = Layer.mergeAll(
    NodeServices.layer,
    Layer.mock(ProjectStoreV2)({
      // Mirrors ProjectStoreV2: a soft-deleted project is returned only with includeDeleted.
      get: (id, options) =>
        Effect.succeed(
          id === projectId &&
            state.projectAvailable &&
            (!state.projectDeleted || options?.includeDeleted === true)
            ? Option.some({
                projectId,
                title: "Test project",
                deletedAt: state.projectDeleted ? "2026-10-19T00:00:00Z" : null,
              } as never)
            : Option.none(),
        ),
    }),
    Layer.succeed(OpenBaoStore.OpenBaoStore, store),
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("grants-test")),
    }),
    Layer.mock(ThreadManagementService)({
      getThreadRecords: (id) =>
        Effect.sync(
          () =>
            ({
              thread: { id, projectId },
              runs: [
                {
                  id: state.runId,
                  threadId: id,
                  providerInstanceId: "codex",
                  status: state.runStatus,
                },
              ],
            }) as never,
        ),
      getThreadShell: (id) =>
        Effect.sync(() =>
          id === ThreadId.make("missing")
            ? null
            : ({
                id,
                projectId,
                title: "Review thread",
                deletedAt: state.deleted ? "2026-10-18T00:00:00Z" : null,
                archivedAt: null,
                activeRunId: state.active ? state.runId : null,
                runtimeMode: state.approvalRequired ? "approval-required" : "full-access",
                interactionMode: state.interactionMode,
                providerInstanceId: "codex",
                lineage: {
                  parentThreadId: id === childId ? threadId : null,
                  relationshipToParent: id === childId ? "subagent" : null,
                },
              } as never),
        ),
    }),
  );
  const core = VaultCore.layer.pipe(Layer.provide(dependencies));
  const layer = VaultAccess.layer.pipe(
    Layer.provide(
      ApprovalNotifications.layer.pipe(
        Layer.provide(
          Layer.succeed(ApprovalNotificationTransport.ApprovalNotificationTransport, {
            pending: () =>
              Effect.gen(function* () {
                state.notificationCalls++;
                if (state.notificationsFail)
                  return yield* new VaultError({ reason: "unavailable" });
                if (state.notificationBarrier) {
                  const barrier = state.notificationBarrier;
                  yield* Deferred.succeed(barrier.started, undefined);
                  return yield* Deferred.await(barrier.release);
                }
                return "stubbed" as const;
              }),
          }),
        ),
      ),
    ),
    Layer.provideMerge(core),
    Layer.provide(dependencies),
  );
  return { records, state, layer };
};
function withAccess<A, E>(
  use: (services: {
    access: VaultAccess.VaultAccess["Service"];
    core: VaultCore.VaultCore["Service"];
    fixture: ReturnType<typeof fixture>;
  }) => Effect.Effect<A, E>,
  kind: VaultItemKind = "secret",
) {
  const f = fixture();
  return Effect.gen(function* () {
    const access = yield* VaultAccess.VaultAccess,
      core = yield* VaultCore.VaultCore;
    yield* core.save(
      {
        id: itemId,
        operationId: "a".repeat(32),
        expectedVersion: 0,
        label: "Private account",
        kind,
        value: Redacted.make("synthetic-never-in-audit"),
      },
      "human",
    );
    return yield* use({ access, core, fixture: f });
  }).pipe(Effect.provide(f.layer));
}
it.effect(
  "persists a grant, enforces it, audits decisions and replays an atomic mutation once",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        expect(
          (yield* access.require(threadId, itemId, "manage", null).pipe(Effect.flip)).reason,
        ).toBe("denied");
        const first = yield* access.apply(save, "human");
        expect(yield* access.apply(save, "human")).toEqual(first);
        yield* access.require(threadId, itemId, "manage", null);
        const snapshot = yield* access.snapshot;
        expect(snapshot.revision).toBe(1);
        expect(snapshot.audit.filter((event) => event.type === "grant-change")).toHaveLength(1);
        expect(snapshot.audit[0]).toMatchObject({ type: "decision", reason: "allowed" });
        expect(JSON.stringify(snapshot)).not.toContain("synthetic-never-in-audit");
        expect(
          (yield* access
            .apply(
              { ...save, change: { type: "save", grant: { ...definition, label: "Different" } } },
              "human",
            )
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(fixture.records.size).toBe(2);
      }),
    ),
);
it.effect("suspends, resumes and permanently revokes access with current policy revisions", () =>
  withAccess(({ access }) =>
    Effect.gen(function* () {
      yield* access.apply(save, "human");
      for (const [index, state] of (["suspended", "active", "revoked"] as const).entries()) {
        yield* access.apply(
          {
            operationId: (index + 1).toString().repeat(32),
            expectedRevision: index + 1,
            change: { type: "state", id: definition.id, state },
          },
          "human",
        );
        const explanation = yield* access.explain({
          threadId,
          itemId,
          action: "manage",
          destination: null,
        });
        expect(explanation.decision.allowed).toBe(state === "active");
      }
      expect(
        (yield* access
          .apply(
            {
              operationId: "9".repeat(32),
              expectedRevision: 4,
              change: { type: "state", id: definition.id, state: "active" },
            },
            "human",
          )
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
    }),
  ),
);
it.effect("requires exact destination, time window and authenticated project context", () =>
  withAccess(({ access }) =>
    Effect.gen(function* () {
      yield* access.apply(
        {
          ...save,
          change: {
            type: "save",
            grant: { ...definition, destination: "ssh://git.example.test:22" },
          },
        },
        "human",
      );
      expect(
        (yield* access.explain({
          threadId,
          itemId,
          action: "use",
          destination: "ssh://git.example.test:22",
        })).decision.allowed,
      ).toBe(true);
      expect(
        (yield* access.explain({
          threadId,
          itemId,
          action: "use",
          destination: "ssh://git.example.test.attacker:22",
        })).decision.reason,
      ).toBe("scope");
      yield* TestClock.adjust(60_000);
      expect(
        (yield* access.explain({
          threadId,
          itemId,
          action: "use",
          destination: "ssh://git.example.test:22",
        })).decision.reason,
      ).toBe("expired");
    }),
  ),
);
it.effect("delegates only to a real direct child and rechecks ancestor revocation", () =>
  withAccess(({ access }) =>
    Effect.gen(function* () {
      yield* access.apply(save, "human");
      const child = {
        ...definition,
        id: "d".repeat(32),
        principal: { kind: "thread" as const, id: childId },
        actions: ["inspect", "use"] as const,
        parentId: definition.id,
        expiresAt: 30_000,
      };
      yield* access.delegate(
        { operationId: "e".repeat(32), expectedRevision: 1, childThreadId: childId, grant: child },
        threadId,
        Effect.void,
      );
      yield* access.require(childId, itemId, "inspect", null);
      const preview = yield* access.preview(
        {
          operationId: "f".repeat(32),
          expectedRevision: 2,
          change: { type: "state", id: definition.id, state: "revoked" },
        },
        "human",
      );
      expect(preview.affectedGrantIds).toContain(child.id);
      expect(preview.unknowns).toContain(
        "Profile bindings are not tracked by this change preview.",
      );
      expect((yield* access.snapshot).revision).toBe(2);
      yield* access.apply(
        {
          operationId: "f".repeat(32),
          expectedRevision: 2,
          change: { type: "state", id: definition.id, state: "revoked" },
        },
        "human",
      );
      expect(
        (yield* access.require(childId, itemId, "inspect", null).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* access.explain({ threadId: childId, itemId, action: "inspect", destination: null }))
          .decision.reason,
      ).toBe("not-active");
    }),
  ),
);
it.effect("rejects self-approved delegation, broader descendants and stale previews", () =>
  withAccess(({ access }) =>
    Effect.gen(function* () {
      yield* access.apply(save, "human");
      const child = {
        ...definition,
        id: "d".repeat(32),
        principal: { kind: "thread" as const, id: childId },
        parentId: definition.id,
      };
      expect(
        (yield* access
          .delegate(
            {
              operationId: "e".repeat(32),
              expectedRevision: 1,
              childThreadId: threadId,
              grant: child,
            },
            threadId,
            Effect.void,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* access
          .apply(
            {
              operationId: "e".repeat(32),
              expectedRevision: 1,
              change: { type: "save", grant: { ...child, actions: ["reveal"] } },
            },
            "human",
          )
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      yield* access.apply(
        {
          operationId: "e".repeat(32),
          expectedRevision: 1,
          change: { type: "state", id: definition.id, state: "suspended" },
        },
        "human",
      );
      expect(
        (yield* access.preview({ ...save, operationId: "f".repeat(32) }, "human").pipe(Effect.flip))
          .reason,
      ).toBe("conflict");
    }),
  ),
);
it.effect("fails closed when audit persistence fails or the workload is no longer active", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      yield* access.apply(save, "human");
      fixture.state.failWrites = true;
      expect(
        (yield* access.require(threadId, itemId, "manage", null).pipe(Effect.flip)).reason,
      ).toBe("unavailable");
      fixture.state.failWrites = false;
      fixture.state.active = false;
      expect(
        (yield* access.require(threadId, itemId, "manage", null).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect((yield* access.snapshot).audit[0]?.reason).toBe("workload-inactive");
    }),
  ),
);
it.effect("filters metadata and does not disclose denied items in self explanations", () =>
  withAccess(({ access }) =>
    Effect.gen(function* () {
      expect(
        (yield* access.listForThread({ cursor: null, includeArchived: false }, threadId)).items,
      ).toEqual([]);
      expect(
        (yield* access.explain({ threadId, itemId, action: "inspect", destination: null }, true))
          .item,
      ).toBeNull();
      yield* access.apply(save, "human");
      expect(
        (yield* access.listForThread({ cursor: null, includeArchived: false }, threadId)).items.map(
          (item) => item.id,
        ),
      ).toEqual([itemId]);
    }),
  ),
);
it.effect(
  "reports readiness for management while refusing to claim headless credential delivery",
  () =>
    withAccess(({ access }) =>
      Effect.gen(function* () {
        yield* access.apply(save, "human");
        const management = yield* access.readiness({
          threadId,
          requirements: [{ itemId, action: "manage", destination: null }],
        });
        expect(management.ready).toBe(true);
        expect(management.freshUntil - management.checkedAt).toBe(60_000);
        const ssh = yield* access.readiness({
          threadId,
          requirements: [{ itemId, action: "use", destination: null }],
        });
        expect(ssh.ready).toBe(false);
        expect(
          ssh.checks.some(
            (check) => check.id === "broker-delivery" && check.state === "unsupported",
          ),
        ).toBe(true);
        expect(management.checkedAt).toBe(yield* Clock.currentTimeMillis);
      }),
    ),
);
it.effect("survives service reconstruction and enforces persisted revocation", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      yield* access.apply(save, "human");
      yield* access.apply(
        {
          operationId: "d".repeat(32),
          expectedRevision: 1,
          change: { type: "state", id: definition.id, state: "revoked" },
        },
        "human",
      );
      const restarted = yield* VaultAccess.VaultAccess.pipe(
        Effect.provide(Layer.fresh(fixture.layer)),
      );
      expect((yield* restarted.snapshot).revision).toBe(2);
      expect(
        (yield* restarted.require(threadId, itemId, "inspect", null).pipe(Effect.flip)).reason,
      ).toBe("denied");
    }),
  ),
);

it.effect("keeps explanations and execution under the runner permission ceiling", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      yield* access.apply(save, "human");
      fixture.state.approvalRequired = true;
      expect(
        (yield* access.explain({ threadId, itemId, action: "manage", destination: null })).decision
          .reason,
      ).toBe("caller-permission");
      expect(
        (yield* access.require(threadId, itemId, "manage", null).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* access.readiness({
          threadId,
          requirements: [{ itemId, action: "manage", destination: null }],
        })).ready,
      ).toBe(false);
    }),
  ),
);
it.effect("keeps archived metadata inspectable while denying credential use", () =>
  withAccess(({ access, core }) =>
    Effect.gen(function* () {
      yield* access.apply(save, "human");
      yield* core.change(
        { id: itemId, operationId: "d".repeat(32), expectedVersion: 1, action: "archive" },
        "human",
      );
      expect(
        (yield* access.explain({ threadId, itemId, action: "inspect", destination: null })).decision
          .allowed,
      ).toBe(true);
      expect(
        (yield* access.explain({ threadId, itemId, action: "use", destination: null })).decision
          .reason,
      ).toBe("item-unavailable");
    }),
  ),
);

const approvalInput = {
  id: "e".repeat(32),
  threadId,
  itemId,
  action: "use" as const,
  destination: "ssh://git@code.invalid:22",
};
const approveInput = {
  id: approvalInput.id,
  operationId: "f".repeat(32),
  expectedRevision: 1,
  expectedPolicyRevision: 0,
  decision: "approve" as const,
  durationMs: 300_000 as const,
};
it.effect(
  "atomically approves a durable request as a bounded grant, expires it and visibly revokes it",
  () =>
    withAccess(({ access }) =>
      Effect.gen(function* () {
        const request = yield* access.approvalCreate(
          approvalInput,
          "thread:requester",
          Effect.void,
        );
        expect(request.state).toBe("pending");
        expect(
          (yield* access
            .require(threadId, itemId, "use", approvalInput.destination)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        const approved = yield* access.approvalChange(approveInput, "human:approver", Effect.void);
        expect(approved.state).toBe("approved");
        expect(
          (yield* access.approvalChange(approveInput, "human:approver", Effect.void)).revision,
        ).toBe(2);
        yield* access.require(threadId, itemId, "use", approvalInput.destination);
        expect(
          (yield* access
            .require(threadId, itemId, "use", "ssh://other.invalid:22")
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        yield* TestClock.adjust("5 minutes");
        expect((yield* access.approvalInbox).requests[0]?.state).toBe("expired");
        expect(
          (yield* access
            .require(threadId, itemId, "use", approvalInput.destination)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        const revoked = yield* access.approvalChange(
          {
            ...approveInput,
            operationId: "1".repeat(32),
            expectedRevision: 2,
            expectedPolicyRevision: 1,
            decision: "revoke",
          },
          "human:approver",
          Effect.void,
        );
        expect(revoked.state).toBe("revoked");
        expect((yield* access.snapshot).grants[0]?.state).toBe("revoked");
      }),
    ),
);
it.effect(
  "denies and cancels pending requests without creating grants and rejects later approval",
  () =>
    withAccess(({ access }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, "requester", Effect.void);
        yield* access.approvalChange(
          { ...approveInput, decision: "deny" },
          "approver",
          Effect.void,
        );
        expect((yield* access.snapshot).grants).toHaveLength(0);
        expect((yield* access.approvalInbox).requests[0]?.state).toBe("denied");
        expect(
          (yield* access
            .approvalChange(
              {
                ...approveInput,
                operationId: "2".repeat(32),
                expectedRevision: 2,
                expectedPolicyRevision: 1,
              },
              "approver",
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        yield* access.approvalCreate(
          { ...approvalInput, id: "3".repeat(32) },
          "requester",
          Effect.void,
        );
        yield* access.approvalChange(
          { ...approveInput, id: "3".repeat(32), expectedPolicyRevision: 1, decision: "cancel" },
          "approver",
          Effect.void,
        );
        expect((yield* access.approvalInbox).requests[0]?.state).toBe("cancelled");
      }),
    ),
);
it.effect(
  "guards item versions, stale revisions, pending expiry and failed writes without creating access",
  () =>
    withAccess(({ access, core, fixture }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, "requester", Effect.void);
        expect(
          (yield* access
            .approvalCreate({ ...approvalInput, destination: null }, "requester", Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        fixture.state.failWrites = true;
        expect(
          (yield* access.approvalChange(approveInput, "approver", Effect.void).pipe(Effect.flip))
            .reason,
        ).toBe("unavailable");
        fixture.state.failWrites = false;
        expect((yield* access.snapshot).grants).toHaveLength(0);
        expect(
          (yield* access
            .approvalChange({ ...approveInput, expectedPolicyRevision: 5 }, "approver", Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        yield* core.change(
          { id: itemId, operationId: "4".repeat(32), expectedVersion: 1, action: "archive" },
          "human",
        );
        expect(
          (yield* access.approvalChange(approveInput, "approver", Effect.void).pipe(Effect.flip))
            .reason,
        ).toBe("conflict");
        yield* TestClock.adjust("10 minutes");
        expect((yield* access.approvalInbox).requests[0]?.state).toBe("expired");
        expect(
          (yield* access
            .approvalChange({ ...approveInput, decision: "deny" }, "approver", Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
      }),
    ),
);
it.effect(
  "permits exactly one racing decision and never bypasses runtime permission ceilings",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(
          { ...approvalInput, action: "manage" },
          "requester",
          Effect.void,
        );
        const outcomes = yield* Effect.all(
          [
            access.approvalChange(approveInput, "approver", Effect.void).pipe(Effect.result),
            access
              .approvalChange(
                { ...approveInput, operationId: "5".repeat(32), decision: "deny" },
                "other",
                Effect.void,
              )
              .pipe(Effect.result),
          ],
          { concurrency: "unbounded" },
        );
        expect(outcomes.filter((r) => r._tag === "Success")).toHaveLength(1);
        if ((yield* access.approvalInbox).requests[0]?.state === "approved") {
          fixture.state.approvalRequired = true;
          expect(
            (yield* access
              .require(threadId, itemId, "manage", approvalInput.destination)
              .pipe(Effect.flip)).reason,
          ).toBe("denied");
        }
      }),
    ),
);
it.effect(
  "blocks revoked permissions at commit and cannot extend a temporary approval through ordinary grant edits",
  () =>
    withAccess(({ access }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, "requester", Effect.void);
        let checks = 0;
        const authorize = Effect.suspend(() =>
          ++checks > 1 ? Effect.fail(new VaultError({ reason: "denied" })) : Effect.void,
        );
        expect(
          (yield* access.approvalChange(approveInput, "approver", authorize).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        expect((yield* access.snapshot).grants).toHaveLength(0);
        expect(
          (yield* access
            .approvalChange(approveInput, "thread:requester", Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        yield* access.approvalChange(approveInput, "approver", Effect.void);
        const policy = yield* access.snapshot;
        const grant = policy.grants[0]!;
        expect(
          (yield* access
            .apply(
              {
                operationId: "6".repeat(32),
                expectedRevision: policy.revision,
                change: { type: "save", grant: { ...grant.definition, expiresAt: null } },
              },
              "human",
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);

it.effect("recovers lost decision replies and notification failure from the committed policy", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      fixture.state.notificationsFail = true;
      yield* access.approvalCreate(approvalInput, "requester", Effect.void);
      expect((yield* access.approvalInbox).notificationOutcomes?.[0]?.delivery).toBe("unconfirmed");
      const policyBeforeRead = [...fixture.records.entries()];
      yield* access.approvalInbox;
      expect([...fixture.records.entries()]).toEqual(policyBeforeRead);
      fixture.state.loseNextReply = true;
      expect(
        (yield* access.approvalChange(approveInput, "approver", Effect.void).pipe(Effect.flip))
          .reason,
      ).toBe("unavailable");
      expect((yield* access.approvalChange(approveInput, "approver", Effect.void)).state).toBe(
        "approved",
      );
      expect((yield* access.snapshot).grants).toHaveLength(1);
      const reopened = yield* Effect.flatMap(
        VaultAccess.VaultAccess,
        (service) => service.approvalInbox,
      ).pipe(Effect.provide(Layer.fresh(fixture.layer)));
      expect(reopened.requests[0]?.state).toBe("approved");
      expect(reopened.notificationOutcomes?.[0]?.delivery).toBe("not-required");
      expect(
        (yield* access.approvalChange(approveInput, "other-actor", Effect.void).pipe(Effect.flip))
          .reason,
      ).toBe("conflict");
    }),
  ),
);

it.effect("invalidates approved access when the credential version changes", () =>
  withAccess(({ access, core }) =>
    Effect.gen(function* () {
      yield* access.approvalCreate(approvalInput, "requester", Effect.void);
      yield* access.approvalChange(approveInput, "approver", Effect.void);
      yield* core.save(
        {
          id: itemId,
          operationId: "7".repeat(32),
          expectedVersion: 1,
          label: "Rotated",
          kind: "secret",
          value: Redacted.make("synthetic-rotated"),
        },
        "human",
      );
      expect(
        (yield* access
          .require(threadId, itemId, "use", approvalInput.destination)
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
    }),
  ),
);

const requesterActor = `thread:${threadId}`;
const cancelInput = { id: approvalInput.id, operationId: "8".repeat(32), expectedRevision: 1 };
it.effect("returns only the requester's durable operation status without writes or execution", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      const created = yield* access.approvalCreate(
        { ...approvalInput, waitingOperationId: "9".repeat(32) },
        requesterActor,
        Effect.void,
      );
      expect(created.waitingOperation).toEqual({ operationId: "9".repeat(32), runId: "grant-run" });
      const versions = [...fixture.records.values()].map((r) => r.version);
      const status = yield* access.approvalStatus(created.id, threadId);
      expect(status).toMatchObject({
        operationState: "waiting",
        automaticResumption: false,
        allowOnceConsumption: false,
        canExecute: false,
      });
      expect([...fixture.records.values()].map((r) => r.version)).toEqual(versions);
      expect((yield* access.approvalStatus(created.id, childId).pipe(Effect.flip)).reason).toBe(
        "not-found",
      );
      expect(
        (yield* access.approvalStatus("0".repeat(32), threadId).pipe(Effect.flip)).reason,
      ).toBe("not-found");
      yield* access.approvalChange(approveInput, "human", Effect.void);
      expect((yield* access.approvalStatus(created.id, threadId)).operationState).toBe(
        "retry-requires-explicit-operation",
      );
      expect((yield* access.approvalStatus(created.id, threadId)).canExecute).toBe(false);
    }),
  ),
);
it.effect(
  "rejects another requester's status or cancellation and never turns cancellation into approval",
  () =>
    withAccess(({ access }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
        expect(
          (yield* access.approvalCancel(cancelInput, childId, Effect.void).pipe(Effect.flip))
            .reason,
        ).toBe("not-found");
        const cancelled = yield* access.approvalCancel(
          { ...cancelInput, decision: "approve", durationMs: 900000 } as never,
          threadId,
          Effect.void,
        );
        expect(cancelled.state).toBe("cancelled");
        expect((yield* access.snapshot).grants).toHaveLength(0);
        expect((yield* access.approvalCancel(cancelInput, threadId, Effect.void)).revision).toBe(2);
        expect((yield* access.approvalStatus(approvalInput.id, threadId)).operationState).toBe(
          "cancelled",
        );
      }),
    ),
);
it.effect("does not let a thread cancel administrator-created requests on its behalf", () =>
  withAccess(({ access }) =>
    Effect.gen(function* () {
      yield* access.approvalCreate(approvalInput, "administrator", Effect.void);
      expect(
        (yield* access.approvalStatus(approvalInput.id, threadId).pipe(Effect.flip)).reason,
      ).toBe("not-found");
      expect(
        (yield* access.approvalCancel(cancelInput, threadId, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("not-found");
    }),
  ),
);
it.effect(
  "keeps run correlation across restart, rejects duplicate operations and invalidates new-run access",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(
          { ...approvalInput, waitingOperationId: "9".repeat(32) },
          requesterActor,
          Effect.void,
        );
        expect(
          (yield* access
            .approvalCreate(
              { ...approvalInput, id: "1".repeat(32), waitingOperationId: "9".repeat(32) },
              requesterActor,
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        const reopened = yield* Effect.flatMap(VaultAccess.VaultAccess, (service) =>
          service.approvalStatus(approvalInput.id, threadId),
        ).pipe(Effect.provide(Layer.fresh(fixture.layer)));
        expect(reopened.request.waitingOperation?.runId).toBe("grant-run");
        yield* access.approvalChange(approveInput, "human", Effect.void);
        yield* access.require(threadId, itemId, "use", approvalInput.destination);
        fixture.state.runId = RunId.make("different-run");
        expect((yield* access.approvalStatus(approvalInput.id, threadId)).operationState).toBe(
          "stale-run",
        );
        expect(
          (yield* access
            .require(threadId, itemId, "use", approvalInput.destination)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);
it.effect(
  "blocks approval after a run change while permitting the owner to cancel its pending request",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
        fixture.state.runId = RunId.make("different-run");
        expect(
          (yield* access.approvalChange(approveInput, "human", Effect.void).pipe(Effect.flip))
            .reason,
        ).toBe("conflict");
        expect((yield* access.approvalCancel(cancelInput, threadId, Effect.void)).state).toBe(
          "cancelled",
        );
      }),
    ),
);
it.effect("reconciles lost cancellation replies and ignores unrelated policy revisions", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
      yield* access.apply(save, "human");
      fixture.state.loseNextReply = true;
      expect(
        (yield* access.approvalCancel(cancelInput, threadId, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("unavailable");
      expect((yield* access.approvalStatus(approvalInput.id, threadId)).operationState).toBe(
        "cancelled",
      );
      expect((yield* access.approvalCancel(cancelInput, threadId, Effect.void)).state).toBe(
        "cancelled",
      );
      expect((yield* access.snapshot).grants).toHaveLength(1);
    }),
  ),
);
it.effect("permits only one of a requester cancellation and administrator approval race", () =>
  withAccess(({ access }) =>
    Effect.gen(function* () {
      yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
      const outcomes = yield* Effect.all(
        [
          access.approvalCancel(cancelInput, threadId, Effect.void).pipe(Effect.result),
          access.approvalChange(approveInput, "human", Effect.void).pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      );
      expect(outcomes.filter((r) => r._tag === "Success")).toHaveLength(1);
      expect((yield* access.snapshot).grants.length).toBe(
        (yield* access.approvalInbox).requests[0]?.state === "approved" ? 1 : 0,
      );
    }),
  ),
);
it.effect("expires requester status and never cancels an already approved or expired request", () =>
  withAccess(({ access }) =>
    Effect.gen(function* () {
      yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
      yield* access.approvalChange(approveInput, "human", Effect.void);
      expect(
        (yield* access
          .approvalCancel({ ...cancelInput, expectedRevision: 2 }, threadId, Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      yield* TestClock.adjust("5 minutes");
      expect((yield* access.approvalStatus(approvalInput.id, threadId)).operationState).toBe(
        "expired",
      );
      expect(
        (yield* access
          .approvalCancel({ ...cancelInput, expectedRevision: 2 }, threadId, Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
    }),
  ),
);
it.effect(
  "retains requests for exactly 24 hours and reclaims only expired approval grants in one policy CAS",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
        yield* access.approvalChange(approveInput, "human", Effect.void);
        const paths = [...fixture.records.keys()];
        yield* TestClock.adjust("23 hours");
        expect((yield* access.approvalInbox).requests).toHaveLength(1);
        expect(yield* access.approvalRetain).toBe(0);
        yield* TestClock.adjust("1 hour");
        expect((yield* access.approvalInbox).requests).toHaveLength(0);
        expect(
          (yield* access.approvalStatus(approvalInput.id, threadId).pipe(Effect.flip)).reason,
        ).toBe("not-found");
        fixture.state.failWrites = true;
        expect((yield* access.approvalRetain.pipe(Effect.flip)).reason).toBe("unavailable");
        fixture.state.failWrites = false;
        expect(yield* access.approvalRetain).toBe(1);
        expect((yield* access.snapshot).grants).toHaveLength(0);
        expect(yield* access.approvalRetain).toBe(0);
        expect([...fixture.records.keys()]).toEqual(paths);
        const policy = [...fixture.records.entries()].find(([path]) =>
          path.endsWith("/access-policy"),
        )![1];
        expect(Redacted.value(policy.value)).toMatchObject({ schemaVersion: 3, approvals: [] });
      }),
    ),
);
it.effect(
  "keeps the 128-entry cap and trims aged entries atomically before accepting a new request",
  () =>
    withAccess(({ access }) =>
      Effect.gen(function* () {
        for (let i = 0; i < 128; i++)
          yield* access.approvalCreate(
            { ...approvalInput, id: i.toString(16).padStart(32, "0") },
            requesterActor,
            Effect.void,
          );
        expect((yield* access.approvalInbox).requests).toHaveLength(128);
        expect(
          (yield* access
            .approvalCreate(approvalInput, requesterActor, Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        yield* TestClock.adjust("24 hours");
        yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
        expect((yield* access.approvalInbox).requests).toHaveLength(1);
        expect((yield* access.approvalInbox).policyRevision).toBe(1);
      }),
    ),
);

it.effect(
  "blocks cancellation if permission disappears before commit and reports a changed item without probing it",
  () =>
    withAccess(({ access, core }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
        let checks = 0;
        const authorize = Effect.suspend(() =>
          ++checks > 1 ? Effect.fail(new VaultError({ reason: "denied" })) : Effect.void,
        );
        expect(
          (yield* access.approvalCancel(cancelInput, threadId, authorize).pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect((yield* access.approvalStatus(approvalInput.id, threadId)).operationState).toBe(
          "waiting",
        );
        yield* core.change(
          { id: itemId, operationId: "a1".repeat(16), expectedVersion: 1, action: "archive" },
          "human",
        );
        expect((yield* access.approvalStatus(approvalInput.id, threadId)).operationState).toBe(
          "stale-item",
        );
      }),
    ),
);

const retryInput: VaultApprovalRetryInput = {
  id: approvalInput.id,
  waitingOperationId: approvalInput.id,
  expectedRevision: 2,
  previousOutcome: "not-started",
  operation: {
    kind: "ssh",
    target: { hostname: "code.invalid", username: "git", port: 22, hostKey: null },
    input: { id: itemId, command: { expectedVersion: 1, argv: ["true"], timeoutMs: 1000 } },
  },
};
it.effect(
  "prepares an exact typed proposal without writes or execution and revalidates it after restart",
  () =>
    withAccess(
      ({ access, fixture }) =>
        Effect.gen(function* () {
          yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
          expect(
            (yield* access.approvalPrepareRetry({ ...retryInput, expectedRevision: 1 }, threadId))
              .retryState,
          ).toBe("blocked-request");
          yield* access.approvalChange(approveInput, "human", Effect.void);
          const before = [...fixture.records.entries()];
          fixture.state.failWrites = true;
          const prepared = yield* access.approvalPrepareRetry(retryInput, threadId);
          expect(prepared).toMatchObject({
            retryState: "policy-valid-recheck-adapter",
            effects: "remote-write-or-unknown",
            adapterValidation: "required",
            canExecute: false,
            automaticResumption: false,
            allowOnceConsumption: false,
          });
          expect(prepared.operationDigest).toMatch(/^[a-f0-9]{64}$/);
          const recovered = yield* Effect.flatMap(VaultAccess.VaultAccess, (service) =>
            service.approvalPrepareRetry(
              {
                ...retryInput,
                previousOperationDigest: prepared.operationDigest,
              },
              threadId,
            ),
          ).pipe(Effect.provide(Layer.fresh(fixture.layer)));
          expect(prepared.status.notificationOutcome?.attemptedAt).toBe(0);
          expect(recovered).toEqual({
            ...prepared,
            status: {
              ...prepared.status,
              notificationOutcome: { ...prepared.status.notificationOutcome!, attemptedAt: null },
            },
          });
          expect([...fixture.records.entries()]).toEqual(before);
          expect(
            (yield* access.approvalPrepareRetry(
              { ...retryInput, previousOutcome: "unknown" },
              threadId,
            )).retryState,
          ).toBe("requires-outcome-review");
        }),
      "ssh-key",
    ),
);
it.effect("rejects substituted scope, revision, item, version and changed recovery payload", () =>
  withAccess(
    ({ access }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
        yield* access.approvalChange(approveInput, "human", Effect.void);
        const prepared = yield* access.approvalPrepareRetry(retryInput, threadId);
        const operation = retryInput.operation;
        if (operation.kind !== "ssh") throw new Error("fixture");
        for (const patch of [
          { waitingOperationId: "1".repeat(32) },
          {
            operation: { ...operation, target: { ...operation.target, hostname: "other.invalid" } },
          },
          { operation: { ...operation, input: { ...operation.input, id: "1".repeat(32) } } },
          {
            operation: {
              ...operation,
              input: {
                ...operation.input,
                command: { ...operation.input.command, expectedVersion: 2 },
              },
            },
          },
        ])
          expect(
            (yield* access.approvalPrepareRetry({ ...retryInput, ...patch }, threadId)).retryState,
          ).toBe("operation-mismatch");
        expect(
          (yield* access.approvalPrepareRetry({ ...retryInput, expectedRevision: 1 }, threadId))
            .retryState,
        ).toBe("stale-request");
        expect(
          (yield* access.approvalPrepareRetry(
            {
              ...retryInput,
              previousOperationDigest: prepared.operationDigest,
              operation: {
                ...operation,
                input: {
                  ...operation.input,
                  command: { ...operation.input.command, argv: ["changed"] },
                },
              },
            },
            threadId,
          )).retryState,
        ).toBe("operation-changed");
        expect(
          (yield* access.approvalPrepareRetry(retryInput, childId).pipe(Effect.flip)).reason,
        ).toBe("not-found");
        expect(
          (yield* access
            .approvalPrepareRetry(
              { ...retryInput, operation: { kind: "shell" } } as never,
              threadId,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
      }),
    "ssh-key",
  ),
);
it.effect(
  "requires current full-access runtime, current run and unexpired approval on every preparation",
  () =>
    withAccess(
      ({ access, fixture }) =>
        Effect.gen(function* () {
          yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
          yield* access.approvalChange(approveInput, "human", Effect.void);
          fixture.state.approvalRequired = true;
          expect((yield* access.approvalPrepareRetry(retryInput, threadId)).retryState).toBe(
            "runtime-denied",
          );
          fixture.state.approvalRequired = false;
          fixture.state.runId = RunId.make("replacement-run");
          expect(
            (yield* access.approvalPrepareRetry(retryInput, threadId)).status.operationState,
          ).toBe("stale-run");
          fixture.state.runId = RunId.make("grant-run");
          yield* TestClock.adjust("5 minutes");
          const expired = yield* access.approvalPrepareRetry(retryInput, threadId);
          expect(expired.retryState).toBe("blocked-request");
          expect(expired.status.operationState).toBe("expired");
          yield* TestClock.adjust("24 hours");
          expect(
            (yield* access.approvalPrepareRetry(retryInput, threadId).pipe(Effect.flip)).reason,
          ).toBe("not-found");
        }),
      "ssh-key",
    ),
);
it.effect(
  "blocks recovery after item changes or grant revocation even when an independent grant allows access",
  () =>
    withAccess(
      ({ access, core }) =>
        Effect.gen(function* () {
          yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
          yield* access.approvalChange(approveInput, "human", Effect.void);
          yield* access.apply({ ...save, expectedRevision: 1 }, "human");
          yield* access.approvalChange(
            {
              ...approveInput,
              expectedRevision: 2,
              expectedPolicyRevision: 2,
              operationId: "1".repeat(32),
              decision: "revoke",
            },
            "human",
            Effect.void,
          );
          expect(
            (yield* access.approvalPrepareRetry({ ...retryInput, expectedRevision: 3 }, threadId))
              .retryState,
          ).toBe("blocked-request");
          yield* core.change(
            { id: itemId, operationId: "2".repeat(32), expectedVersion: 1, action: "archive" },
            "human",
          );
          expect(
            (yield* access.approvalPrepareRetry({ ...retryInput, expectedRevision: 3 }, threadId))
              .canExecute,
          ).toBe(false);
        }),
      "ssh-key",
    ),
);
it.effect(
  "derives repository-specific Git SSH scope and distinguishes reads from local fetch writes",
  () =>
    withAccess(
      ({ access }) =>
        Effect.gen(function* () {
          const destination = "git+ssh://git@code.invalid:22/org/repo.git";
          yield* access.approvalCreate(
            { ...approvalInput, destination },
            requesterActor,
            Effect.void,
          );
          yield* access.approvalChange(approveInput, "human", Effect.void);
          const operation = retryInput.operation;
          if (operation.kind !== "ssh") throw new Error("fixture");
          const git: VaultApprovalRetryInput = {
            ...retryInput,
            previousOutcome: "unknown",
            operation: {
              kind: "git-ssh",
              target: operation.target,
              input: {
                id: itemId,
                expectedVersion: 1,
                repository: "org/repo.git",
                action: "ls-remote",
                timeoutMs: 1000,
              },
            },
          };
          expect((yield* access.approvalPrepareRetry(git, threadId)).retryState).toBe(
            "policy-valid-recheck-adapter",
          );
          expect(
            (yield* access.approvalPrepareRetry(
              {
                ...git,
                operation: {
                  ...git.operation,
                  kind: "git-ssh",
                  target: operation.target,
                  input: {
                    ...git.operation.input,
                    id: itemId,
                    expectedVersion: 1,
                    repository: "org/repo.git",
                    action: "fetch",
                    timeoutMs: 1000,
                  },
                },
              },
              threadId,
            )).retryState,
          ).toBe("requires-outcome-review");
          expect((yield* access.approvalPrepareRetry(retryInput, threadId)).retryState).toBe(
            "operation-mismatch",
          );
        }),
      "ssh-key",
    ),
);
it.effect(
  "keeps GitHub API scope separate from Git transport and requires review for uncertain API writes",
  () =>
    withAccess(
      ({ access }) =>
        Effect.gen(function* () {
          yield* access.approvalCreate(
            { ...approvalInput, destination: "https://github.com/org/repo" },
            requesterActor,
            Effect.void,
          );
          yield* access.approvalChange(approveInput, "human", Effect.void);
          const github: VaultApprovalRetryInput = {
            ...retryInput,
            previousOutcome: "unknown",
            operation: {
              kind: "github-api",
              input: {
                id: itemId,
                expectedVersion: 1,
                repository: "Org/Repo",
                operation: { action: "repo-view" },
              },
            },
          };
          expect((yield* access.approvalPrepareRetry(github, threadId)).retryState).toBe(
            "policy-valid-recheck-adapter",
          );
          if (github.operation.kind !== "github-api") throw new Error("fixture");
          expect(
            (yield* access.approvalPrepareRetry(
              {
                ...github,
                operation: {
                  ...github.operation,
                  input: {
                    ...github.operation.input,
                    operation: { action: "issue-create", title: "Synthetic", body: "Synthetic" },
                  },
                },
              },
              threadId,
            )).retryState,
          ).toBe("requires-outcome-review");
          expect((yield* access.approvalPrepareRetry(retryInput, threadId)).retryState).toBe(
            "operation-mismatch",
          );
        }),
      "service-connection",
    ),
);
it.effect("does not treat a generic secret item as an executable connector", () =>
  withAccess(({ access }) =>
    Effect.gen(function* () {
      yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
      yield* access.approvalChange(approveInput, "human", Effect.void);
      expect((yield* access.approvalPrepareRetry(retryInput, threadId)).retryState).toBe(
        "unsupported-item",
      );
    }),
  ),
);

it.effect(
  "fails closed on a recovery outage, then reconciles a lost approval reply without another grant",
  () =>
    withAccess(
      ({ access, fixture }) =>
        Effect.gen(function* () {
          yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
          fixture.state.loseNextReply = true;
          expect(
            (yield* access.approvalChange(approveInput, "human", Effect.void).pipe(Effect.flip))
              .reason,
          ).toBe("unavailable");
          fixture.state.failReads = true;
          expect(
            (yield* access.approvalPrepareRetry(retryInput, threadId).pipe(Effect.flip)).reason,
          ).toBe("unavailable");
          fixture.state.failReads = false;
          const report = yield* access.approvalPrepareRetry(retryInput, threadId);
          expect(report).toMatchObject({
            retryState: "policy-valid-recheck-adapter",
            nextStep: "recheck-adapter",
            canExecute: false,
          });
          expect((yield* access.snapshot).grants).toHaveLength(1);
          expect((yield* access.approvalChange(approveInput, "human", Effect.void)).revision).toBe(
            2,
          );
          expect((yield* access.snapshot).grants).toHaveLength(1);
        }),
      "ssh-key",
    ),
);
it.effect(
  "invalidates an in-flight preparation when revocation commits after its first policy read",
  () =>
    withAccess(
      ({ access, fixture }) =>
        Effect.gen(function* () {
          yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
          yield* access.approvalChange(approveInput, "human", Effect.void);
          const observed = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          fixture.state.readBarrier = { observed, release };
          const preparing = yield* access
            .approvalPrepareRetry(retryInput, threadId)
            .pipe(Effect.forkChild);
          yield* Deferred.await(observed);
          yield* access.approvalChange(
            {
              ...approveInput,
              expectedRevision: 2,
              expectedPolicyRevision: 1,
              operationId: "1".repeat(32),
              decision: "revoke",
            },
            "human",
            Effect.void,
          );
          yield* Deferred.succeed(release, undefined);
          const report = yield* Fiber.join(preparing);
          expect(report).toMatchObject({
            retryState: "context-changed",
            nextStep: "refresh-request",
            policyRevision: 2,
            canExecute: false,
            status: { operationState: "revoked" },
          });
          expect(
            (yield* access.approvalPrepareRetry({ ...retryInput, expectedRevision: 3 }, threadId))
              .nextStep,
          ).toBe("request-new-approval");
        }),
      "ssh-key",
    ),
);
it.effect("detects run replacement, item rotation and expiry on recovery validation", () =>
  withAccess(
    ({ access, fixture, core }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
        yield* access.approvalChange(approveInput, "human", Effect.void);
        const prepared = yield* access.approvalPrepareRetry(retryInput, threadId);
        fixture.state.runId = RunId.make("different-run");
        expect(
          yield* access.approvalPrepareRetry(
            { ...retryInput, previousOperationDigest: prepared.operationDigest },
            threadId,
          ),
        ).toMatchObject({
          retryState: "blocked-request",
          nextStep: "request-new-approval",
          status: { operationState: "stale-run" },
        });
        fixture.state.runId = RunId.make("grant-run");
        yield* core.save(
          {
            id: itemId,
            operationId: "1".repeat(32),
            expectedVersion: 1,
            label: "Rotated synthetic key",
            kind: "ssh-key",
            value: Redacted.make("synthetic-rotated-key"),
          },
          "human",
        );
        expect(yield* access.approvalPrepareRetry(retryInput, threadId)).toMatchObject({
          retryState: "blocked-request",
          nextStep: "request-new-approval",
          status: { operationState: "stale-item" },
        });
        yield* TestClock.adjust("5 minutes");
        expect(
          (yield* access.approvalPrepareRetry(retryInput, threadId)).status.operationState,
        ).toBe("expired");
      }),
    "ssh-key",
  ),
);
it.effect(
  "gives actionable pending, changed-operation, uncertain-write and runtime repair guidance",
  () =>
    withAccess(
      ({ access, fixture }) =>
        Effect.gen(function* () {
          yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
          expect(
            (yield* access.approvalPrepareRetry({ ...retryInput, expectedRevision: 1 }, threadId))
              .nextStep,
          ).toBe("wait-for-decision");
          yield* access.approvalChange(approveInput, "human", Effect.void);
          expect(
            (yield* access.approvalPrepareRetry({ ...retryInput, expectedRevision: 1 }, threadId))
              .nextStep,
          ).toBe("refresh-request");
          const changed = yield* access.approvalPrepareRetry(
            { ...retryInput, previousOperationDigest: "0".repeat(64) },
            threadId,
          );
          expect(changed.nextStep).toBe("review-operation");
          const unknown = yield* access.approvalPrepareRetry(
            { ...retryInput, previousOutcome: "unknown" },
            threadId,
          );
          expect(unknown.nextStep).toBe("inspect-outcome");
          expect(unknown.repair).toContain("Do not blindly repeat");
          fixture.state.approvalRequired = true;
          expect((yield* access.approvalPrepareRetry(retryInput, threadId)).nextStep).toBe(
            "restore-runtime",
          );
        }),
      "ssh-key",
    ),
);

it.effect(
  "exposes only the authenticated requester's notification outcome without sends or policy writes",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
        const records = [...fixture.records.entries()];
        const status = yield* access.approvalStatus(approvalInput.id, threadId);
        expect(status).toMatchObject({
          notificationOutcome: {
            requestId: approvalInput.id,
            delivery: "stubbed",
            storage: "process",
            inApp: "available-in-inbox",
          },
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        expect(fixture.state.notificationCalls).toBe(1);
        expect(
          (yield* access.approvalStatus(approvalInput.id, childId).pipe(Effect.flip)).reason,
        ).toBe("not-found");
        expect([...fixture.records.entries()]).toEqual(records);
        expect(fixture.state.notificationCalls).toBe(1);
        yield* access.approvalCancel(cancelInput, threadId, Effect.void);
        expect(
          (yield* access.approvalStatus(approvalInput.id, threadId)).notificationOutcome?.delivery,
        ).toBe("not-required");
        expect(fixture.state.notificationCalls).toBe(1);
      }),
    ),
);

it.effect(
  "reconciles a committed request with a lost reply without inventing or replaying delivery",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        fixture.state.loseNextReply = true;
        expect(
          (yield* access
            .approvalCreate(approvalInput, requesterActor, Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        const recovered = yield* access.approvalStatus(approvalInput.id, threadId);
        expect(recovered).toMatchObject({
          request: { state: "pending" },
          notificationOutcome: {
            inApp: "available-in-inbox",
            delivery: "not-delivered",
            attemptedAt: null,
          },
        });
        expect(fixture.state.notificationCalls).toBe(0);
        expect(
          (yield* access.approvalCreate(approvalInput, requesterActor, Effect.void)).state,
        ).toBe("pending");
        expect(fixture.state.notificationCalls).toBe(0);
        yield* access.approvalChange(approveInput, "human", Effect.void);
        expect(
          (yield* access.approvalStatus(approvalInput.id, threadId)).notificationOutcome?.delivery,
        ).toBe("not-required");
        expect((yield* access.snapshot).grants).toHaveLength(1);
      }),
    ),
);

it.effect(
  "resets requester notification observations after a real service rebuild while retaining request correlation",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
        expect(fixture.state.notificationCalls).toBe(1);
        const restarted = yield* Effect.flatMap(VaultAccess.VaultAccess, (service) =>
          service.approvalStatus(approvalInput.id, threadId),
        ).pipe(Effect.provide(Layer.fresh(fixture.layer)));
        expect(restarted).toMatchObject({
          request: { waitingOperation: { operationId: approvalInput.id, runId: "grant-run" } },
          notificationOutcome: { delivery: "not-delivered", attemptedAt: null },
          canExecute: false,
        });
        expect(fixture.state.notificationCalls).toBe(1);
        fixture.state.failReads = true;
        expect(
          (yield* access.approvalStatus(approvalInput.id, threadId).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        fixture.state.failReads = false;
        yield* TestClock.adjust("24 hours");
        expect(
          (yield* access.approvalStatus(approvalInput.id, threadId).pipe(Effect.flip)).reason,
        ).toBe("not-found");
      }),
    ),
);

it.effect("keeps decisions authoritative when notification completion arrives after approval", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<"delivered">();
      fixture.state.notificationBarrier = { started, release };
      const creating = yield* access
        .approvalCreate(approvalInput, requesterActor, Effect.void)
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      expect((yield* access.approvalInbox).notificationOutcomes?.[0]?.delivery).toBe("sending");
      yield* access.approvalChange(approveInput, "human", Effect.void);
      expect(
        (yield* access.approvalStatus(approvalInput.id, threadId)).notificationOutcome?.delivery,
      ).toBe("not-required");
      yield* Deferred.succeed(release, "delivered");
      yield* Fiber.join(creating);
      const current = yield* access.approvalStatus(approvalInput.id, threadId);
      expect(current).toMatchObject({
        request: { state: "approved", revision: 2 },
        notificationOutcome: { delivery: "not-required" },
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      expect(fixture.state.notificationCalls).toBe(1);
      expect((yield* access.snapshot).grants).toHaveLength(1);
    }),
  ),
);

it.effect(
  "adds bounded current review names without changing the stored request or grant policy",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        yield* access.approvalCreate(approvalInput, requesterActor, Effect.void);
        const records = [...fixture.records.entries()];
        const inbox = yield* access.approvalInbox;
        expect(inbox.reviewContext?.[0]).toEqual({
          requestId: approvalInput.id,
          threadTitle: "Review thread",
          projectTitle: "Test project",
          itemLabel: "Private account",
          state: "current",
        });
        expect([...fixture.records.entries()]).toEqual(records);
        expect(inbox.requests[0]).not.toHaveProperty("threadTitle");
        fixture.state.runId = RunId.make("changed-run");
        expect((yield* access.approvalInbox).reviewContext?.[0]?.state).toBe("changed");
        fixture.state.runId = RunId.make("grant-run");
        fixture.state.projectDeleted = true;
        // A retired project is a permanent change, not a lookup gap a refresh could clear.
        expect((yield* access.approvalInbox).reviewContext?.[0]).toMatchObject({
          projectTitle: "Test project",
          state: "changed",
        });
        fixture.state.projectDeleted = false;
        fixture.state.projectAvailable = false;
        expect((yield* access.approvalInbox).reviewContext?.[0]).toMatchObject({
          projectTitle: null,
          state: "unavailable",
        });
        expect((yield* access.approvalInbox).requests).toHaveLength(1);
        yield* access.approvalChange({ ...approveInput, decision: "deny" }, "human", Effect.void);
        expect((yield* access.approvalInbox).requests[0]?.state).toBe("denied");
      }),
    ),
);

const batchSave: VaultGrantBatchMutation = {
  operationId: "1".repeat(32),
  expectedRevision: 0,
  changes: [
    save.change,
    {
      type: "save",
      grant: { ...definition, id: "d".repeat(32), destination: "github://github.com/owner/repo" },
    },
  ],
};
it.effect("previews a batch without writes and commits every grant at one policy revision", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      const preview = yield* access.previewBatch(batchSave, "human");
      expect(preview.policyRevision).toBe(0);
      expect(preview.grants.map((grant) => grant.definition.id)).toEqual([
        definition.id,
        "d".repeat(32),
      ]);
      expect(preview.affectedGrantIds).toEqual([definition.id, "d".repeat(32)]);
      expect(preview.knownItemIds).toEqual([itemId]);
      expect(fixture.state.policyWriteAttempts).toBe(0);
      const result = yield* access.applyBatch(batchSave, "human");
      expect(result).toEqual({ policyRevision: 1, grants: preview.grants });
      expect(fixture.state.policyWrites).toBe(1);
      const snapshot = yield* access.snapshot;
      expect(snapshot.revision).toBe(1);
      expect(snapshot.grants).toEqual(result.grants);
      expect(snapshot.audit).toHaveLength(2);
      expect(snapshot.audit.every((event) => event.policyRevision === 1)).toBe(true);
      expect(yield* access.applyBatch(batchSave, "human")).toEqual(result);
      expect(fixture.state.policyWriteAttempts).toBe(1);
    }),
  ),
);
it.effect(
  "refuses duplicates, empty/oversized batches, invalid later changes and stale revisions without writes",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        const invalid: ReadonlyArray<readonly [VaultGrantBatchMutation, string]> = [
          [{ ...batchSave, changes: [] }, "invalid-input"],
          [{ ...batchSave, changes: [save.change, save.change] }, "invalid-input"],
          [
            {
              ...batchSave,
              changes: [save.change, { type: "state", id: definition.id, state: "revoked" }],
            },
            "invalid-input",
          ],
          [
            {
              ...batchSave,
              changes: Array.from({ length: 129 }, (_, index) => ({
                type: "save",
                grant: { ...definition, id: index.toString(16).padStart(32, "0") },
              })),
            },
            "invalid-input",
          ],
          [{ ...batchSave, expectedRevision: 1 }, "conflict"],
          [
            {
              ...batchSave,
              changes: [save.change, { type: "state", id: "e".repeat(32), state: "revoked" }],
            },
            "not-found",
          ],
          [
            {
              ...batchSave,
              changes: [
                save.change,
                {
                  type: "save",
                  grant: {
                    ...definition,
                    id: "e".repeat(32),
                    principal: { kind: "thread", id: "missing" },
                  },
                },
              ],
            },
            "denied",
          ],
          [
            {
              ...batchSave,
              changes: [
                save.change,
                { type: "save", grant: { ...definition, id: "e".repeat(32), label: "" } },
              ],
            },
            "invalid-input",
          ],
        ];
        for (const [input, reason] of invalid) {
          expect((yield* access.previewBatch(input, "human").pipe(Effect.flip)).reason).toBe(
            reason,
          );
          expect((yield* access.applyBatch(input, "human").pipe(Effect.flip)).reason).toBe(reason);
        }
        expect(fixture.state.policyWriteAttempts).toBe(0);
        expect((yield* access.snapshot).grants).toEqual([]);
      }),
    ),
);
it.effect(
  "resolves batch lineage against the final policy and previews descendants and prior item scopes",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        const child = {
          ...definition,
          id: "d".repeat(32),
          parentId: definition.id,
          principal: { kind: "thread" as const, id: childId },
        };
        const create: VaultGrantBatchMutation = {
          ...batchSave,
          changes: [{ type: "save", grant: child }, save.change],
        };
        yield* access.applyBatch(create, "human");
        expect(fixture.state.policyWrites).toBe(1);
        const update: VaultGrantBatchMutation = {
          operationId: "2".repeat(32),
          expectedRevision: 1,
          changes: [{ type: "save", grant: { ...definition, itemIds: ["e".repeat(32)] } }],
        };
        const preview = yield* access.previewBatch(update, "human");
        expect(preview.affectedGrantIds).toEqual([definition.id, child.id]);
        expect(preview.knownItemIds).toEqual([itemId, "e".repeat(32)]);
        for (const changes of [
          [{ type: "save" as const, grant: { ...child, actions: ["reveal" as const] } }],
          [
            { type: "save" as const, grant: { ...definition, parentId: child.id } },
            { type: "save" as const, grant: child },
          ],
          [
            { type: "save" as const, grant: child },
            { type: "state" as const, id: definition.id, state: "revoked" as const },
          ],
        ]) {
          expect(
            (yield* access.applyBatch({ ...update, changes }, "human").pipe(Effect.flip)).reason,
          ).toBe("denied");
        }
        expect(fixture.state.policyWriteAttempts).toBe(1);
        yield* access.applyBatch(
          {
            ...update,
            changes: [
              { type: "state", id: definition.id, state: "revoked" },
              { type: "state", id: child.id, state: "revoked" },
            ],
          },
          "human",
        );
        expect((yield* access.snapshot).grants.every((grant) => grant.state === "revoked")).toBe(
          true,
        );
        expect(fixture.state.policyWrites).toBe(2);
      }),
    ),
);
it.effect("rejects batch capacity overflow without partially adding grants", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      yield* access.applyBatch(
        {
          ...batchSave,
          changes: Array.from({ length: 127 }, (_, index) => ({
            type: "save",
            grant: { ...definition, id: index.toString(16).padStart(32, "0") },
          })),
        },
        "human",
      );
      expect(
        (yield* access
          .applyBatch({ ...batchSave, operationId: "2".repeat(32), expectedRevision: 1 }, "human")
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-input");
      expect(fixture.state.policyWriteAttempts).toBe(1);
      const snapshot = yield* access.snapshot;
      expect(snapshot.grants).toHaveLength(127);
      expect(snapshot.revision).toBe(1);
    }),
  ),
);
it.effect(
  "replays a durable batch receipt after a lost response, policy changes and service reconstruction",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        fixture.state.loseNextReply = true;
        expect((yield* access.applyBatch(batchSave, "human").pipe(Effect.flip)).reason).toBe(
          "unavailable",
        );
        const committed = yield* access.snapshot;
        yield* access.apply(
          {
            operationId: "2".repeat(32),
            expectedRevision: 1,
            change: { type: "state", id: definition.id, state: "suspended" },
          },
          "human",
        );
        const result = yield* Effect.flatMap(VaultAccess.VaultAccess, (rebuilt) =>
          rebuilt.applyBatch(batchSave, "human"),
        ).pipe(Effect.provide(fixture.layer));
        expect(result).toEqual({ policyRevision: 1, grants: committed.grants });
        expect((yield* access.snapshot).revision).toBe(2);
        for (const [input, actor] of [
          [batchSave, "other-human"],
          [{ ...batchSave, expectedRevision: 2 }, "human"],
          [{ ...batchSave, changes: batchSave.changes.toReversed() }, "human"],
        ] as const)
          expect((yield* access.applyBatch(input, actor).pipe(Effect.flip)).reason).toBe(
            "conflict",
          );
        expect(
          (yield* access
            .apply({ ...save, operationId: batchSave.operationId }, "human")
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(
          (yield* access
            .applyBatch({ ...batchSave, operationId: "2".repeat(32) }, "human")
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(fixture.state.policyWriteAttempts).toBe(2);
      }),
    ),
);
it.effect("retries storage CAS races without changing the reviewed policy revision", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      yield* access.apply(save, "human");
      fixture.state.conflictNextPolicyWrite = true;
      const result = yield* access.applyBatch({ ...batchSave, expectedRevision: 1 }, "human");
      expect(result.policyRevision).toBe(2);
      expect(result.grants[0]?.revision).toBe(2);
      expect(fixture.state.policyWriteAttempts).toBe(3);
      expect(fixture.state.policyWrites).toBe(2);
      expect((yield* access.snapshot).audit).toHaveLength(3);
    }),
  ),
);
it.effect("loses a policy CAS race without committing any part of the batch", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      const observed = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      fixture.state.readBarrier = { observed, release };
      const loser = yield* access
        .applyBatch(batchSave, "human")
        .pipe(Effect.result, Effect.forkChild);
      yield* Deferred.await(observed);
      yield* access.apply(save, "other-human");
      yield* Deferred.succeed(release, undefined);
      const result = yield* Fiber.join(loser);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
      const snapshot = yield* access.snapshot;
      expect(snapshot.revision).toBe(1);
      expect(snapshot.grants).toHaveLength(1);
      expect(snapshot.grants[0]?.createdBy).toBe("other-human");
      expect(fixture.state.policyWrites).toBe(1);
    }),
  ),
);
it.effect("concurrent identical batches replay one commit", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      const observed = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      fixture.state.readBarrier = { observed, release };
      const first = yield* access.applyBatch(batchSave, "human").pipe(Effect.forkChild);
      yield* Deferred.await(observed);
      const second = yield* access.applyBatch(batchSave, "human");
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(first)).toEqual(second);
      expect(fixture.state.policyWrites).toBe(1);
      expect((yield* access.snapshot).audit).toHaveLength(2);
    }),
  ),
);
it.effect(
  "denies thread self-approval and revoked authorization before commit and receipt replay",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        const denied = Effect.fail(new VaultError({ reason: "denied" }));
        expect(
          (yield* access.applyBatch(batchSave, "human", denied).pipe(Effect.flip)).reason,
        ).toBe("denied");
        for (const actor of ["thread:grant-thread", "mcp-client"])
          expect((yield* access.applyBatch(batchSave, actor).pipe(Effect.flip)).reason).toBe(
            "denied",
          );
        let checks = 0;
        const authorize = Effect.suspend(() => (++checks > 1 ? denied : Effect.void));
        expect(
          (yield* access.applyBatch(batchSave, "human", authorize).pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(fixture.state.policyWriteAttempts).toBe(0);
        yield* access.applyBatch(batchSave, "human", Effect.void);
        expect(
          (yield* access.applyBatch(batchSave, "human", denied).pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(fixture.state.policyWriteAttempts).toBe(1);
      }),
    ),
);

const ownerChange = (
  expectedRevision: number,
  mode: VaultOwnerPolicyChange["mode"],
  digit = "1",
): VaultOwnerPolicyChange => ({
  operationId: digit.repeat(32),
  expectedRevision,
  mode,
});
it.effect("keeps legacy restricted without writes and binds explicit owner setup durably", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      const before = [...fixture.records.entries()];
      expect((yield* access.snapshot).ownerPolicy).toMatchObject({
        environmentId: "grants-test",
        ownerId: null,
        mode: "restricted",
        revision: 0,
        updatedAt: null,
        updatedBy: null,
      });
      expect([...fixture.records.entries()]).toEqual(before);
      const enabled = yield* access.setOwnerPolicy(
        ownerChange(0, "owner-trusted"),
        "human",
        Effect.void,
      );
      expect(enabled.ownerPolicy).toMatchObject({
        mode: "owner-trusted",
        revision: 1,
        updatedAt: 0,
        updatedBy: "human",
      });
      expect(enabled.ownerPolicy?.ownerId).toMatch(/^[a-f0-9]{32}$/);
      const restarted = yield* VaultAccess.VaultAccess.pipe(
        Effect.provide(Layer.fresh(fixture.layer)),
      );
      expect(yield* restarted.snapshot).toEqual(enabled);
      const policyRecord = [...fixture.records.entries()].find(([path]) =>
        path.endsWith("/access-policy"),
      )![1];
      const stored = Redacted.value(policyRecord.value);
      expect(stored).toMatchObject({
        schemaVersion: 5,
        environmentId: "grants-test",
        policy: { schemaVersion: 1 },
      });
      expect(isLegacyPolicy(stored)).toBe(false);
      expect(isProtectedPolicy(stored)).toBe(false);
      expect(JSON.stringify(enabled)).not.toContain("ownerSubject");
    }),
  ),
);
it.effect(
  "allows owner metadata and brokered use without grants, including listing and restricted explain",
  () =>
    withAccess(({ access }) =>
      Effect.gen(function* () {
        yield* access.setOwnerPolicy(ownerChange(0, "owner-trusted"), "human", Effect.void);
        yield* access.require(threadId, itemId, "inspect", null);
        yield* access.require(childId, itemId, "use", "ssh://git@example.test:22");
        expect(
          (yield* access.listForThread(
            { cursor: null, includeArchived: false },
            threadId,
          )).items.map((item) => item.id),
        ).toEqual([itemId]);
        const explanation = yield* access.explain(
          { threadId, itemId, action: "use", destination: "ssh://git@example.test:22" },
          true,
        );
        expect(explanation.item?.id).toBe(itemId);
        expect(explanation.decision).toMatchObject({
          allowed: true,
          basis: "owner-trusted",
          grantId: null,
          lineage: [],
        });
        for (const action of ["manage", "reveal", "export", "delegate"] as const)
          expect(
            (yield* access.explain({ threadId, itemId, action, destination: null })).decision
              .allowed,
          ).toBe(false);
        const readiness = yield* access.readiness({
          threadId,
          requirements: [{ itemId, action: "inspect", destination: null }],
        });
        expect(readiness.checks.find((check) => check.id === "owner-policy")?.state).toBe("passed");
        expect(readiness.decisions[0]?.allowed).toBe(true);
        expect(readiness.ready).toBe(true);
      }),
    ),
);
it.effect(
  "ignores and preserves restricted grants under owner trust and restores them on disable",
  () =>
    withAccess(({ access }) =>
      Effect.gen(function* () {
        yield* access.apply(
          {
            ...save,
            change: {
              type: "save",
              grant: {
                ...definition,
                actions: ["inspect", "use"],
                destination: "ssh://git@allowed.test:22",
              },
            },
          },
          "human",
        );
        const original = (yield* access.snapshot).grants;
        yield* access.setOwnerPolicy(ownerChange(1, "owner-trusted"), "human", Effect.void);
        yield* access.require(threadId, itemId, "use", "ssh://git@other.test:22");
        const disabled = yield* access.setOwnerPolicy(
          ownerChange(2, "restricted", "2"),
          "human",
          Effect.void,
        );
        expect(disabled.grants).toEqual(original);
        yield* access.require(threadId, itemId, "use", "ssh://git@allowed.test:22");
        expect(
          (yield* access
            .require(threadId, itemId, "use", "ssh://git@other.test:22")
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(
          (yield* access.require(childId, itemId, "inspect", null).pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);
it.effect(
  "requires authenticated owner administration before save and retry, and refuses other actors",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        for (const actor of [
          `thread:${threadId}`,
          "mcp-client",
          "client:shared",
          "broker:host",
          "host:source",
          "library:source",
          "loom-host:source",
        ])
          expect(
            (yield* access
              .setOwnerPolicy(ownerChange(0, "owner-trusted"), actor, Effect.void)
              .pipe(Effect.flip)).reason,
          ).toBe("denied");
        expect(fixture.state.policyWrites).toBe(0);
        let checks = 0;
        const revoked = Effect.suspend(() =>
          ++checks === 2 ? Effect.fail(new VaultError({ reason: "denied" })) : Effect.void,
        );
        expect(
          (yield* access
            .setOwnerPolicy(ownerChange(0, "owner-trusted"), "human", revoked)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(fixture.state.policyWrites).toBe(0);
        yield* access.setOwnerPolicy(ownerChange(0, "owner-trusted"), "human", Effect.void);
        expect(
          (yield* access
            .setOwnerPolicy(ownerChange(1, "restricted", "2"), "another-human", Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(
          (yield* access
            .setOwnerPolicy(
              ownerChange(0, "owner-trusted"),
              "human",
              Effect.fail(new VaultError({ reason: "denied" })),
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(fixture.state.policyWrites).toBe(1);
      }),
    ),
);
it.effect(
  "replays lost owner replies once, rejects reused IDs and stale edits, and never re-enables on replay",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        fixture.state.loseNextReply = true;
        const input = ownerChange(0, "owner-trusted");
        expect(
          (yield* access.setOwnerPolicy(input, "human", Effect.void).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        const first = yield* access.setOwnerPolicy(input, "human", Effect.void);
        expect(first.revision).toBe(1);
        expect(fixture.state.policyWrites).toBe(1);
        expect(
          (yield* access
            .setOwnerPolicy({ ...input, mode: "restricted" }, "human", Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(
          (yield* access
            .setOwnerPolicy(ownerChange(0, "restricted", "2"), "human", Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        const disabled = yield* access.setOwnerPolicy(
          ownerChange(1, "restricted", "2"),
          "human",
          Effect.void,
        );
        expect(yield* access.setOwnerPolicy(input, "human", Effect.void)).toEqual(disabled);
        expect(disabled.audit.filter((event) => event.type === "owner-policy-change")).toHaveLength(
          2,
        );
        expect(fixture.state.policyWrites).toBe(2);
      }),
    ),
);
it.effect("retries owner CAS when audit traffic races without repeating policy changes", () =>
  withAccess(({ access, fixture }) =>
    Effect.gen(function* () {
      yield* access.apply(save, "human");
      fixture.state.conflictNextPolicyWrite = true;
      const enabled = yield* access.setOwnerPolicy(
        ownerChange(1, "owner-trusted"),
        "human",
        Effect.void,
      );
      expect(enabled.revision).toBe(2);
      expect(enabled.audit.filter((event) => event.type === "owner-policy-change")).toHaveLength(1);
      expect(fixture.state.policyWriteAttempts).toBe(3);
    }),
  ),
);
it.effect(
  "keeps owner use behind item lifecycle, real active runs and full-access/default modes",
  () =>
    withAccess(({ access, core, fixture }) =>
      Effect.gen(function* () {
        yield* access.setOwnerPolicy(ownerChange(0, "owner-trusted"), "human", Effect.void);
        const explain = () =>
          access.explain({ threadId, itemId, action: "use", destination: null });
        fixture.state.approvalRequired = true;
        expect((yield* explain()).decision.reason).toBe("caller-permission");
        fixture.state.approvalRequired = false;
        fixture.state.interactionMode = "plan";
        expect((yield* explain()).decision.reason).toBe("caller-permission");
        fixture.state.interactionMode = "default";
        fixture.state.runStatus = "completed";
        expect((yield* explain()).decision.reason).toBe("workload-inactive");
        expect(
          (yield* access.listForThread({ cursor: null, includeArchived: false }, threadId)).items,
        ).toEqual([]);
        fixture.state.runStatus = "running";
        fixture.state.active = false;
        expect((yield* explain()).decision.reason).toBe("workload-inactive");
        fixture.state.active = true;
        yield* core.change(
          { id: itemId, operationId: "3".repeat(32), expectedVersion: 1, action: "archive" },
          "human",
        );
        expect((yield* explain()).decision.reason).toBe("item-unavailable");
        yield* access.require(threadId, itemId, "inspect", null);
        fixture.state.deleted = true;
        expect(
          (yield* access.require(threadId, itemId, "inspect", null).pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);
it.effect(
  "writes safe owner audit with environment, owner, thread, run and hashed destination and fails closed",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        const enabled = yield* access.setOwnerPolicy(
          ownerChange(0, "owner-trusted"),
          "human",
          Effect.void,
        );
        const destination = "https://sensitive:password@example.test/path?token=do-not-log";
        yield* access.require(threadId, itemId, "use", destination);
        const snapshot = yield* access.snapshot;
        expect(snapshot.audit[0]?.authorization).toMatchObject({
          category: "owner-trusted",
          environmentId: "grants-test",
          ownerId: enabled.ownerPolicy?.ownerId,
          threadId,
          runId: fixture.state.runId,
          itemKind: "secret",
        });
        expect(snapshot.audit[0]?.authorization?.destinationDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(snapshot)).not.toContain("password");
        expect(JSON.stringify(snapshot)).not.toContain("do-not-log");
        expect(JSON.stringify(snapshot)).not.toContain("synthetic-never-in-audit");
        fixture.state.failWrites = true;
        expect(
          (yield* access.require(threadId, itemId, "use", destination).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
      }),
    ),
);
it.effect(
  "preserves v4 mandatory classification and one-time protections inside the owner envelope",
  () =>
    withAccess(({ access, fixture, core }) =>
      Effect.gen(function* () {
        yield* access.apply(save, "human");
        const preview = yield* access.protectionMigrationPreview(
          { expectedPolicyRevision: 1, selections: [{ itemId, itemVersion: 1, mode: "one-time" }] },
          "human",
          Effect.void,
        );
        const [path, record] = [...fixture.records.entries()].find(([key]) =>
          key.endsWith("/access-policy"),
        )!;
        fixture.records.set(path, {
          value: Redacted.make(preview.proposal),
          version: record.version + 1,
        });
        const enabled = yield* access.setOwnerPolicy(
          ownerChange(2, "owner-trusted"),
          "human",
          Effect.void,
        );
        expect(enabled.ownerPolicy?.mode).toBe("owner-trusted");
        const current = fixture.records.get(path)!;
        const parsed = AccessPolicy.decodePolicy(Redacted.value(current.value));
        expect(Option.isSome(parsed)).toBe(true);
        if (Option.isNone(parsed)) return;
        expect(parsed.value).toMatchObject({
          schemaVersion: 4,
          credentialModes: preview.proposal.credentialModes,
          intents: preview.proposal.intents,
        });
        yield* access.require(threadId, itemId, "inspect", null);
        expect(
          (yield* access.explain({ threadId, itemId, action: "use", destination: null })).decision
            .reason,
        ).toBe("approval-required");
        expect(
          (yield* core.reveal({ id: itemId, expectedVersion: 1 }).pipe(Effect.flip)).reason,
        ).toBe("denied");
        const unclassified = { ...parsed.value, credentialModes: [] };
        fixture.records.set(path, {
          value: Redacted.make(yield* AccessPolicy.encodePolicy(unclassified)),
          version: current.version + 2,
        });
        expect(
          (yield* access.explain({ threadId, itemId, action: "use", destination: null })).decision
            .reason,
        ).toBe("classification-required");
        expect(
          (yield* core.reveal({ id: itemId, expectedVersion: 1 }).pipe(Effect.flip)).reason,
        ).toBe("denied");
        yield* access.setOwnerPolicy(ownerChange(3, "restricted", "2"), "human", Effect.void);
        expect(
          (yield* access.explain({ threadId, itemId, action: "use", destination: null })).decision
            .reason,
        ).toBe("classification-required");
      }),
    ),
);
it.effect(
  "rejects foreign or malformed owner envelopes instead of falling back to legacy grants",
  () =>
    withAccess(({ access, fixture }) =>
      Effect.gen(function* () {
        yield* access.setOwnerPolicy(ownerChange(0, "owner-trusted"), "human", Effect.void);
        const [path, record] = [...fixture.records.entries()].find(([key]) =>
          key.endsWith("/access-policy"),
        )!;
        const original = Redacted.value(record.value);
        const envelope = decodeEnvelopeSummary(original);
        fixture.records.set(path, {
          ...record,
          value: Redacted.make({
            ...envelope,
            schemaVersion: 5,
            environmentId: "foreign",
            ownerReceipts: [],
          }),
        });
        expect((yield* access.snapshot.pipe(Effect.flip)).reason).toBe("invalid-response");
        fixture.records.set(path, {
          ...record,
          value: Redacted.make({
            ...envelope,
            schemaVersion: 5,
            ownerPolicy: null,
            ownerReceipts: [],
          }),
        });
        expect((yield* access.snapshot.pipe(Effect.flip)).reason).toBe("invalid-response");
      }),
    ),
);
