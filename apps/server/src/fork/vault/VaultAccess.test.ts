import * as ApprovalNotifications from "./ApprovalNotifications.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  type VaultGrantDefinition,
  type VaultGrantMutation,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Option from "effect/Option";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";

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
    notificationsFail: false,
    failWrites: false,
    active: true,
    deleted: false,
    approvalRequired: false,
  };
  const store = OpenBaoStore.OpenBaoStore.of({
    status: Effect.succeed({
      backend: "openbao",
      state: "ready",
      origin: "https://vault.example.test",
    }),
    read: (path) => Effect.sync(() => records.get(path) ?? null),
    keys: (prefix) =>
      Effect.sync(() =>
        [...records.keys()]
          .filter((key) => key.startsWith(prefix + "/"))
          .map((key) => key.slice(prefix.length + 1)),
      ),
    write: (path, value, expected) =>
      Effect.suspend(() => {
        if (state.failWrites) return Effect.fail(new VaultError({ reason: "unavailable" }));
        const current = records.get(path)?.version ?? 0;
        if (current !== expected) return Effect.fail(new VaultError({ reason: "conflict" }));
        records.set(path, { value, version: current + 1 });
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
      get: (id) =>
        Effect.succeed(
          id === projectId
            ? Option.some({ projectId, title: "Test project" } as never)
            : Option.none(),
        ),
    }),
    Layer.succeed(OpenBaoStore.OpenBaoStore, store),
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("grants-test")),
    }),
    Layer.mock(ThreadManagementService)({
      getThreadShell: (id) =>
        Effect.sync(() =>
          id === ThreadId.make("missing")
            ? null
            : ({
                id,
                projectId,
                deletedAt: state.deleted ? "2026-10-18T00:00:00Z" : null,
                archivedAt: null,
                activeRunId: state.active ? RunId.make("grant-run") : null,
                runtimeMode: state.approvalRequired ? "approval-required" : "full-access",
                interactionMode: "default",
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
      Layer.succeed(ApprovalNotifications.ApprovalNotifications, {
        pending: () =>
          Effect.suspend(() =>
            state.notificationsFail
              ? Effect.fail(new VaultError({ reason: "unavailable" }))
              : Effect.void,
          ),
      }),
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
        kind: "secret",
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
      const restarted = yield* VaultAccess.VaultAccess.pipe(Effect.provide(fixture.layer));
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
      ).pipe(Effect.provide(fixture.layer));
      expect(reopened.requests[0]?.state).toBe("approved");
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
