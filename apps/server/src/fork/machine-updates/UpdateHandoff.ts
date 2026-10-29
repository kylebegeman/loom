import {
  UpdatePlanError,
  type UpdateActivity,
  type UpdateFenceLease,
  type UpdateProgress,
} from "@t3tools/contracts/fork";
import { threadRestartImpact } from "@t3tools/shared/fork/restart-impact";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import { forkParked } from "../../serverActivation.ts";
import * as UpdateFence from "./UpdateFence.ts";
import * as UpdatePlanStore from "./UpdatePlanStore.ts";

export const UPDATE_FENCE_LEASE_MS = 120_000;
type Lease = {
  readonly id: string;
  readonly owner: string;
  readonly expiresAt: number;
  readonly release: Effect.Effect<void>;
};

export class UpdateHandoff extends Context.Service<
  UpdateHandoff,
  {
    readonly activity: Effect.Effect<UpdateActivity, UpdatePlanError>;
    readonly acquire: (owner: string) => Effect.Effect<UpdateFenceLease, UpdatePlanError>;
    readonly release: (leaseId: string) => Effect.Effect<void>;
    readonly progress: (input: UpdateProgress) => Effect.Effect<void, UpdatePlanError>;
    readonly waiting: (planId: string) => Effect.Effect<number | null | undefined>;
  }
>()("t3/fork/machine-updates/UpdateHandoff") {}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const store = yield* UpdatePlanStore.UpdatePlanStore;
  const fence = yield* UpdateFence.UpdateFence;
  const crypto = yield* Crypto.Crypto;
  const lease = yield* Ref.make<Lease | null>(null);
  const reported = yield* Ref.make<{ readonly id: string; readonly count: number | null } | null>(
    null,
  );
  const mutex = yield* Semaphore.make(1);
  const count = projections.getShellSnapshot().pipe(
    Effect.map(
      (snapshot) =>
        [...snapshot.threads, ...snapshot.archivedThreads].filter(
          (thread) => threadRestartImpact(thread) !== null,
        ).length,
    ),
    Effect.mapError((cause) => new UpdatePlanError({ reason: "activity", cause })),
  );
  const expire = Effect.gen(function* () {
    const current = yield* Ref.get(lease);
    if (current !== null && current.expiresAt <= (yield* Clock.currentTimeMillis)) {
      yield* Ref.set(lease, null);
      yield* current.release;
    }
  });
  yield* forkParked(
    Effect.forever(Effect.sleep("30 seconds").pipe(Effect.andThen(mutex.withPermits(1)(expire)))),
  );
  yield* Effect.addFinalizer(() =>
    Ref.get(lease).pipe(Effect.flatMap((current) => current?.release ?? Effect.void)),
  );
  return UpdateHandoff.of({
    activity: Effect.all({ waitingAgents: count, plan: store.read }),
    waiting: Effect.fn("UpdateHandoff.waiting")((id: string) =>
      Ref.get(reported).pipe(Effect.map((value) => (value?.id === id ? value.count : undefined))),
    ),
    progress: Effect.fn("UpdateHandoff.progress")(function* (input) {
      const plan = yield* store.read;
      if (
        plan === null ||
        plan.id !== input.planId ||
        (plan.state !== "armed" && plan.state !== "waiting")
      ) {
        return yield* new UpdatePlanError({ reason: "changed" });
      }
      yield* Ref.set(reported, { id: input.planId, count: input.waitingAgents });
    }),
    acquire: Effect.fn("UpdateHandoff.acquire")(function (owner) {
      return mutex.withPermits(1)(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            yield* expire;
            const current = yield* Ref.get(lease);
            const expiresAt = (yield* Clock.currentTimeMillis) + UPDATE_FENCE_LEASE_MS;
            if (current !== null) {
              if (current.owner !== owner)
                return { leaseId: null, waitingAgents: 0, expiresAt: null };
              yield* Ref.set(lease, { ...current, expiresAt });
              return { leaseId: current.id, waitingAgents: 0, expiresAt };
            }
            const release = yield* restore(fence.acquire);
            const waitingAgents = yield* restore(count).pipe(Effect.onError(() => release));
            if (waitingAgents > 0) {
              yield* release;
              return { leaseId: null, waitingAgents, expiresAt: null };
            }
            const id = yield* crypto.randomUUIDv4().pipe(
              Effect.onError(() => release),
              Effect.orDie,
            );
            yield* Ref.set(lease, { id, owner, expiresAt, release });
            return { leaseId: id, waitingAgents: 0, expiresAt };
          }),
        ),
      );
    }),
    release: Effect.fn("UpdateHandoff.release")(function (leaseId) {
      return mutex.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(lease);
          if (current?.id !== leaseId) return;
          yield* Ref.set(lease, null);
          yield* current.release;
        }),
      );
    }),
  });
});

export const layer = Layer.effect(UpdateHandoff, make);
