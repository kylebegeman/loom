import { UpdatePlanError, type UpdatePlan, type UpdatePlanStatus } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import { isExactServiceVersion } from "../../cloud/serviceProtocol.ts";
import { forkParked } from "../../serverActivation.ts";
import * as UpdateHandoff from "./UpdateHandoff.ts";
import * as UpdatePlanStore from "./UpdatePlanStore.ts";
import * as UpdateRuntime from "./UpdateRuntime.ts";

const UPDATE_QUIET_MS = 30_000;
const active = (plan: UpdatePlan | null): plan is UpdatePlan =>
  plan !== null &&
  (plan.state === "armed" || plan.state === "waiting" || plan.state === "installing");

export class UpdatePlans extends Context.Service<
  UpdatePlans,
  {
    readonly status: Effect.Effect<UpdatePlanStatus, UpdatePlanError>;
    readonly arm: (targetVersion: string) => Effect.Effect<UpdatePlanStatus, UpdatePlanError>;
    readonly cancel: (id: string) => Effect.Effect<UpdatePlanStatus, UpdatePlanError>;
  }
>()("t3/fork/machine-updates/UpdatePlans") {}

const make = Effect.gen(function* () {
  const store = yield* UpdatePlanStore.UpdatePlanStore;
  const runtime = yield* UpdateRuntime.UpdateRuntime;
  const handoff = yield* UpdateHandoff.UpdateHandoff;
  const crypto = yield* Crypto.Crypto;
  const loaded = yield* store.read.pipe(
    Effect.match({
      onFailure: (error) => ({ plan: null, error }),
      onSuccess: (plan) => ({ plan, error: null }),
    }),
  );
  const current = yield* Ref.make(loaded.plan);
  const mutex = yield* Semaphore.make(1);
  const wake = yield* Queue.dropping<void>(1);
  const status = Effect.gen(function* () {
    if (loaded.error !== null) return yield* loaded.error;
    const plan = yield* Ref.get(current);
    const reported = active(plan) ? yield* handoff.waiting(plan.id) : undefined;
    const waitingAgents = active(plan)
      ? reported !== undefined
        ? reported
        : yield* handoff.activity.pipe(
            Effect.map((value) => value.waitingAgents),
            Effect.orElseSucceed(() => null),
          )
      : null;
    return {
      plan,
      waitingAgents,
      currentVersion: runtime.currentVersion,
      supported: runtime.supported,
      unavailableReason: runtime.supported
        ? null
        : "This computer needs a supported Loom background service or desktop updater.",
    };
  });
  const save = Effect.fn("UpdatePlans.save")(function* (plan: UpdatePlan) {
    yield* store.write(plan);
    yield* Ref.set(current, plan);
  });
  const change = Effect.fn("UpdatePlans.change")(function (
    id: string,
    state: UpdatePlan["state"],
    error: string | null = null,
  ) {
    return mutex.withPermits(1)(
      Effect.gen(function* () {
        const previous = yield* Ref.get(current);
        if (!active(previous) || previous.id !== id)
          return yield* new UpdatePlanError({ reason: "changed" });
        const now = yield* Clock.currentTimeMillis;
        yield* save({
          ...previous,
          state,
          updatedAt: now,
          finishedAt: state === "done" || state === "failed" || state === "cancelled" ? now : null,
          error,
        });
      }),
    );
  });
  const check = Effect.fn("UpdatePlans.check")(function* (id: string) {
    const plan = yield* Ref.get(current);
    if (!active(plan) || plan.id !== id) return yield* new UpdatePlanError({ reason: "changed" });
    return plan;
  });
  const wait = Queue.take(wake).pipe(Effect.timeoutOption(UPDATE_QUIET_MS), Effect.asVoid);
  const awaitIdle = Effect.fn("UpdatePlans.awaitIdle")(function* (id: string) {
    let idleSince: number | null = null;
    while (true) {
      yield* check(id);
      const activity = yield* handoff.activity;
      const now = yield* Clock.currentTimeMillis;
      if (activity.waitingAgents > 0) idleSince = null;
      else if (idleSince === null) idleSince = now;
      else if (now - idleSince >= UPDATE_QUIET_MS) return;
      yield* wait;
    }
  });
  const run = Effect.fn("UpdatePlans.run")(function* (plan: UpdatePlan) {
    if (!runtime.supported) return yield* new UpdatePlanError({ reason: "unavailable" });
    if (plan.targetVersion === runtime.currentVersion) {
      yield* change(plan.id, "done");
      return;
    }
    yield* change(plan.id, "waiting");
    yield* awaitIdle(plan.id);
    let leaseId: string | null = null;
    let accepted = false;
    const ready = Effect.gen(function* () {
      while (true) {
        yield* awaitIdle(plan.id);
        const lease = yield* handoff.acquire(plan.id);
        if (lease.leaseId !== null) {
          leaseId = lease.leaseId;
          yield* change(plan.id, "installing");
          return;
        }
        yield* wait;
      }
    });
    return yield* runtime
      .install(
        plan.targetVersion,
        ready,
        Effect.sync(() => {
          accepted = true;
        }),
      )
      .pipe(
        Effect.andThen(
          Effect.gen(function* () {
            if (!accepted) return yield* new UpdatePlanError({ reason: "update" });
            // The old process keeps its fence until the existing updater replaces it.
            while (true) {
              yield* Effect.sleep("30 seconds");
              yield* handoff.acquire(plan.id);
            }
          }),
        ),
        Effect.ensuring(
          Effect.suspend(() => (leaseId === null ? Effect.void : handoff.release(leaseId))),
        ),
      );
  });
  yield* forkParked(
    Effect.forever(
      Effect.gen(function* () {
        const plan = yield* Ref.get(current);
        if (active(plan)) {
          yield* run(plan).pipe(
            Effect.catch((error) =>
              change(plan.id, "failed", error.message).pipe(
                Effect.catchTags({ UpdatePlanError: () => Effect.void }),
              ),
            ),
          );
        }
        const next = yield* Ref.get(current);
        if (active(next) && next.id !== plan?.id) return;
        yield* wait;
      }),
    ),
  );
  return UpdatePlans.of({
    status,
    arm: Effect.fn("UpdatePlans.arm")(function* (targetVersion) {
      if (loaded.error !== null) return yield* loaded.error;
      if (!runtime.supported) return yield* new UpdatePlanError({ reason: "unavailable" });
      if (!isExactServiceVersion(targetVersion) || targetVersion.length > 100)
        return yield* new UpdatePlanError({ reason: "invalid" });
      yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          const previous = yield* Ref.get(current);
          if (active(previous)) {
            if (previous.targetVersion === targetVersion) return;
            return yield* new UpdatePlanError({ reason: "busy" });
          }
          const now = yield* Clock.currentTimeMillis;
          yield* save({
            version: 1,
            id: yield* crypto.randomUUIDv4().pipe(Effect.orDie),
            targetVersion,
            state: "armed",
            createdAt: now,
            updatedAt: now,
            finishedAt: null,
            error: null,
          });
        }),
      );
      yield* Queue.offer(wake, undefined);
      return yield* status;
    }),
    cancel: Effect.fn("UpdatePlans.cancel")(function* (id) {
      yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          const plan = yield* check(id);
          if (plan.state === "installing")
            return yield* new UpdatePlanError({ reason: "installing" });
          const now = yield* Clock.currentTimeMillis;
          yield* save({ ...plan, state: "cancelled", updatedAt: now, finishedAt: now });
        }),
      );
      yield* Queue.offer(wake, undefined);
      return yield* status;
    }),
  });
});

export const layer = Layer.effect(UpdatePlans, make);
