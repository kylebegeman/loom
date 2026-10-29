import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { UpdatePlan } from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as UpdateHandoff from "./UpdateHandoff.ts";
import * as UpdatePlanStore from "./UpdatePlanStore.ts";
import * as UpdatePlans from "./UpdatePlans.ts";
import * as UpdateRuntime from "./UpdateRuntime.ts";

const savedPlan: UpdatePlan = {
  version: 1,
  id: "saved",
  targetVersion: "0.1.1",
  state: "waiting",
  createdAt: 0,
  updatedAt: 0,
  finishedAt: null,
  error: null,
};

const fixture = (initial: UpdatePlan | null = null, currentVersion = "0.1.0") =>
  Effect.gen(function* () {
    const saved = yield* Ref.make(initial);
    const count = yield* Ref.make(2);
    const writes = yield* Queue.unbounded<UpdatePlan>();
    const preparing = yield* Deferred.make<void>();
    const prepared = yield* Deferred.make<void>();
    const checking = yield* Deferred.make<void>();
    const installed = yield* Deferred.make<void>();
    const aborted = yield* Deferred.make<void>();
    const releases = yield* Ref.make(0);
    const unreported = yield* Ref.make<number | null | undefined>(undefined);
    const layer = UpdatePlans.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(UpdatePlanStore.UpdatePlanStore, {
            read: Ref.get(saved),
            write: (plan) =>
              Ref.set(saved, plan).pipe(Effect.andThen(Queue.offer(writes, plan)), Effect.asVoid),
          }),
          Layer.succeed(UpdateHandoff.UpdateHandoff, {
            activity: Effect.all({ waitingAgents: Ref.get(count), plan: Ref.get(saved) }),
            waiting: () => Ref.get(unreported),
            progress: () => Effect.void,
            acquire: () =>
              Ref.get(count).pipe(
                Effect.map((waitingAgents) => ({
                  waitingAgents,
                  leaseId: waitingAgents === 0 ? "lease" : null,
                  expiresAt: 120_000,
                })),
              ),
            release: () => Ref.update(releases, (value) => value + 1),
          }),
          Layer.succeed(UpdateRuntime.UpdateRuntime, {
            currentVersion,
            supported: true,
            install: (_version, beforeHandoff, accepted) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(preparing, undefined);
                yield* Deferred.await(prepared);
                yield* Deferred.succeed(checking, undefined);
                yield* beforeHandoff;
                yield* accepted;
                yield* Deferred.succeed(installed, undefined);
              }).pipe(Effect.onError(() => Deferred.succeed(aborted, undefined))),
          }),
        ),
      ),
    );
    const state = (expected: UpdatePlan["state"]) =>
      Stream.fromQueue(writes).pipe(
        Stream.filter((plan) => plan.state === expected),
        Stream.runHead,
      );
    return {
      layer,
      saved,
      count,
      preparing,
      prepared,
      checking,
      installed,
      aborted,
      releases,
      state,
    };
  });

it.effect("waits for agents and checks again after preparation before handing off", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const service = yield* UpdatePlans.UpdatePlans;
      const first = yield* service.arm("0.1.1");
      assert.isNotNull(first.plan);
      assert.equal((yield* service.arm("0.1.1")).plan?.id, first.plan?.id);
      yield* f.state("waiting");
      yield* Ref.set(f.count, 0);
      yield* TestClock.adjust("60 seconds");
      yield* Deferred.await(f.preparing);
      yield* Ref.set(f.count, 1);
      yield* Deferred.succeed(f.prepared, undefined);
      yield* Deferred.await(f.checking);
      yield* TestClock.adjust("30 seconds");
      assert.equal((yield* service.status).plan?.state, "waiting");
      assert.equal((yield* service.status).waitingAgents, 1);
      yield* Ref.set(f.count, 0);
      yield* TestClock.adjust("60 seconds");
      yield* Deferred.await(f.installed);
      assert.equal((yield* service.status).plan?.state, "installing");
      assert.equal((yield* service.cancel(first.plan!.id).pipe(Effect.flip)).reason, "installing");
    }).pipe(Effect.provide(f.layer));
    assert.equal(yield* Ref.get(f.releases), 1);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("cancels a waiting plan and a plan whose download is still preparing", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const service = yield* UpdatePlans.UpdatePlans;
      const first = yield* service.arm("0.1.1");
      yield* f.state("waiting");
      yield* service.cancel(first.plan!.id);
      assert.equal((yield* service.status).plan?.state, "cancelled");
      assert.equal((yield* service.cancel(first.plan!.id).pipe(Effect.flip)).reason, "changed");
      const second = yield* service.arm("0.1.1");
      yield* f.state("waiting");
      yield* Ref.set(f.count, 0);
      yield* TestClock.adjust("60 seconds");
      yield* Deferred.await(f.preparing);
      yield* service.cancel(second.plan!.id);
      yield* Deferred.succeed(f.prepared, undefined);
      yield* Deferred.await(f.aborted);
      assert.equal((yield* service.status).plan?.state, "cancelled");
      assert.equal(yield* Ref.get(f.releases), 0);
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("loads an armed plan after restart and recognizes a completed version", () =>
  Effect.gen(function* () {
    const pending = yield* fixture(savedPlan);
    yield* Effect.gen(function* () {
      const service = yield* UpdatePlans.UpdatePlans;
      yield* pending.state("waiting");
      assert.equal((yield* service.status).plan?.id, "saved");
      yield* service.cancel("saved");
    }).pipe(Effect.provide(pending.layer));
    const completed = yield* fixture({ ...savedPlan, state: "installing" }, "0.1.1");
    yield* Effect.gen(function* () {
      const service = yield* UpdatePlans.UpdatePlans;
      yield* completed.state("done");
      assert.equal((yield* service.status).plan?.state, "done");
    }).pipe(Effect.provide(completed.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);
