import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { makeSharedJobs } from "./sharedJobs.ts";
it.effect("shares work and keeps another consumer alive when one cancels", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const jobs = yield* makeSharedJobs<string, never>();
      const started = yield* Deferred.make<void>(),
        result = yield* Deferred.make<string>();
      let calls = 0,
        interrupts = 0;
      const work = Effect.sync(() => {
        calls++;
      }).pipe(
        Effect.andThen(Deferred.succeed(started, undefined)),
        Effect.andThen(Deferred.await(result)),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupts++;
          }),
        ),
      );
      const first = yield* jobs
        .run("board", work)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(started);
      const second = yield* jobs
        .run("board", work)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Fiber.interrupt(first);
      expect(interrupts).toBe(0);
      yield* Deferred.succeed(result, "drawing");
      expect(yield* Fiber.join(second)).toBe("drawing");
      expect(calls).toBe(1);
      expect(yield* jobs.run("board", Effect.succeed("new drawing"))).toBe("new drawing");
    }),
  ),
);
it.effect("cancels an abandoned job and releases its resources", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const jobs = yield* makeSharedJobs<void, never>(),
        started = yield* Deferred.make<void>(),
        stopped = yield* Deferred.make<void>();
      const work = Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Deferred.succeed(stopped, undefined)),
      );
      const consumer = yield* jobs
        .run("board", work)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(consumer);
      expect(yield* Deferred.isDone(stopped)).toBe(true);
    }),
  ),
);
