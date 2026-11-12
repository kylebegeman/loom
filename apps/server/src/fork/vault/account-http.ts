import {
  ACCOUNT_PROFILE_RECORD_ROUTE,
  AccountProfileRecordEnvelope,
  ACCOUNT_VAULT_ROUTE,
  AccountVaultEnvelope,
  VaultError,
  ACCOUNT_PROVIDER_CREDENTIAL_ROUTE,
  AccountProviderResponse,
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
import * as AccountVaultAuthority from "./AccountVaultAuthority.ts";
import * as AccountVaultMachineAuthority from "./AccountVaultMachineAuthority.ts";

const decodeEnvelope = Schema.decodeUnknownEffect(AccountVaultEnvelope);
const decodeProfileEnvelope = Schema.decodeUnknownEffect(AccountProfileRecordEnvelope);
const encodeProvider = Schema.encodeEffect(AccountProviderResponse);
const handler = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const publisher = yield* (yield* EnvironmentAuth.EnvironmentAuth).authenticateHttpRequest(
      request,
    );
    if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
      return HttpServerResponse.empty({ status: 415 });
    const isProfile = request.url.split("?")[0] === ACCOUNT_PROFILE_RECORD_ROUTE;
    const input = yield* request.json.pipe(
      Effect.provideService(
        HttpIncomingMessage.MaxBodySize,
        isProfile ? ByteSize.mebibytes(3) : ByteSize.kibibytes(96),
      ),
      Effect.flatMap(isProfile ? decodeProfileEnvelope : decodeEnvelope),
      Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
    );
    const result = isProfile
      ? yield* (yield* AccountVaultMachineAuthority.AccountVaultMachineAuthority).profileRecord(
          input,
          publisher,
        )
      : request.url.split("?")[0] === ACCOUNT_PROVIDER_CREDENTIAL_ROUTE
        ? yield* (yield* AccountVaultMachineAuthority.AccountVaultMachineAuthority)
            .providerCredential(input, publisher)
            .pipe(
              Effect.flatMap((value) =>
                encodeProvider(value).pipe(
                  Effect.mapError(() => new VaultError({ reason: "unavailable" })),
                ),
              ),
            )
        : yield* (yield* AccountVaultAuthority.AccountVaultAuthority).execute(input, publisher);
    return HttpServerResponse.jsonUnsafe(result, { headers: { "cache-control": "no-store" } });
  }),
).pipe(
  Effect.catchTags({
    VaultError: (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(error, {
          status:
            error.reason === "invalid-input"
              ? 400
              : error.reason === "denied"
                ? 403
                : error.reason === "conflict"
                  ? 409
                  : 503,
          headers: { "cache-control": "no-store" },
        }),
      ),
    VaultSshError: (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(error, {
          status: error.reason === "capacity" ? 429 : 400,
          headers: { "cache-control": "no-store" },
        }),
      ),
    VaultGitHubError: (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(error, {
          status:
            error.reason === "unauthorized" || error.reason === "repository-denied" ? 403 : 502,
          headers: { "cache-control": "no-store" },
        }),
      ),
    VaultConnectionError: (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(error, {
          status: 409,
          headers: { "cache-control": "no-store" },
        }),
      ),
    ServerAuthMissingCredentialError: () =>
      Effect.succeed(HttpServerResponse.empty({ status: 401 })),
    ServerAuthInvalidCredentialError: () =>
      Effect.succeed(HttpServerResponse.empty({ status: 401 })),
  }),
);
export const AccountVaultHttpRoutes = Layer.mergeAll(
  HttpRouter.add("POST", ACCOUNT_PROFILE_RECORD_ROUTE, handler),
  HttpRouter.add("POST", ACCOUNT_VAULT_ROUTE, handler),
  HttpRouter.add("POST", ACCOUNT_PROVIDER_CREDENTIAL_ROUTE, handler),
);
