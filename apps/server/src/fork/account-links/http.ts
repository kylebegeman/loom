import {
  ACCOUNT_LINKS_ADMIT,
  ACCOUNT_LINKS_GRANT,
  ACCOUNT_LINKS_ROSTER,
  ACCOUNT_LINKS_VERIFY,
  AccountLinkAdmission,
  AccountLinkAdmitRequest,
  AccountLinkGrantRequest,
  AccountLinkVerifyRequest,
} from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { withForkRuntime } from "../ForkRuntime.ts";
import { AccountLinkAuthority } from "./AccountLinkAuthority.ts";
import { AccountLinkError, AccountLinks } from "./AccountLinks.ts";

const NO_STORE = { "cache-control": "no-store" };
const encodeAdmission = Schema.encodeEffect(AccountLinkAdmission);

const failure = (error: AccountLinkError) =>
  HttpServerResponse.jsonUnsafe(
    { reason: error.reason, message: error.message },
    {
      status: error.reason === "disabled" ? 404 : error.reason === "denied" ? 403 : 503,
      headers: NO_STORE,
    },
  );

const decodeGrantRequest = Schema.decodeUnknownEffect(AccountLinkGrantRequest);
const decodeVerifyRequest = Schema.decodeUnknownEffect(AccountLinkVerifyRequest);
const decodeAdmitRequest = Schema.decodeUnknownEffect(AccountLinkAdmitRequest);

const readBody = Effect.fn("AccountLinks.readBody")(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return yield* request.json.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(4)),
    Effect.mapError(() => new AccountLinkError({ reason: "denied" })),
  );
});
const invalid = () => new AccountLinkError({ reason: "denied" });

const publisher = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return yield* (yield* EnvironmentAuth.EnvironmentAuth).authenticateHttpRequest(request);
});

const errors = {
  AccountLinkError: (error: AccountLinkError) => Effect.succeed(failure(error)),
  ServerAuthMissingCredentialError: () => Effect.succeed(HttpServerResponse.empty({ status: 401 })),
  ServerAuthInvalidCredentialError: () => Effect.succeed(HttpServerResponse.empty({ status: 401 })),
};

/** On the Library, for a computer's publisher session. */
const roster = withForkRuntime(
  Effect.gen(function* () {
    const session = yield* publisher;
    const result = yield* (yield* AccountLinkAuthority).roster(session);
    return HttpServerResponse.jsonUnsafe(result, { headers: NO_STORE });
  }),
).pipe(Effect.catchTags(errors));

const grant = withForkRuntime(
  Effect.gen(function* () {
    const session = yield* publisher;
    const input = yield* readBody().pipe(
      Effect.flatMap(decodeGrantRequest),
      Effect.mapError(invalid),
    );
    const result = yield* (yield* AccountLinkAuthority).grant(session, input);
    return HttpServerResponse.jsonUnsafe(result, { headers: NO_STORE });
  }),
).pipe(Effect.catchTags(errors));

const verify = withForkRuntime(
  Effect.gen(function* () {
    const session = yield* publisher;
    const input = yield* readBody().pipe(
      Effect.flatMap(decodeVerifyRequest),
      Effect.mapError(invalid),
    );
    const result = yield* (yield* AccountLinkAuthority).verify(session, input);
    return HttpServerResponse.jsonUnsafe(result, { headers: NO_STORE });
  }),
).pipe(Effect.catchTags(errors));

/**
 * On every computer, and reachable on its Loomhost address: carries no credential of its own, so
 * the grant is all it trusts, and only this computer's Library connection can redeem one.
 */
const admit = withForkRuntime(
  Effect.gen(function* () {
    const input = yield* readBody().pipe(
      Effect.flatMap(decodeAdmitRequest),
      Effect.mapError(invalid),
    );
    const admission = yield* (yield* AccountLinks).admit(input);
    const encoded = yield* encodeAdmission(admission).pipe(
      Effect.mapError(() => new AccountLinkError({ reason: "unavailable" })),
    );
    return HttpServerResponse.jsonUnsafe(encoded, { headers: NO_STORE });
  }),
).pipe(Effect.catchTags({ AccountLinkError: errors.AccountLinkError }));

export const AccountLinkRoutes = Layer.mergeAll(
  HttpRouter.add("GET", ACCOUNT_LINKS_ROSTER, roster),
  HttpRouter.add("POST", ACCOUNT_LINKS_GRANT, grant),
  HttpRouter.add("POST", ACCOUNT_LINKS_VERIFY, verify),
  HttpRouter.add("POST", ACCOUNT_LINKS_ADMIT, admit),
);
