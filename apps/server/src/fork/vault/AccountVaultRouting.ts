import type { DirectoryEnvironment } from "@t3tools/contracts/fork";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import {
  ACCOUNT_VAULT_RELAY_ROUTE,
  type AccountVaultEnvelope,
  type AccountVaultRelayRequest,
  VaultError,
  AccountVaultFailure,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ByteSize from "effect/ByteSize";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpIncomingMessage } from "effect/http";
import { isDirectoryRouteUrl } from "@t3tools/shared/fork/directory";
import * as AccountWorkloads from "../account-access/AccountWorkloads.ts";
import * as Directory from "../directory/DirectoryService.ts";
import * as Store from "./OpenBaoStore.ts";

export class AccountVaultRouting extends Context.Service<
  AccountVaultRouting,
  {
    readonly backend: Effect.Effect<Option.Option<DirectoryEnvironment>, VaultError>;
    readonly forward: (
      envelope: AccountVaultEnvelope,
      publisher: AuthenticatedSession,
      route: AccountVaultRelayRequest["route"],
    ) => Effect.Effect<Option.Option<unknown>, typeof AccountVaultFailure.Type>;
  }
>()("t3/fork/vault/AccountVaultRouting") {}

const decodeFailure = Schema.decodeUnknownEffect(AccountVaultFailure);
const make = Effect.gen(function* () {
  const store = yield* Store.OpenBaoStore;
  const directory = yield* Directory.DirectoryService;
  const workloads = yield* AccountWorkloads.AccountWorkloads;
  const http = yield* HttpClient.HttpClient;
  const unavailable = () => new VaultError({ reason: "unavailable" });
  const backend = Effect.gen(function* () {
    if (
      typeof store.configured === "boolean"
        ? store.configured
        : (yield* store.status).state !== "unconfigured"
    )
      return Option.none();
    const candidates = (yield* directory.list.pipe(
      Effect.mapError(unavailable),
    )).environments.filter((entry) => entry.vaultBackend === true);
    if (candidates.length !== 1)
      return yield* new VaultError({
        reason: candidates.length === 0 ? "configuration" : "unavailable",
      });
    return Option.some(candidates[0]!);
  });
  return AccountVaultRouting.of({
    backend,
    forward: Effect.fn("AccountVaultRouting.forward")(function* (envelope, publisher, route) {
      if (
        typeof store.configured === "boolean"
          ? store.configured
          : (yield* store.status).state !== "unconfigured"
      )
        return Option.none();
      const lease = yield* route === "workload"
        ? workloads.accept(envelope.payload, envelope.proof, publisher)
        : workloads.acceptProvider(envelope.payload, envelope.proof, publisher);
      const selected = yield* backend;
      if (Option.isNone(selected)) return Option.none();
      const host = selected.value;
      const origin =
        host.routes.find((entry) => entry.kind === "public")?.url ??
        host.routes.find((entry) => entry.kind === "tailnet")?.url;
      if (!origin || !isDirectoryRouteUrl(origin)) return yield* unavailable();
      return yield* Effect.acquireUseRelease(
        workloads.relay(lease, host.environmentId, envelope.payload),
        (grant) =>
          Effect.gen(function* () {
            const request = HttpClientRequest.post(
              new URL(ACCOUNT_VAULT_RELAY_ROUTE, origin).toString(),
            ).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                route,
                envelope: { payload: envelope.payload, proof: grant },
              }),
            );
            const response = yield* http
              .execute(request)
              .pipe(
                Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
                Effect.timeout("15 seconds"),
                Effect.mapError(unavailable),
              );
            const body = yield* response.json.pipe(
              Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(3)),
              Effect.timeout("15 seconds"),
              Effect.mapError(unavailable),
            );
            if (response.status !== 200)
              return yield* decodeFailure(body).pipe(
                Effect.orElseSucceed(unavailable),
                Effect.flatMap(Effect.fail),
              );
            return Option.some(body);
          }),
        workloads.releaseRelay,
      ).pipe(
        Effect.catchTags({
          VaultError: (error) =>
            route === "status" && error.reason === "unavailable"
              ? Effect.succeedSome({
                  backend: "openbao" as const,
                  state: "unavailable" as const,
                  origin: null,
                  host: { environmentId: host.environmentId, label: host.label },
                })
              : Effect.fail(error),
        }),
      );
    }),
  });
});
export const layer = Layer.effect(AccountVaultRouting, make);
