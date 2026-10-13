// fork: project-checkout-management
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { makeStorageCleanupWorker } from "./storageCleanup.ts";

const burst = (request: Effect.Effect<void>) =>
  Effect.all(
    Array.from({ length: 100 }, () => request),
    { concurrency: "unbounded" },
  );

describe("Storage cleanup scheduling", () => {
  it.effect("coalesces automatic requests queued behind a manual sweep", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const triggers: string[] = [];
        const worker = yield* makeStorageCleanupWorker((trigger) =>
          Effect.gen(function* () {
            triggers.push(trigger);
            if (trigger === "manual") {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
            }
            return triggers.length;
          }),
        );
        const manual = yield* Effect.forkChild(worker.runNow);
        yield* Deferred.await(started);
        yield* burst(worker.requestSweep);
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(manual)).toBe(1);
        yield* worker.drain;
        expect(triggers).toEqual(["manual", "automatic"]);
      }),
    ),
  );

  it.effect("runs one follow-up for a burst during a sweep and includes it in drain", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const secondStarted = yield* Deferred.make<void>();
        const releaseSecond = yield* Deferred.make<void>();
        const drained = yield* Deferred.make<void>();
        let sweeps = 0;
        const worker = yield* makeStorageCleanupWorker(() =>
          Effect.gen(function* () {
            sweeps++;
            if (sweeps === 1) {
              yield* Deferred.succeed(firstStarted, undefined);
              yield* Deferred.await(releaseFirst);
            } else if (sweeps === 2) {
              yield* Deferred.succeed(secondStarted, undefined);
              yield* Deferred.await(releaseSecond);
            }
          }),
        );
        yield* worker.requestSweep;
        yield* Deferred.await(firstStarted);
        yield* burst(worker.requestSweep);
        yield* Effect.forkChild(
          worker.drain.pipe(Effect.andThen(Deferred.succeed(drained, undefined))),
        );
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Deferred.await(secondStarted);
        expect(yield* Deferred.isDone(drained)).toBe(false);
        yield* Deferred.succeed(releaseSecond, undefined);
        yield* Deferred.await(drained);
        expect(sweeps).toBe(2);
      }),
    ),
  );

  it.effect("preserves each manual result among automatic requests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const triggers: string[] = [];
        const worker = yield* makeStorageCleanupWorker((trigger) =>
          Effect.gen(function* () {
            triggers.push(trigger);
            if (triggers.length === 1) {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
            }
            return { trigger, sequence: triggers.length };
          }),
        );
        yield* worker.requestSweep;
        yield* Deferred.await(started);
        const first = yield* Effect.forkChild(worker.runNow, { startImmediately: true });
        const second = yield* Effect.forkChild(worker.runNow, { startImmediately: true });
        yield* burst(worker.requestSweep);
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(first)).toEqual({ trigger: "manual", sequence: 2 });
        expect(yield* Fiber.join(second)).toEqual({ trigger: "manual", sequence: 3 });
        yield* worker.drain;
        expect(triggers).toEqual(["automatic", "manual", "manual", "automatic"]);
      }),
    ),
  );

  it.effect("delivers manual failures and continues processing later requests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let attempts = 0;
        const worker = yield* makeStorageCleanupWorker(() =>
          Effect.suspend(() =>
            ++attempts === 1 ? Effect.fail("fixture failure") : Effect.succeed(attempts),
          ),
        );
        expect(yield* worker.runNow.pipe(Effect.result)).toMatchObject({ _tag: "Failure" });
        expect(yield* worker.runNow).toBe(2);
        yield* worker.drain;
      }),
    ),
  );

  it.effect("delivers a sweep construction defect to its manual caller", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let attempts = 0;
        const failure = new Error("fixture defect");
        const worker = yield* makeStorageCleanupWorker(() => {
          if (++attempts === 1) throw failure;
          return Effect.succeed(attempts);
        });
        const result = yield* worker.runNow.pipe(Effect.exit);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") expect(Cause.squash(result.cause)).toBe(failure);
        expect(yield* worker.runNow).toBe(2);
        yield* worker.drain;
      }),
    ),
  );

  it.effect("keeps a requested follow-up when an automatic sweep fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let attempts = 0;
        const worker = yield* makeStorageCleanupWorker(() =>
          Effect.gen(function* () {
            attempts++;
            if (attempts === 1) {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
              return yield* Effect.fail("fixture failure");
            }
          }),
        );
        yield* worker.requestSweep;
        yield* Deferred.await(started);
        yield* burst(worker.requestSweep);
        yield* Deferred.succeed(release, undefined);
        yield* worker.drain;
        expect(attempts).toBe(2);
        yield* worker.requestSweep;
        yield* worker.drain;
        expect(attempts).toBe(3);
      }),
    ),
  );
});
