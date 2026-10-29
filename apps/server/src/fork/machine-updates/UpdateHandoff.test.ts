import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { type UpdatePlan } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { UpdateFence } from "./UpdateFence.ts";
import { UPDATE_FENCE_LEASE_MS, UpdateHandoff } from "./UpdateHandoff.ts";
import { stoppedThread, updateBoundaryFixture } from "./updateBoundaries.testkit.ts";

const plan: UpdatePlan = {
  version: 1,
  id: "waiting-plan",
  targetVersion: "0.1.1",
  state: "waiting",
  createdAt: 0,
  updatedAt: 0,
  finishedAt: null,
  error: null,
};

it.effect("counts current restart-impact work and refuses a lease until those threads settle", () =>
  Effect.gen(function* () {
    const f = yield* updateBoundaryFixture(plan);
    const active: OrchestrationV2ThreadShell[] = [
      "preparing",
      "queued",
      "starting",
      "running",
      "waiting",
    ].map((status) => ({
      ...stoppedThread(status),
      status: status as OrchestrationV2ThreadShell["status"],
    }));
    yield* Ref.set(f.threads, [
      ...active,
      { ...stoppedThread("active-run"), activityRunStatus: "running" },
      {
        ...stoppedThread("background"),
        pendingBackgroundTasks: [{ taskId: "background", kind: "background_task" }],
      },
      {
        ...stoppedThread("awaited-command"),
        pendingBackgroundTasks: [{ taskId: "build", kind: "command", awaited: true }],
      },
      {
        ...stoppedThread("detached-command"),
        pendingBackgroundTasks: [{ taskId: "dev-server", kind: "command" }],
      },
      {
        ...stoppedThread("recoverable-watch"),
        pendingBackgroundTasks: [{ taskId: "pull-request-watch:123", kind: "background_task" }],
      },
      stoppedThread("done"),
    ]);
    const archived = stoppedThread("archived-running");
    yield* Ref.set(f.archivedThreads, [
      { ...archived, status: "running", archivedAt: archived.createdAt },
    ]);
    yield* Effect.gen(function* () {
      const handoff = yield* UpdateHandoff;
      const fence = yield* UpdateFence;
      assert.deepEqual(yield* handoff.activity, { waitingAgents: 9, plan });
      assert.deepEqual(yield* handoff.acquire("plan"), {
        leaseId: null,
        waitingAgents: 9,
        expiresAt: null,
      });
      yield* fence.write(Effect.void);
      yield* Ref.set(f.threads, []);
      assert.deepEqual(yield* handoff.acquire("plan"), {
        leaseId: null,
        waitingAgents: 1,
        expiresAt: null,
      });
      yield* Ref.set(f.archivedThreads, []);
      const lease = yield* handoff.acquire("plan");
      assert.isNotNull(lease.leaseId);
      assert.equal(lease.waitingAgents, 0);
      yield* handoff.release(lease.leaseId!);
      yield* fence.write(Effect.void);
    }).pipe(Effect.provide(f.handoff));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "renews an owner's lease, refuses competing owners, expires it, and ignores stale releases",
  () =>
    Effect.gen(function* () {
      const f = yield* updateBoundaryFixture();
      yield* Effect.gen(function* () {
        const handoff = yield* UpdateHandoff;
        const first = yield* handoff.acquire("owner-a");
        assert.isNotNull(first.leaseId);
        assert.equal(first.expiresAt, (yield* Clock.currentTimeMillis) + UPDATE_FENCE_LEASE_MS);
        yield* TestClock.adjust("30 seconds");
        const renewed = yield* handoff.acquire("owner-a");
        assert.equal(renewed.leaseId, first.leaseId);
        assert.equal(renewed.expiresAt, (yield* Clock.currentTimeMillis) + UPDATE_FENCE_LEASE_MS);
        assert.isNull((yield* handoff.acquire("owner-b")).leaseId);
        yield* handoff.release("wrong-lease");
        assert.isNull((yield* handoff.acquire("owner-b")).leaseId);
        const written = yield* Deferred.make<void>();
        const writer = yield* (yield* UpdateFence)
          .write(Deferred.succeed(written, undefined))
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(UPDATE_FENCE_LEASE_MS);
        yield* Deferred.await(written);
        yield* Fiber.join(writer);
        const next = yield* handoff.acquire("owner-b");
        assert.isNotNull(next.leaseId);
        assert.notEqual(next.leaseId, first.leaseId);
        yield* handoff.release(first.leaseId!);
        assert.isNull((yield* handoff.acquire("owner-c")).leaseId);
        yield* handoff.release(next.leaseId!);
        const final = yield* handoff.acquire("owner-c");
        assert.isNotNull(final.leaseId);
        yield* handoff.release(final.leaseId!);
        yield* (yield* UpdateFence).write(Effect.void);
      }).pipe(Effect.provide(f.handoff));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "preserves unknown aggregate progress and accepts counts only for the current waiting plan",
  () =>
    Effect.gen(function* () {
      const f = yield* updateBoundaryFixture(plan);
      yield* Effect.gen(function* () {
        const handoff = yield* UpdateHandoff;
        assert.isUndefined(yield* handoff.waiting(plan.id));
        yield* handoff.progress({ planId: plan.id, waitingAgents: null });
        assert.isNull(yield* handoff.waiting(plan.id));
        yield* handoff.progress({ planId: plan.id, waitingAgents: 3 });
        assert.equal(yield* handoff.waiting(plan.id), 3);
        assert.equal(
          (yield* handoff.progress({ planId: "stale", waitingAgents: 0 }).pipe(Effect.flip)).reason,
          "changed",
        );
        assert.equal(yield* handoff.waiting(plan.id), 3);
        yield* Ref.set(f.saved, { ...plan, id: "replacement", state: "armed" as const });
        assert.isUndefined(yield* handoff.waiting("replacement"));
        yield* handoff.progress({ planId: "replacement", waitingAgents: 0 });
        assert.equal(yield* handoff.waiting("replacement"), 0);
        yield* Ref.set(f.saved, { ...plan, id: "replacement", state: "installing" as const });
        assert.equal(
          (yield* handoff.progress({ planId: "replacement", waitingAgents: 1 }).pipe(Effect.flip))
            .reason,
          "changed",
        );
      }).pipe(Effect.provide(f.handoff));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
