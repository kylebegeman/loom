import {
  SWITCHBOARD_ENROLL_PATH,
  SWITCHBOARD_MEMBERS_ROUTE,
  SWITCHBOARD_REDEEM_ROUTE,
  SWITCHBOARD_TICKET_ROUTE,
  SwitchboardEnrollment,
  SwitchboardEnrollRequest,
  SwitchboardMembersRequest,
  SwitchboardRedeemRequest,
  SwitchboardRedemption,
  SwitchboardTicketEnvelope,
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
import { SwitchboardAccountError, switchboardAccountStatus } from "./SwitchboardAccountError.ts";
import { SwitchboardClients } from "./SwitchboardClients.ts";
import { SwitchboardIssuer } from "./SwitchboardIssuer.ts";
import { SWITCHBOARD_GATEWAY_PREFIX } from "./switchboard.ts";

const NO_STORE = { "cache-control": "no-store" };
const invalid = () => new SwitchboardAccountError({ reason: "invalid" });
const body = Effect.fn("SwitchboardAccountRoutes.body")(function* <S extends Schema.Top>(
  schema: S,
  limit: ByteSize.ByteSize,
) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return yield* request.json.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, limit),
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(invalid),
  );
});
const publisher = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return yield* (yield* EnvironmentAuth.EnvironmentAuth).authenticateHttpRequest(request);
});
const errors = {
  SwitchboardAccountError: (error: SwitchboardAccountError) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { reason: error.reason, message: error.message },
        { status: switchboardAccountStatus(error), headers: NO_STORE },
      ),
    ),
  ServerAuthMissingCredentialError: () => Effect.succeed(HttpServerResponse.empty({ status: 401 })),
  ServerAuthInvalidCredentialError: () => Effect.succeed(HttpServerResponse.empty({ status: 401 })),
};

const ticket = withForkRuntime(
  Effect.gen(function* () {
    const session = yield* publisher;
    const envelope = yield* body(SwitchboardTicketEnvelope, ByteSize.kibibytes(32));
    const issued = yield* (yield* SwitchboardIssuer).ticket(envelope, session);
    return HttpServerResponse.jsonUnsafe(issued, { headers: NO_STORE });
  }),
).pipe(Effect.catchTags(errors));

const encodeRedemption = Schema.encodeEffect(SwitchboardRedemption);
const redeem = withForkRuntime(
  Effect.gen(function* () {
    const session = yield* publisher;
    const input = yield* body(SwitchboardRedeemRequest, ByteSize.kibibytes(1));
    const redemption = yield* (yield* SwitchboardIssuer).redeem(input.ticket, session);
    return HttpServerResponse.jsonUnsafe(
      yield* encodeRedemption(redemption).pipe(Effect.mapError(invalid)),
      { headers: NO_STORE },
    );
  }),
).pipe(Effect.catchTags(errors));

const members = withForkRuntime(
  Effect.gen(function* () {
    const session = yield* publisher;
    const input = yield* body(SwitchboardMembersRequest, ByteSize.kibibytes(256));
    const active = yield* (yield* SwitchboardIssuer).members(input.memberships, session);
    return HttpServerResponse.jsonUnsafe({ active }, { headers: NO_STORE });
  }),
).pipe(Effect.catchTags(errors));

const encodeEnrollment = Schema.encodeEffect(SwitchboardEnrollment);
/** On the hub's reach host: the ticket is the only credential, and it works once. */
const enroll = withForkRuntime(
  Effect.gen(function* () {
    const input = yield* body(SwitchboardEnrollRequest, ByteSize.kibibytes(1));
    const credential = yield* (yield* SwitchboardClients).enroll(input.ticket);
    return HttpServerResponse.jsonUnsafe(
      yield* encodeEnrollment({ credential }).pipe(Effect.mapError(invalid)),
      { headers: NO_STORE },
    );
  }),
).pipe(Effect.catchTags({ SwitchboardAccountError: errors.SwitchboardAccountError }));

export const SwitchboardAccountRoutes = Layer.mergeAll(
  HttpRouter.add("POST", SWITCHBOARD_TICKET_ROUTE, ticket),
  HttpRouter.add("POST", SWITCHBOARD_REDEEM_ROUTE, redeem),
  HttpRouter.add("POST", SWITCHBOARD_MEMBERS_ROUTE, members),
  HttpRouter.add("POST", `${SWITCHBOARD_GATEWAY_PREFIX}${SWITCHBOARD_ENROLL_PATH}`, enroll),
);
