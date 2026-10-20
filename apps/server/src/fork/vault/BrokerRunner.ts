import * as BrokerHttpClient from "./BrokerHttpClient.ts";
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
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
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
const decodeUnknownEffectInvitation = Schema.decodeUnknownEffect(VaultBrokerInvitation);
const make = Effect.gen(function* () {
  const identity = yield* BrokerIdentity.BrokerIdentity,
    keys = yield* BrokerCrypto.BrokerCrypto,
    crypto = yield* Crypto.Crypto,
    client = yield* BrokerHttpClient.BrokerHttpClient;
  const request = <A, I>(
    origin: string,
    operation: "claim" | "challenge" | "heartbeat",
    input: unknown,
    schema: Schema.Codec<A, I>,
  ) =>
    client.post(origin, operation, input, schema).pipe(
      Effect.catchTags({
        VaultSshError: () => Effect.fail(new VaultBrokerError({ reason: "invalid-proof" })),
        VaultWorkloadError: () => Effect.fail(new VaultBrokerError({ reason: "invalid-proof" })),
      }),
    );
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
      const origin = BrokerHttpClient.brokerOrigin(server);
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
      const key = yield* identity.read(directory, false),
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
