import {
  VaultError,
  VaultSshError,
  VaultSshCommand,
  VaultSshResult,
  vaultSshCommandMessage,
  VaultBrokerError,
  VaultWorkloadError,
  VaultWorkloadSession,
  VaultWorkloadChallenge,
  VaultWorkloadCheck,
  VaultWorkloadRelease,
  vaultWorkloadRequestMessage,
  vaultWorkloadProofMessage,
} from "@t3tools/contracts/fork";
import * as Hex from "effect/encoding/Hex";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as BrokerHttpClient from "./BrokerHttpClient.ts";

type Failure = VaultError | VaultBrokerError | VaultWorkloadError | VaultSshError;
export class WorkloadRunner extends Context.Service<
  WorkloadRunner,
  {
    readonly ssh: (
      machineDirectory: string,
      workloadDirectory: string,
      sessionFile: string,
      commandFile: string,
    ) => Effect.Effect<VaultSshResult, Failure>;
    readonly check: (
      machineDirectory: string,
      workloadDirectory: string,
      sessionFile: string,
    ) => Effect.Effect<typeof VaultWorkloadCheck.Type, Failure>;
    readonly release: (
      machineDirectory: string,
      workloadDirectory: string,
      sessionFile: string,
    ) => Effect.Effect<typeof VaultWorkloadRelease.Type, Failure>;
  }
>()("t3/fork/vault/WorkloadRunner") {}
const decodeSession = Schema.decodeUnknownEffect(VaultWorkloadSession);
const decodeSshCommand = Schema.decodeUnknownEffect(VaultSshCommand);
const encodeSession = Schema.encodeEffect(Schema.fromJsonString(VaultWorkloadSession));
const invalid = () => new VaultWorkloadError({ reason: "invalid-proof" });
const make = Effect.gen(function* () {
  const identities = yield* BrokerIdentity.BrokerIdentity,
    keys = yield* BrokerCrypto.BrokerCrypto;
  const http = yield* BrokerHttpClient.BrokerHttpClient,
    crypto = yield* Crypto.Crypto;
  const proof = Effect.fnUntraced(function* (
    machineDirectory: string,
    workloadDirectory: string,
    sessionFile: string,
    operation: "check" | "release" | "ssh-exec",
    payloadDigest?: string,
  ) {
    const machine = yield* identities.read(machineDirectory),
      workload = yield* identities.read(workloadDirectory);
    const connection = yield* identities.connection(machineDirectory);
    const session = yield* decodeSession(yield* identities.invitation(sessionFile)).pipe(
      Effect.mapError(invalid),
    );
    if (
      session.environmentId !== connection.environmentId ||
      session.machineId !== connection.machineId ||
      session.machineId !== machine.fingerprint.slice(0, 32) ||
      session.publicKey !== workload.publicKey ||
      machine.publicKey === workload.publicKey
    )
      return yield* invalid();
    if (session.expiresAt <= (yield* Clock.currentTimeMillis))
      return yield* new VaultWorkloadError({ reason: "expired" });
    const input = {
      environmentId: session.environmentId,
      sessionId: session.id,
      requestId: (yield* crypto
        .randomUUIDv4()
        .pipe(Effect.mapError(() => new VaultWorkloadError({ reason: "unavailable" })))).replaceAll(
        "-",
        "",
      ),
      at: yield* Clock.currentTimeMillis,
      operation,
      ...(payloadDigest ? { payloadDigest } : {}),
    };
    const challenge = yield* http.post(
      connection.origin,
      "workloads/challenge",
      {
        ...input,
        machineSignature: yield* keys.sign(machine.privateKey, vaultWorkloadRequestMessage(input)),
        workloadSignature: yield* keys.sign(
          workload.privateKey,
          vaultWorkloadRequestMessage(input),
        ),
      },
      VaultWorkloadChallenge,
    );
    if (
      challenge.environmentId !== session.environmentId ||
      challenge.machineId !== session.machineId ||
      challenge.sessionId !== session.id ||
      challenge.requestId !== input.requestId ||
      challenge.operation !== operation ||
      challenge.payloadDigest !== payloadDigest
    )
      return yield* invalid();
    const body = {
      challenge,
      machineSignature: yield* keys.sign(machine.privateKey, vaultWorkloadProofMessage(challenge)),
      workloadSignature: yield* keys.sign(
        workload.privateKey,
        vaultWorkloadProofMessage(challenge),
      ),
    };
    return { connection, session, body };
  });
  return WorkloadRunner.of({
    ssh: Effect.fn("WorkloadRunner.ssh")(
      function* (machineDirectory, workloadDirectory, sessionFile, commandFile) {
        const command = yield* decodeSshCommand(yield* identities.invitation(commandFile)).pipe(
          Effect.mapError(() => new VaultSshError({ reason: "invalid-operation" })),
        );
        const digest = yield* crypto
          .digest("SHA-256", new TextEncoder().encode(vaultSshCommandMessage(command)))
          .pipe(
            Effect.map(Hex.encode),
            Effect.mapError(() => new VaultSshError({ reason: "failed" })),
          );
        const request = yield* proof(
          machineDirectory,
          workloadDirectory,
          sessionFile,
          "ssh-exec",
          digest,
        );
        const result = yield* http.post(
          request.connection.origin,
          "workloads/ssh-exec",
          { proof: request.body, command },
          VaultSshResult,
        );
        if (
          result.sessionId !== request.session.id ||
          result.requestId !== request.body.challenge.requestId
        )
          return yield* invalid();
        return result;
      },
    ),
    check: Effect.fn("WorkloadRunner.check")(
      function* (machineDirectory, workloadDirectory, sessionFile) {
        const request = yield* proof(machineDirectory, workloadDirectory, sessionFile, "check");
        const result = yield* http.post(
          request.connection.origin,
          "workloads/check",
          request.body,
          VaultWorkloadCheck,
        );
        if (
          (yield* encodeSession(result.session).pipe(Effect.mapError(invalid))) !==
          (yield* encodeSession(request.session).pipe(Effect.mapError(invalid)))
        )
          return yield* invalid();
        return result;
      },
    ),
    release: Effect.fn("WorkloadRunner.release")(
      function* (machineDirectory, workloadDirectory, sessionFile) {
        const request = yield* proof(machineDirectory, workloadDirectory, sessionFile, "release");
        return yield* http.post(
          request.connection.origin,
          "workloads/release",
          request.body,
          VaultWorkloadRelease,
        );
      },
    ),
  });
});
export const layer = Layer.effect(WorkloadRunner, make);
