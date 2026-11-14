import { LibraryPublishingCredential } from "../../auth/LibraryPublishingCredential.ts";
import { AuthSettingsWriteScope, EnvironmentId } from "@t3tools/contracts";
import {
  ACCOUNT_ACCESS_HEADER,
  ACCOUNT_ENROLLMENT_ACTIVATE,
  AccountComputerEnrollment,
  ACCOUNT_ACCESS_PREFIX,
  ACCOUNT_ACCESS_VERIFY,
  AccountVerification,
  ACCOUNT_JOIN_BEGIN,
  ACCOUNT_JOIN_REDEEM,
  ACCOUNT_JOIN_START,
  ACCOUNT_JOIN_STEP,
  ACCOUNT_JOIN_STATUS,
  AccountJoinRequest,
  AccountJoinRedemption,
  ComputerJoinStart,
  LibraryError,
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
import { AccountJoin } from "./AccountJoin.ts";
import { ComputerJoin } from "./ComputerJoin.ts";

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

const decodeActivation = Schema.decodeUnknownEffect(
  Schema.Struct({
    requestId: AccountComputerEnrollment.fields.requestId,
  }),
);
const activate = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const token = request.headers.authorization?.match(/^Bearer (.+)$/u)?.[1];
    if (token === undefined) return HttpServerResponse.empty({ status: 401 });
    const input = yield* request.json.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(1)),
      Effect.flatMap(decodeActivation),
      Effect.mapError(() => new AccountAccess.AccountAccessError({ reason: "denied" })),
    );
    yield* (yield* LibraryPublishingCredential).activate({ requestId: input.requestId, token });
    return HttpServerResponse.empty({ status: 204, headers: { "cache-control": "no-store" } });
  }),
).pipe(
  Effect.catchTags({
    LibraryPublishingCredentialError: () =>
      Effect.succeed(HttpServerResponse.empty({ status: 403 })),
    AccountAccessError: (error) => Effect.succeed(failure(error)),
  }),
);

const decodeJoin = Schema.decodeUnknownEffect(AccountJoinRequest);
const decodeJoinStart = Schema.decodeUnknownEffect(ComputerJoinStart);
const encodeRedemption = Schema.encodeEffect(AccountJoinRedemption);
const invalidJoin = () =>
  new LibraryError({ reason: "blocked", detail: "The computer approval request is invalid." });
const joinBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return yield* request.json.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(64)),
    Effect.flatMap(decodeJoin),
    Effect.mapError(invalidJoin),
  );
});
const joinBegin = withForkRuntime(
  Effect.gen(function* () {
    const input = yield* joinBody;
    const review = yield* (yield* AccountJoin).begin(input);
    return HttpServerResponse.jsonUnsafe(review, { headers: { "cache-control": "no-store" } });
  }),
);
const joinRedeem = withForkRuntime(
  Effect.gen(function* () {
    const input = yield* joinBody;
    const result = yield* (yield* AccountJoin).redeem(input);
    return HttpServerResponse.jsonUnsafe(
      yield* encodeRedemption(result).pipe(Effect.mapError(invalidJoin)),
      { headers: { "cache-control": "no-store" } },
    );
  }),
);
const joinOperator = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (request.headers.authorization === undefined) return yield* invalidJoin();
  const session = yield* (yield* EnvironmentAuth.EnvironmentAuth).authenticateHttpRequest(request);
  if (
    !session.scopes.includes(AuthSettingsWriteScope) ||
    session.subject === "mcp-client" ||
    session.subject.startsWith("loom-host:")
  )
    return yield* invalidJoin();
});
const joinStart = withForkRuntime(
  Effect.gen(function* () {
    yield* joinOperator;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const input = yield* request.json.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(4)),
      Effect.flatMap(decodeJoinStart),
      Effect.mapError(invalidJoin),
    );
    return HttpServerResponse.jsonUnsafe(yield* (yield* ComputerJoin).start(input), {
      headers: { "cache-control": "no-store" },
    });
  }),
);
const joinStep = withForkRuntime(
  Effect.gen(function* () {
    yield* joinOperator;
    return HttpServerResponse.jsonUnsafe(yield* (yield* ComputerJoin).step, {
      headers: { "cache-control": "no-store" },
    });
  }),
);
const joinStatus = withForkRuntime(
  Effect.gen(function* () {
    yield* joinOperator;
    return HttpServerResponse.jsonUnsafe(yield* (yield* ComputerJoin).readiness, {
      headers: { "cache-control": "no-store" },
    });
  }),
);
const joinErrors = {
  LibraryError: (error: LibraryError) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { reason: error.reason, message: error.message },
        {
          status: error.reason === "not-authority" ? 404 : error.reason === "io" ? 503 : 403,
          headers: { "cache-control": "no-store" },
        },
      ),
    ),
  ServerAuthMissingCredentialError: () => Effect.succeed(HttpServerResponse.empty({ status: 401 })),
  ServerAuthInvalidCredentialError: () => Effect.succeed(HttpServerResponse.empty({ status: 401 })),
};

export const AccountAccessRoutes = Layer.mergeAll(
  HttpRouter.add(
    "POST",
    ACCOUNT_JOIN_BEGIN,
    joinBegin.pipe(Effect.catchTags({ LibraryError: joinErrors.LibraryError })),
  ),
  HttpRouter.add(
    "POST",
    ACCOUNT_JOIN_REDEEM,
    joinRedeem.pipe(Effect.catchTags({ LibraryError: joinErrors.LibraryError })),
  ),
  HttpRouter.add("POST", ACCOUNT_JOIN_START, joinStart.pipe(Effect.catchTags(joinErrors))),
  HttpRouter.add("POST", ACCOUNT_JOIN_STEP, joinStep.pipe(Effect.catchTags(joinErrors))),
  HttpRouter.add("POST", ACCOUNT_JOIN_STATUS, joinStatus.pipe(Effect.catchTags(joinErrors))),
  HttpRouter.add("*", `${ACCOUNT_ACCESS_PREFIX}*`, forward),
  HttpRouter.add("POST", ACCOUNT_ACCESS_VERIFY, verify),
  HttpRouter.add("POST", ACCOUNT_ENROLLMENT_ACTIVATE, activate),
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
