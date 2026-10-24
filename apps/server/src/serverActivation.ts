import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import type * as Scope from "effect/Scope";

import { withoutParentSpan } from "./fork/tracing/withoutParentSpan.ts"; // fork: server-weight

export class ServerActivation extends Context.Reference<Effect.Effect<void> | undefined>(
  "t3/serverActivation",
  { defaultValue: () => undefined },
) {}

export const forkParkedFiber = Effect.fn("serverActivation.forkParkedFiber")(function* <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.fn.Return<Fiber.Fiber<A, E>, never, Scope.Scope | R> {
  const activation = yield* ServerActivation;
  const detached = withoutParentSpan(effect); // fork: server-weight
  if (activation === undefined) {
    return yield* Effect.forkScoped(detached); // fork: server-weight
  }
  const parked = yield* Deferred.make<void>();
  const fiber = yield* Effect.forkScoped(
    // fork: server-weight
    Deferred.succeed(parked, undefined).pipe(Effect.andThen(activation), Effect.andThen(detached)),
  );
  yield* Deferred.await(parked);
  return fiber;
});

export const forkParked = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<void, never, Scope.Scope | R> => forkParkedFiber(effect).pipe(Effect.asVoid);
