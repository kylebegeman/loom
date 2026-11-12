import type { ThreadId } from "@t3tools/contracts";
import {
  ACCOUNT_VAULT_ROUTE,
  AccountVaultRequest,
  AccountVaultResponse,
  AccountVaultFailure,
  VaultError,
  type VaultSshError,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClientRequest, HttpIncomingMessage } from "effect/http";
import * as AccountWorkloads from "../account-access/AccountWorkloads.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";

const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(AccountVaultRequest));
const decodeResponse = Schema.decodeUnknownEffect(AccountVaultResponse);
const decodeFailure = Schema.decodeUnknownEffect(AccountVaultFailure);
const unavailable = () => new VaultError({ reason: "unavailable" });
export class AccountVaultClient extends Context.Service<
  AccountVaultClient,
  {
    readonly available: Effect.Effect<boolean, VaultError>;
    readonly execute: (
      request: AccountVaultRequest,
      threadId: ThreadId,
    ) => Effect.Effect<AccountVaultResponse, VaultError | VaultSshError>;
  }
>()("t3/fork/vault/AccountVaultClient") {}
const make = Effect.gen(function* () {
  const connection = yield* LibraryConnection.LibraryConnectionService;
  const workloads = yield* AccountWorkloads.AccountWorkloads;
  return AccountVaultClient.of({
    available: connection.current.pipe(
      Effect.map(
        (current) => current.kind === "remote" && current.credential?.account !== undefined,
      ),
      Effect.mapError(unavailable),
    ),
    execute: Effect.fn("AccountVaultClient.execute")(function* (request, threadId) {
      const current = yield* connection.current.pipe(Effect.mapError(unavailable));
      if (current.kind !== "remote" || current.credential?.account === undefined)
        return yield* new VaultError({ reason: "denied" });
      const payload = yield* encodeRequest(request).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      const proof = yield* workloads.prepare(payload, threadId);
      const latest = yield* connection.current.pipe(Effect.mapError(unavailable));
      if (
        latest.kind !== "remote" ||
        latest.origin !== current.origin ||
        latest.credential?.libraryEnvironmentId !== current.credential.libraryEnvironmentId ||
        latest.credential.account?.authorityId !== current.credential.account.authorityId ||
        latest.credential.account.authorityEpoch !== current.credential.account.authorityEpoch
      )
        return yield* new VaultError({ reason: "denied" });
      const httpRequest = yield* HttpClientRequest.bodyJson(
        HttpClientRequest.post(ACCOUNT_VAULT_ROUTE),
        { payload, proof },
      ).pipe(Effect.mapError(unavailable));
      const response = yield* latest
        .send(httpRequest)
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.timeout("15 seconds"),
          Effect.mapError(unavailable),
        );
      const body = response.json.pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(96)),
        Effect.timeout("15 seconds"),
      );
      if (response.status !== 200) {
        const error = yield* body.pipe(
          Effect.flatMap(decodeFailure),
          Effect.orElseSucceed(() =>
            response.status === 401 || response.status === 403
              ? new VaultError({ reason: "denied" })
              : unavailable(),
          ),
        );
        return yield* error;
      }
      const decoded = yield* body.pipe(
        Effect.flatMap(decodeResponse),
        Effect.mapError(unavailable),
      );
      if (decoded.kind !== request.kind) return yield* unavailable();
      return decoded;
    }),
  });
});
export const layer = Layer.effect(AccountVaultClient, make);
