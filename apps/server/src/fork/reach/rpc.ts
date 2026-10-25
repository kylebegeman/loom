import type { EnvironmentAuthorizationError } from "@t3tools/contracts";
import { REACH_WS_METHODS as REACH, type ReachSetInput } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import { ReachService } from "./ReachService.ts";

type ReachMethod = (typeof REACH)["watch" | "set" | "remove" | "forget"];

/** The part of `ForkRpcAuth` these handlers use, which it satisfies once it lists the reach methods. */
export interface ReachRpcAuth {
  readonly effect: <A, E, R>(
    method: ReachMethod,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;
  readonly stream: <A, E, R>(
    method: ReachMethod,
    stream: Stream.Stream<A, E, R>,
  ) => Stream.Stream<A, E | EnvironmentAuthorizationError, R>;
}

export const makeReachRpcHandlers = Effect.fn("Reach.makeRpcHandlers")(function* (
  auth: ReachRpcAuth,
) {
  const service = yield* ReachService;
  return {
    [REACH.watch]: () => auth.stream(REACH.watch, service.changes),
    [REACH.set]: (input: ReachSetInput) =>
      auth.effect(REACH.set, service.setEnabled(input.enabled)),
    [REACH.remove]: () => auth.effect(REACH.remove, service.remove()),
    [REACH.forget]: () => auth.effect(REACH.forget, service.forget()),
  };
});
