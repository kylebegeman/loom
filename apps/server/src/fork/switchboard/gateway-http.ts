import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { withForkRuntime } from "../ForkRuntime.ts";
import * as SwitchboardGateway from "./SwitchboardGateway.ts";
import { SWITCHBOARD_GATEWAY_ERROR_HEADER, SWITCHBOARD_GATEWAY_PREFIX } from "./switchboard.ts";

const handler = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* (yield* SwitchboardGateway.SwitchboardGateway).forward(
      request,
      request.url.slice(SWITCHBOARD_GATEWAY_PREFIX.length),
    );
  }),
).pipe(
  Effect.catchTags({
    SwitchboardGatewayError: (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          {
            error: {
              type: error.reason === "authentication" ? "authentication_error" : "api_error",
              message:
                error.reason === "authentication"
                  ? "The Switchboard client credential was refused."
                  : "Shared Switchboard is unavailable.",
            },
          },
          {
            status:
              error.reason === "disabled" || error.reason === "path"
                ? 404
                : error.reason === "authentication"
                  ? 401
                  : 503,
            // The gateway drops `x-loom-` headers from upstream, so this one is always its own.
            headers: {
              "cache-control": "no-store",
              [SWITCHBOARD_GATEWAY_ERROR_HEADER]: error.reason,
            },
          },
        ),
      ),
  }),
);
export const SwitchboardGatewayRoutes = HttpRouter.add(
  "*",
  `${SWITCHBOARD_GATEWAY_PREFIX}/*`,
  handler,
);
