import {
  ACCOUNT_PROFILE_RECORD_ROUTE,
  ACCOUNT_VAULT_RELAY_ROUTE,
  ACCOUNT_VAULT_VERIFY_ROUTE,
  ACCOUNT_VAULT_STATUS_ROUTE,
  AccountVaultVerification,
  AccountVaultRelayRequest,
  AccountProfileRecordEnvelope,
  ACCOUNT_VAULT_ROUTE,
  AccountVaultEnvelope,
  AccountVaultResponse,
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
import * as AccountWorkloads from "../account-access/AccountWorkloads.ts";
import * as AccountVaultRouting from "./AccountVaultRouting.ts";
import * as VaultCore from "./VaultCore.ts";
import * as AccountVaultAuthority from "./AccountVaultAuthority.ts";
import * as AccountVaultMachineAuthority from "./AccountVaultMachineAuthority.ts";

const decodeVerification = Schema.decodeUnknownEffect(AccountVaultVerification);
const decodeRelay = Schema.decodeUnknownEffect(AccountVaultRelayRequest);
const encodeResponse = Schema.encodeEffect(AccountVaultResponse);
const decodeEnvelope = Schema.decodeUnknownEffect(AccountVaultEnvelope);
const decodeProfileEnvelope = Schema.decodeUnknownEffect(AccountProfileRecordEnvelope);
const encodeProvider = Schema.encodeEffect(AccountProviderResponse);
const handler = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const pathname = request.url.split("?")[0];
    const publisher =
      pathname === ACCOUNT_VAULT_RELAY_ROUTE
        ? undefined
        : yield* (yield* EnvironmentAuth.EnvironmentAuth).authenticateHttpRequest(request);
    if (pathname === ACCOUNT_VAULT_VERIFY_ROUTE) {
      const input = yield* request.json.pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(3)),
        Effect.flatMap(decodeVerification),
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      return HttpServerResponse.jsonUnsafe(
        yield* (yield* AccountWorkloads.AccountWorkloads).verifyRelay(input, publisher!),
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
      return HttpServerResponse.empty({ status: 415 });
    let route: AccountVaultRelayRequest["route"] =
      pathname === ACCOUNT_PROFILE_RECORD_ROUTE
        ? "profile"
        : pathname === ACCOUNT_PROVIDER_CREDENTIAL_ROUTE
          ? "provider"
          : pathname === ACCOUNT_VAULT_STATUS_ROUTE
            ? "status"
            : "workload";
    const isRelay = pathname === ACCOUNT_VAULT_RELAY_ROUTE;
    const isProfile = route === "profile";
    const input = yield* request.json.pipe(
      Effect.provideService(
        HttpIncomingMessage.MaxBodySize,
        isProfile || isRelay ? ByteSize.mebibytes(3) : ByteSize.kibibytes(96),
      ),
      Effect.flatMap((body) =>
        isRelay
          ? decodeRelay(body).pipe(
              Effect.map((relay) => {
                route = relay.route;
                return relay.envelope;
              }),
            )
          : (isProfile ? decodeProfileEnvelope : decodeEnvelope)(body),
      ),
      Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
    );
    if (publisher) {
      const forwarded = yield* (yield* AccountVaultRouting.AccountVaultRouting).forward(
        input,
        publisher,
        route,
      );
      if (forwarded._tag === "Some")
        return HttpServerResponse.jsonUnsafe(forwarded.value, {
          headers: { "cache-control": "no-store" },
        });
    }
    const result =
      route === "status"
        ? yield* Effect.gen(function* () {
            const workloads = yield* AccountWorkloads.AccountWorkloads;
            const lease = yield* workloads.acceptProvider(input.payload, input.proof, publisher);
            yield* workloads.revalidate(lease);
            return yield* (yield* VaultCore.VaultCore).status;
          })
        : route === "profile"
          ? yield* (yield* AccountVaultMachineAuthority.AccountVaultMachineAuthority).profileRecord(
              input,
              publisher,
            )
          : route === "provider"
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
    const encoded =
      route === "workload"
        ? yield* encodeResponse(result as AccountVaultResponse).pipe(
            Effect.mapError(() => new VaultError({ reason: "invalid-response" })),
          )
        : result;
    return HttpServerResponse.jsonUnsafe(encoded, { headers: { "cache-control": "no-store" } });
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
  HttpRouter.add("POST", ACCOUNT_VAULT_RELAY_ROUTE, handler),
  HttpRouter.add("POST", ACCOUNT_VAULT_VERIFY_ROUTE, handler),
  HttpRouter.add("POST", ACCOUNT_VAULT_STATUS_ROUTE, handler),
  HttpRouter.add("POST", ACCOUNT_PROFILE_RECORD_ROUTE, handler),
  HttpRouter.add("POST", ACCOUNT_VAULT_ROUTE, handler),
  HttpRouter.add("POST", ACCOUNT_PROVIDER_CREDENTIAL_ROUTE, handler),
);
