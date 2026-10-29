import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as UpdateFence from "./UpdateFence.ts";

it.effect("drains event writers before holding new events until release", () =>
  Effect.gen(function* () {
    const fence = yield* UpdateFence.UpdateFence;
    const events = yield* Ref.make<string[]>([]);
    const entered = yield* Deferred.make<void>();
    const finish = yield* Deferred.make<void>();
    const frozen = yield* Deferred.make<void>();
    const thaw = yield* Deferred.make<void>();
    const attempted = yield* Deferred.make<void>();
    const first = yield* fence
      .write(
        Effect.gen(function* () {
          yield* Ref.update(events, (xs) => [...xs, "first"]);
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(finish);
          yield* Ref.update(events, (xs) => [...xs, "finished"]);
        }),
      )
      .pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    const hold = yield* Effect.acquireUseRelease(
      fence.acquire,
      () =>
        Effect.gen(function* () {
          yield* Ref.update(events, (xs) => [...xs, "frozen"]);
          yield* Deferred.succeed(frozen, undefined);
          yield* Deferred.await(thaw);
          yield* Ref.update(events, (xs) => [...xs, "released"]);
        }),
      (release) => release,
    ).pipe(Effect.forkChild);
    yield* Deferred.succeed(finish, undefined);
    yield* Deferred.await(frozen);
    const second = yield* Deferred.succeed(attempted, undefined).pipe(
      Effect.andThen(fence.write(Ref.update(events, (xs) => [...xs, "second"]))),
      Effect.forkChild,
    );
    yield* Deferred.await(attempted);
    yield* Deferred.succeed(thaw, undefined);
    yield* Fiber.joinAll([first, hold, second]);
    assert.deepEqual(yield* Ref.get(events), ["first", "finished", "frozen", "released", "second"]);
  }).pipe(Effect.provide(UpdateFence.layer)),
);
