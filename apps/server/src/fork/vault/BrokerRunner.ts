import {
  VaultError,
  VaultBrokerError,
  VaultBrokerInvitation,
  VaultBrokerClaimResult,
  VaultBrokerHeartbeatChallenge,
  VaultBrokerHeartbeatResult,
  vaultBrokerClaimMessage,
  vaultBrokerChallengeMessage,
  vaultBrokerHeartbeatMessage,
} from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";

type Failure = VaultError | VaultBrokerError;
export class BrokerRunner extends Context.Service<
  BrokerRunner,
  {
    readonly identity: (
      directory: string,
    ) => Effect.Effect<
      { publicKey: string; fingerprint: string; platform: "darwin" | "linux"; directory: string },
      VaultBrokerError
    >;
    readonly enroll: (
      directory: string,
      origin: string,
      invitationFile: string,
    ) => Effect.Effect<{ machineId: string; state: "awaiting-approval" }, Failure>;
    readonly check: (
      directory: string,
    ) => Effect.Effect<typeof VaultBrokerHeartbeatResult.Type, Failure>;
  }
>()("t3/fork/vault/BrokerRunner") {}
const encodeEffectUnknownJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeUnknownOptionVaultFailure = Schema.decodeUnknownOption(
  Schema.Struct({ reason: VaultError.fields.reason }),
);
const decodeUnknownEffectInvitation = Schema.decodeUnknownEffect(VaultBrokerInvitation);
const decodeUnknownOptionBrokerFailure = Schema.decodeUnknownOption(
  Schema.Struct({ reason: VaultBrokerError.fields.reason }),
);
const validOrigin = (input: string) => {
  try {
    const url = new URL(input),
      loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (url.protocol === "https:" || (url.protocol === "http:" && loopback))
      ? url.origin
      : null;
  } catch {
    return null;
  }
};
const make = Effect.gen(function* () {
  const identity = yield* BrokerIdentity.BrokerIdentity,
    keys = yield* BrokerCrypto.BrokerCrypto,
    http = yield* HttpClient.HttpClient,
    crypto = yield* Crypto.Crypto;
  const request = Effect.fnUntraced(function* <A, I>(
    origin: string,
    operation: "claim" | "challenge" | "heartbeat",
    input: unknown,
    schema: Schema.Codec<A, I>,
  ) {
    if (!validOrigin(origin)) return yield* new VaultBrokerError({ reason: "configuration" });
    const body = yield* encodeEffectUnknownJson(input).pipe(
      Effect.mapError(() => new VaultBrokerError({ reason: "configuration" })),
    );
    const response = yield* http
      .execute(
        HttpClientRequest.post(`${origin}/api/loom/vault-brokers/${operation}`).pipe(
          HttpClientRequest.bodyText(body, "application/json"),
        ),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.timeout("15 seconds"),
        Effect.mapError(() => new VaultBrokerError({ reason: "unavailable" })),
      );
    const value = yield* response.json.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(16)),
      Effect.timeout("15 seconds"),
      Effect.mapError(() => new VaultBrokerError({ reason: "unavailable" })),
    );
    if (response.status !== 200) {
      const broker = decodeUnknownOptionBrokerFailure(value);
      if (Option.isSome(broker)) return yield* new VaultBrokerError(broker.value);
      const vault = decodeUnknownOptionVaultFailure(value);
      if (Option.isSome(vault)) return yield* new VaultError(vault.value);
      return yield* new VaultBrokerError({ reason: "unavailable" });
    }
    return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(() => new VaultBrokerError({ reason: "invalid-proof" })),
    );
  });
  return BrokerRunner.of({
    identity: Effect.fn("BrokerRunner.identity")(function* (directory) {
      const key = yield* identity.read(directory);
      return {
        publicKey: key.publicKey,
        fingerprint: key.fingerprint,
        platform: key.platform,
        directory: key.directory,
      };
    }),
    enroll: Effect.fn("BrokerRunner.enroll")(function* (directory, server, invitationFile) {
      const origin = validOrigin(server);
      if (!origin) return yield* new VaultBrokerError({ reason: "configuration" });
      const key = yield* identity.read(directory);
      const invite = yield* decodeUnknownEffectInvitation(
        yield* identity.invitation(invitationFile),
      ).pipe(Effect.mapError(() => new VaultBrokerError({ reason: "invalid-proof" })));
      if (invite.fingerprint !== key.fingerprint)
        return yield* new VaultBrokerError({ reason: "invalid-proof" });
      if (invite.expiresAt <= (yield* Clock.currentTimeMillis))
        return yield* new VaultBrokerError({ reason: "expired" });
      const connection = {
        protocol: 1 as const,
        origin,
        environmentId: invite.environmentId,
        machineId: key.fingerprint.slice(0, 32),
      };
      yield* identity.connect(directory, connection);
      const result = yield* request(
        origin,
        "claim",
        {
          invitation: invite,
          signature: yield* keys.sign(key.privateKey, vaultBrokerClaimMessage(invite)),
        },
        VaultBrokerClaimResult,
      );
      if (result.machineId !== connection.machineId)
        return yield* new VaultBrokerError({ reason: "invalid-proof" });
      return result;
    }),
    check: Effect.fn("BrokerRunner.check")(function* (directory) {
      const key = yield* identity.read(directory),
        connection = yield* identity.connection(directory);
      if (connection.machineId !== key.fingerprint.slice(0, 32))
        return yield* new VaultBrokerError({ reason: "invalid-proof" });
      const input = {
        environmentId: connection.environmentId,
        machineId: connection.machineId,
        requestId: (yield* crypto
          .randomUUIDv4()
          .pipe(Effect.mapError(() => new VaultBrokerError({ reason: "unavailable" })))).replaceAll(
          "-",
          "",
        ),
        at: yield* Clock.currentTimeMillis,
      };
      const challenge = yield* request(
        connection.origin,
        "challenge",
        {
          ...input,
          signature: yield* keys.sign(key.privateKey, vaultBrokerChallengeMessage(input)),
        },
        VaultBrokerHeartbeatChallenge,
      );
      if (
        challenge.environmentId !== connection.environmentId ||
        challenge.machineId !== connection.machineId ||
        challenge.requestId !== input.requestId ||
        challenge.operation !== "heartbeat"
      )
        return yield* new VaultBrokerError({ reason: "invalid-proof" });
      const result = yield* request(
        connection.origin,
        "heartbeat",
        {
          challenge,
          signature: yield* keys.sign(key.privateKey, vaultBrokerHeartbeatMessage(challenge)),
        },
        VaultBrokerHeartbeatResult,
      );
      if (
        result.environmentId !== connection.environmentId ||
        result.machineId !== connection.machineId
      )
        return yield* new VaultBrokerError({ reason: "invalid-proof" });
      return result;
    }),
  });
});
export const layer = Layer.effect(BrokerRunner, make);
