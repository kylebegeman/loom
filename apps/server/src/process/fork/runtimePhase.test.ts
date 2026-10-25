import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Tracer from "effect/Tracer";
import * as TestClock from "effect/testing/TestClock";
import { runShutdownPhase } from "./runtimePhase.ts";

it.effect("attributes a shutdown over the old five-second budget to its phase", () =>
  Effect.gen(function* () {
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const started = yield* Deferred.make<void>();
    const finish = yield* Deferred.make<void>();
    const task = yield* runShutdownPhase(
      "providerSessions.shutdown",
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish))),
    ).pipe(Effect.withTracer(tracer), Effect.forkChild);
    yield* Deferred.await(started);
    yield* TestClock.adjust("6 seconds");
    yield* Deferred.succeed(finish, undefined);
    yield* Fiber.join(task);
    expect(spans[0]?.name).toBe("server.shutdown.providerSessions.shutdown");
    expect(spans[0]?.attributes.get("durationMs")).toBe(6000);
  }),
);
