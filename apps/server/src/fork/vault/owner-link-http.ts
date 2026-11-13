import {
  VaultError,
  VaultOwnerLinkApproval,
  VAULT_OWNER_LINK_VERIFY_ROUTE,
} from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { EnvironmentAuth } from "../../auth/EnvironmentAuth.ts";
import { withForkRuntime } from "../ForkRuntime.ts";
import { VaultOwnerLink } from "./VaultOwnerLink.ts";

const decodeApproval = Schema.decodeUnknownEffect(VaultOwnerLinkApproval);
const handler = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const session = yield* (yield* EnvironmentAuth).authenticateHttpRequest(request);
    if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
      return HttpServerResponse.empty({ status: 415 });
    const input = yield* request.json.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(8)),
      Effect.flatMap(decodeApproval),
      Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
    );
    const result = yield* (yield* VaultOwnerLink).verify(input, session);
    return HttpServerResponse.jsonUnsafe(result, { headers: { "cache-control": "no-store" } });
  }),
).pipe(
  Effect.catchTags({
    VaultError: (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(error, {
          status: error.reason === "denied" ? 403 : error.reason === "invalid-input" ? 400 : 503,
          headers: { "cache-control": "no-store" },
        }),
      ),
    ServerAuthMissingCredentialError: () =>
      Effect.succeed(HttpServerResponse.empty({ status: 401 })),
    ServerAuthInvalidCredentialError: () =>
      Effect.succeed(HttpServerResponse.empty({ status: 401 })),
  }),
);
export const VaultOwnerLinkHttpRoutes = HttpRouter.add(
  "POST",
  VAULT_OWNER_LINK_VERIFY_ROUTE,
  handler,
);
