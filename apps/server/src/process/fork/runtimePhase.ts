import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

// The dynamic phase span below is the tracing boundary; a second helper span adds no attribution.
export const runShutdownPhase = Effect.fnUntraced(
  function* <A, E, R>(phase: string, effect: Effect.Effect<A, E, R>) {
    const started = yield* Clock.currentTimeMillis;
    yield* Effect.logInfo("Server shutdown phase started", { phase });
    return yield* effect.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const durationMs = (yield* Clock.currentTimeMillis) - started;
          yield* Effect.annotateCurrentSpan({ durationMs });
          yield* Effect.logInfo("Server shutdown phase finished", {
            phase,
            durationMs,
            success: Exit.isSuccess(exit),
          });
        }),
      ),
    );
  },
  (effect, phase) =>
    effect.pipe(
      Effect.withSpan(`server.shutdown.${phase}`, {
        root: true,
        attributes: { "shutdown.phase": phase },
      }),
    ),
);
