import {
  ACCOUNT_PROVIDER_CREDENTIAL_ROUTE,
  AccountProviderRequest,
  AccountProviderResponse,
  VaultError,
} from "@t3tools/contracts/fork";
import { signRelayJwt } from "@t3tools/shared/relayJwt";
import * as ByteSize from "effect/ByteSize";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClientRequest, HttpIncomingMessage } from "effect/http";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";

const encode = Schema.encodeEffect(Schema.fromJsonString(AccountProviderRequest));
const decode = Schema.decodeUnknownEffect(AccountProviderResponse);
const decodeError = Schema.decodeUnknownEffect(VaultError);
const unavailable = () => new VaultError({ reason: "unavailable" });
const denied = () => new VaultError({ reason: "denied" });

export class AccountProviderClient extends Context.Service<
  AccountProviderClient,
  {
    readonly available: Effect.Effect<boolean, VaultError>;
    readonly request: (
      input: AccountProviderRequest,
    ) => Effect.Effect<typeof AccountProviderResponse.Type, VaultError>;
  }
>()("t3/fork/vault/AccountProviderClient") {}

const make = Effect.gen(function* () {
  const connection = yield* LibraryConnection.LibraryConnectionService;
  const secrets = yield* ServerSecretStore;
  const identity = yield* ServerEnvironmentIdentity;
  const signature = yield* Signature.Signature;
  const random = yield* SecureRandom.SecureRandom;
  const digest = yield* Digest.Digest;
  return AccountProviderClient.of({
    available: connection.current.pipe(
      Effect.map(
        (current) => current.kind === "remote" && current.credential?.account !== undefined,
      ),
      Effect.mapError(unavailable),
    ),
    request: Effect.fn("AccountProviderClient.request")(function* (input) {
      const current = yield* connection.current.pipe(Effect.mapError(unavailable));
      if (current.kind !== "remote" || !current.credential?.account) return yield* denied();
      const credential = current.credential;
      const account = current.credential.account;
      const sourceId = yield* identity.getEnvironmentId;
      if (credential.sourceEnvironmentId !== sourceId) return yield* denied();
      const payload = yield* encode(input).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      const keys = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets).pipe(
        Effect.provideService(Signature.Signature, signature),
        Effect.mapError(unavailable),
      );
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      const proof = yield* signRelayJwt({
        privateKey: keys.privateKey,
        typ: "loom-account-workload+jwt",
        payload: {
          iss: sourceId,
          sub: sourceId,
          aud: credential.libraryEnvironmentId,
          publisherSessionId: credential.sessionId,
          authorityId: account.authorityId,
          authorityEpoch: account.authorityEpoch,
          nonce: Hex.encode(yield* random.randomBytes(16).pipe(Effect.mapError(unavailable))),
          digest: Hex.encode(
            yield* digest
              .digest(Digest.sha256, new TextEncoder().encode(payload))
              .pipe(Effect.mapError(unavailable)),
          ),
          iat: now,
          exp: now + 30,
        },
      }).pipe(Effect.provideService(Signature.Signature, signature), Effect.mapError(unavailable));
      const request = yield* HttpClientRequest.bodyJson(
        HttpClientRequest.post(ACCOUNT_PROVIDER_CREDENTIAL_ROUTE),
        { payload, proof },
      ).pipe(Effect.mapError(unavailable));
      const response = yield* current
        .send(request)
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.timeout("15 seconds"),
          Effect.mapError(unavailable),
        );
      const body = response.json.pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(96)),
        Effect.timeout("15 seconds"),
        Effect.mapError(unavailable),
      );
      if (response.status !== 200)
        return yield* yield* body.pipe(
          Effect.flatMap(decodeError),
          Effect.orElseSucceed(() =>
            response.status === 401 || response.status === 403 ? denied() : unavailable(),
          ),
        );
      const result = yield* body.pipe(Effect.flatMap(decode), Effect.mapError(unavailable));
      const latest = yield* connection.current.pipe(Effect.mapError(unavailable));
      if (
        latest.kind !== "remote" ||
        latest.origin !== current.origin ||
        latest.credential?.libraryEnvironmentId !== credential.libraryEnvironmentId ||
        latest.credential.account?.authorityId !== account.authorityId ||
        latest.credential.account.authorityEpoch !== account.authorityEpoch
      )
        return yield* denied();
      if ((input.mode === "read") !== (result.value !== null)) return yield* unavailable();
      return result;
    }),
  });
});

export const layer = Layer.effect(AccountProviderClient, make);
