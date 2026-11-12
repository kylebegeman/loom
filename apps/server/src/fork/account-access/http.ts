import { EnvironmentId } from "@t3tools/contracts";
import {
  ACCOUNT_ACCESS_HEADER,
  ACCOUNT_ACCESS_PREFIX,
  ACCOUNT_ACCESS_VERIFY,
  AccountVerification,
} from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Types from "effect/Types";
import * as Schema from "effect/Schema";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  Headers,
} from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { withForkRuntime } from "../ForkRuntime.ts";
import * as AccountAccess from "./AccountAccess.ts";
import * as AccountGateway from "./AccountGateway.ts";
import * as AccountHost from "./AccountHost.ts";

const decodeEnvironmentId = Schema.decodeEffect(EnvironmentId);
const decodeVerification = Schema.decodeUnknownEffect(AccountVerification);

const failure = (error: AccountAccess.AccountAccessError) =>
  HttpServerResponse.jsonUnsafe(
    error.reason === "authentication"
      ? { code: "auth_invalid", reason: "invalid_credential", traceId: "account-access" }
      : { reason: error.reason, message: error.message },
    {
      status:
        error.reason === "disabled"
          ? 404
          : error.reason === "authentication"
            ? 401
            : error.reason === "denied"
              ? 403
              : 503,
      headers: { "cache-control": "no-store" },
    },
  );
const forward = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const remaining = request.url.slice(ACCOUNT_ACCESS_PREFIX.length);
    const split = remaining.indexOf("/");
    if (split < 1) return HttpServerResponse.empty({ status: 404 });
    const environmentId = yield* Effect.try({
      try: () => decodeURIComponent(remaining.slice(0, split)),
      catch: () => new AccountAccess.AccountAccessError({ reason: "denied" }),
    }).pipe(
      Effect.flatMap(decodeEnvironmentId),
      Effect.mapError(() => new AccountAccess.AccountAccessError({ reason: "denied" })),
    );
    return yield* (yield* AccountGateway.AccountGateway).forward({
      request,
      environmentId,
      path: remaining.slice(split),
    });
  }),
).pipe(Effect.catchTags({ AccountAccessError: (error) => Effect.succeed(failure(error)) }));

const verify = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const publisher = yield* (yield* EnvironmentAuth.EnvironmentAuth).authenticateHttpRequest(
      request,
    );
    const body = yield* request.json.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(16)),
      Effect.flatMap(decodeVerification),
      Effect.mapError(() => new AccountAccess.AccountAccessError({ reason: "denied" })),
    );
    const admitted = yield* (yield* AccountAccess.AccountAccess).consume({ ...body, publisher });
    return HttpServerResponse.jsonUnsafe(admitted, { headers: { "cache-control": "no-store" } });
  }),
).pipe(
  Effect.catchTags({
    AccountAccessError: (error) => Effect.succeed(failure(error)),
    ServerAuthMissingCredentialError: () =>
      Effect.succeed(HttpServerResponse.empty({ status: 401 })),
    ServerAuthInvalidCredentialError: () =>
      Effect.succeed(HttpServerResponse.empty({ status: 401 })),
  }),
);

export const AccountAccessRoutes = Layer.mergeAll(
  HttpRouter.add("*", `${ACCOUNT_ACCESS_PREFIX}*`, forward),
  HttpRouter.add("POST", ACCOUNT_ACCESS_VERIFY, verify),
  // The parallel checker needs concrete middleware channels to preserve upstream requirements.
  HttpRouter.middleware<Types.unhandled, HttpServerRequest.HttpServerRequest, never, never, true>(
    Effect.gen(function* () {
      const host = yield* withForkRuntime(AccountHost.AccountHost);
      return <E, R>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const grant = request.headers[ACCOUNT_ACCESS_HEADER];
          if (grant === undefined) return yield* app;
          const token = yield* host
            .admit({ grant, method: request.method, path: request.url })
            .pipe(Effect.result);
          if (token._tag === "Failure") return failure(token.failure);
          const headers = Headers.remove(
            Headers.remove(
              Headers.set(request.headers, "authorization", `Bearer ${token.success}`),
              ACCOUNT_ACCESS_HEADER,
            ),
            "cookie",
          );
          return yield* app.pipe(
            Effect.provideService(HttpServerRequest.HttpServerRequest, request.modify({ headers })),
          );
        });
    }),
    { global: true },
  ),
);
