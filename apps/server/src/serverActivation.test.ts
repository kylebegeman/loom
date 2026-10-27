// fork: server-weight: upstream deleted this file; it keeps the fork's detached-trace test.
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Tracer from "effect/Tracer";

import * as ServerActivation from "./serverActivation.ts";

it.effect.each(["parked", "unparked"] as const)(
  "starts %s work in its own trace instead of the caller's",
  (mode) =>
    Effect.scoped(
      Effect.gen(function* () {
        const activation = yield* Deferred.make<void>();
        const work = yield* Deferred.make<Tracer.Span>();
        const startup = yield* Effect.gen(function* () {
          yield* ServerActivation.forkParked(
            Effect.currentSpan.pipe(
              Effect.flatMap((span) => Deferred.succeed(work, span)),
              Effect.withSpan("parked.work"),
            ),
          );
          return yield* Effect.currentSpan;
        }).pipe(
          Effect.withSpan("server.startup"),
          mode === "parked"
            ? Effect.provideService(ServerActivation.ServerActivation, Deferred.await(activation))
            : (effect) => effect,
        );

        yield* Deferred.succeed(activation, undefined);
        const span = yield* Deferred.await(work);
        expect(Option.isNone(span.parent)).toBe(true);
        expect(span.traceId).not.toBe(startup.traceId);
      }),
    ),
);
