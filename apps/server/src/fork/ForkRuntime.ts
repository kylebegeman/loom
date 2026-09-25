import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** Every service a packet adds to ForkLayer. Packets append `| TheirService`. */
export type ForkServices = never;

/**
 * The fork services' context, published by ForkLayer. A Reference has a default, so
 * reading it adds no requirement to the upstream layers that host fork transport code.
 */
export class ForkRuntime extends Context.Reference<Context.Context<ForkServices> | undefined>(
  "loom/ForkRuntime",
  { defaultValue: () => undefined },
) {}

/** Runs fork logic with the fork services. Dies if ForkLayer is not installed. */
export const withForkRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, ForkServices>> =>
  Effect.flatMap(ForkRuntime, (context) =>
    context === undefined
      ? Effect.die(new Error("The Loom server runtime is not installed."))
      : Effect.provideContext(effect, context),
  );
