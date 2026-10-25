import type { ServerDirectEndpoint } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

/**
 * The reach address (`https://<hostname>/`) while this computer's connector runs. DirectEndpoints
 * is built below ForkLayer and cannot see ReachService, so server.ts provides this holder beneath
 * both and they share one instance.
 */
export class ReachPublicRoute extends Context.Service<
  ReachPublicRoute,
  { readonly url: Ref.Ref<Option.Option<string>> }
>()("t3/fork/reach/publicRoute/ReachPublicRoute") {}

export const layer = Layer.effect(
  ReachPublicRoute,
  Effect.map(Ref.make(Option.none<string>()), (url) => ReachPublicRoute.of({ url })),
);

/** What DirectEndpoints appends: nothing without the holder, which upstream tests never build. */
export const reachPublicEndpoints = (
  route: Option.Option<ReachPublicRoute["Service"]>,
): Effect.Effect<ReadonlyArray<ServerDirectEndpoint>> =>
  Option.isNone(route)
    ? Effect.succeed([])
    : Effect.map(Ref.get(route.value.url), (url) =>
        Option.isNone(url) ? [] : [{ kind: "public", httpBaseUrl: url.value }],
      );
