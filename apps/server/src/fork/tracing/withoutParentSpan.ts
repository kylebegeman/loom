import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";

/**
 * Background work outlives the span that started it, so each unit of it starts its own trace
 * instead of growing the startup trace for the server's whole life.
 */
export const withoutParentSpan = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  // The cast is sound because ParentSpan is ambient, never a declared requirement.
  Effect.updateContext(
    effect,
    (context: Context.Context<R>) => Context.omit(Tracer.ParentSpan)(context) as Context.Context<R>,
  );
