import { ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  VaultWorkloadError,
  VaultWorkloadOpen,
  VaultWorkloadChallengeRequest,
  VaultWorkloadProof,
  type VaultWorkloadSession,
  type VaultWorkloadChallenge,
  vaultWorkloadRequestMessage,
  vaultWorkloadProofMessage,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as VaultBrokers from "./VaultBrokers.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";

type Failure = VaultError | VaultWorkloadError;
export class VaultWorkloads extends Context.Service<
  VaultWorkloads,
  {
    readonly open: (
      input: VaultWorkloadOpen,
      threadId: ThreadId,
    ) => Effect.Effect<VaultWorkloadSession, Failure>;
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<VaultWorkloadSession>, Failure>;
    readonly close: (sessionId: string, threadId: ThreadId) => Effect.Effect<void, Failure>;
    readonly challenge: (
      input: VaultWorkloadChallengeRequest,
    ) => Effect.Effect<VaultWorkloadChallenge, Failure>;
    readonly check: (
      input: VaultWorkloadProof,
    ) => Effect.Effect<
      { session: VaultWorkloadSession; checkedAt: number; credentialDelivery: "unsupported" },
      Failure
    >;
    readonly release: (input: VaultWorkloadProof) => Effect.Effect<{ released: true }, Failure>;
  }
>()("t3/fork/vault/VaultWorkloads") {}
const isOpen = Schema.is(VaultWorkloadOpen),
  isRequest = Schema.is(VaultWorkloadChallengeRequest),
  isProof = Schema.is(VaultWorkloadProof);
const SESSION_MS = 5 * 60_000,
  CHALLENGE_MS = 30_000,
  MAX_SESSIONS = 64,
  MAX_CHALLENGES = 128;
const invalid = () => new VaultWorkloadError({ reason: "invalid-proof" });
const denied = () => new VaultError({ reason: "denied" });
const make = Effect.gen(function* () {
  const brokers = yield* VaultBrokers.VaultBrokers,
    access = yield* VaultAccess.VaultAccess;
  const keys = yield* BrokerCrypto.BrokerCrypto,
    crypto = yield* Crypto.Crypto;
  const identity = yield* ServerEnvironmentIdentity,
    threads = yield* ThreadManagementService;
  const environmentId = yield* identity.getEnvironmentId;
  // Sessions die with this control-plane process. Durable grants never become offline capabilities.
  const sessions = yield* Ref.make<ReadonlyMap<string, VaultWorkloadSession>>(new Map());
  const challenges = yield* Ref.make<
    ReadonlyMap<string, { challenge: VaultWorkloadChallenge; consumed: boolean }>
  >(new Map());
  const id = crypto.randomUUIDv4().pipe(
    Effect.map((value) => value.replaceAll("-", "")),
    Effect.mapError(() => new VaultWorkloadError({ reason: "unavailable" })),
  );
  const live = Effect.fnUntraced(function* (threadId: ThreadId) {
    const thread = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(denied));
    if (
      !thread ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      thread.activeRunId === null ||
      thread.status !== "running" ||
      thread.runtimeMode !== "full-access" ||
      thread.interactionMode !== "default"
    )
      return yield* denied();
    return thread;
  });
  const host = Effect.fnUntraced(function* (machineId: string, requireOnline = true) {
    const snapshot = yield* brokers.snapshot.pipe(
      Effect.mapError(() => new VaultWorkloadError({ reason: "unavailable" })),
    );
    if (snapshot.environmentId !== environmentId) return yield* invalid();
    const machine = snapshot.machines.find((value) => value.id === machineId);
    if (!machine || machine.state !== "active") return yield* denied();
    if (requireOnline && machine.leaseUntil <= (yield* Clock.currentTimeMillis))
      return yield* new VaultWorkloadError({ reason: "host-offline" });
    return machine;
  });
  const find = Effect.fnUntraced(function* (sessionId: string) {
    const session = (yield* Ref.get(sessions)).get(sessionId);
    if (!session) return yield* invalid();
    if (session.expiresAt <= (yield* Clock.currentTimeMillis))
      return yield* new VaultWorkloadError({ reason: "expired" });
    return session;
  });
  const authorize = Effect.fnUntraced(function* (session: VaultWorkloadSession) {
    const thread = yield* live(session.threadId);
    if (
      thread.activeRunId !== session.runId ||
      thread.projectId !== session.projectId ||
      thread.providerInstanceId !== session.providerInstanceId
    )
      return yield* denied();
    const machine = yield* host(session.machineId);
    yield* access.require(session.threadId, session.itemId, "use", session.destination);
    return machine;
  });
  const verify = Effect.fnUntraced(function* (
    machineKey: string,
    workloadKey: string,
    message: string,
    input: { machineSignature: string; workloadSignature: string },
  ) {
    const machine = yield* keys
      .verify(machineKey, message, input.machineSignature)
      .pipe(Effect.mapError(invalid));
    const workload = yield* keys
      .verify(workloadKey, message, input.workloadSignature)
      .pipe(Effect.mapError(invalid));
    if (!machine || !workload) return yield* invalid();
  });
  const consume = Effect.fnUntraced(function* (
    input: VaultWorkloadProof,
    operation: "check" | "release",
  ) {
    if (
      !isProof(input) ||
      input.challenge.environmentId !== environmentId ||
      input.challenge.operation !== operation
    )
      return yield* invalid();
    const now = yield* Clock.currentTimeMillis;
    if (input.challenge.expiresAt <= now)
      return yield* new VaultWorkloadError({ reason: "expired" });
    const session = yield* find(input.challenge.sessionId);
    if (session.machineId !== input.challenge.machineId) return yield* invalid();
    const machine = yield* host(session.machineId, operation !== "release");
    yield* verify(
      machine.publicKey,
      session.publicKey,
      vaultWorkloadProofMessage(input.challenge),
      input,
    );
    const accepted = yield* Ref.modify(challenges, (current) => {
      const held = current.get(input.challenge.nonce);
      if (
        !held ||
        held.consumed ||
        vaultWorkloadProofMessage(held.challenge) !== vaultWorkloadProofMessage(input.challenge)
      )
        return [false, current] as const;
      const next = new Map(current);
      next.set(input.challenge.nonce, { ...held, consumed: true });
      return [true, next] as const;
    });
    if (!accepted) return yield* invalid();
    return session;
  });
  return VaultWorkloads.of({
    open: Effect.fn("VaultWorkloads.open")(function* (input, threadId) {
      if (!isOpen(input)) return yield* invalid();
      yield* keys.fingerprint(input.publicKey).pipe(Effect.mapError(invalid));
      const thread = yield* live(threadId),
        machine = yield* host(input.machineId);
      if (input.publicKey === machine.publicKey) return yield* invalid();
      yield* access.require(threadId, input.itemId, "use", input.destination);
      const now = yield* Clock.currentTimeMillis;
      const session: VaultWorkloadSession = {
        protocol: 1,
        id: yield* id,
        environmentId,
        machineId: input.machineId,
        threadId,
        projectId: thread.projectId,
        runId: thread.activeRunId!,
        providerInstanceId: thread.providerInstanceId,
        itemId: input.itemId,
        destination: input.destination,
        publicKey: input.publicKey,
        expiresAt: now + SESSION_MS,
      };
      const accepted = yield* Ref.modify(sessions, (current) => {
        const next = new Map([...current].filter(([, value]) => value.expiresAt > now));
        if (
          next.size >= MAX_SESSIONS ||
          [...next.values()].filter((value) => value.threadId === threadId).length >= 8
        )
          return [false, next] as const;
        next.set(session.id, session);
        return [true, next] as const;
      });
      if (!accepted) return yield* new VaultWorkloadError({ reason: "capacity" });
      return session;
    }),
    list: Effect.fn("VaultWorkloads.list")(function* (threadId) {
      const thread = yield* live(threadId),
        now = yield* Clock.currentTimeMillis;
      return [...(yield* Ref.get(sessions)).values()].filter(
        (session) =>
          session.threadId === threadId &&
          session.runId === thread.activeRunId &&
          session.expiresAt > now,
      );
    }),
    close: Effect.fn("VaultWorkloads.close")(function* (sessionId, threadId) {
      const session = (yield* Ref.get(sessions)).get(sessionId);
      if (!session) return;
      if (session.threadId !== threadId) return yield* denied();
      yield* Ref.update(sessions, (current) => {
        const next = new Map(current);
        next.delete(sessionId);
        return next;
      });
    }),
    challenge: Effect.fn("VaultWorkloads.challenge")(function* (input) {
      if (
        !isRequest(input) ||
        input.environmentId !== environmentId ||
        Math.abs((yield* Clock.currentTimeMillis) - input.at) > 30_000
      )
        return yield* invalid();
      const session = yield* find(input.sessionId),
        machine = yield* host(session.machineId, input.operation !== "release");
      yield* verify(
        machine.publicKey,
        session.publicKey,
        vaultWorkloadRequestMessage(input),
        input,
      );
      if (input.operation === "check") yield* authorize(session);
      const now = yield* Clock.currentTimeMillis;
      const challenge: VaultWorkloadChallenge = {
        protocol: 1,
        environmentId,
        machineId: session.machineId,
        sessionId: session.id,
        requestId: input.requestId,
        operation: input.operation,
        nonce: (yield* id) + (yield* id),
        expiresAt: Math.min(session.expiresAt, now + CHALLENGE_MS),
      };
      const accepted = yield* Ref.modify(challenges, (current) => {
        const next = new Map([...current].filter(([, value]) => value.challenge.expiresAt > now));
        const existing = [...next.values()].find(
          (value) =>
            value.challenge.sessionId === session.id &&
            value.challenge.requestId === input.requestId,
        );
        if (existing)
          return [
            existing.challenge.operation === input.operation ? existing.challenge : null,
            next,
          ] as const;
        if (
          next.size >= MAX_CHALLENGES ||
          [...next.values()].filter((value) => value.challenge.sessionId === session.id).length >= 4
        )
          return [null, next] as const;
        next.set(challenge.nonce, { challenge, consumed: false });
        return [challenge, next] as const;
      });
      if (!accepted) return yield* new VaultWorkloadError({ reason: "capacity" });
      return accepted;
    }),
    check: Effect.fn("VaultWorkloads.check")(function* (input) {
      const session = yield* consume(input, "check");
      // Revocation, runtime mode and the active run can change after challenge issuance.
      yield* authorize(session);
      if (!(yield* Ref.get(sessions)).has(session.id)) return yield* invalid();
      return {
        session,
        checkedAt: yield* Clock.currentTimeMillis,
        credentialDelivery: "unsupported" as const,
      };
    }),
    release: Effect.fn("VaultWorkloads.release")(function* (input) {
      const session = yield* consume(input, "release");
      yield* Ref.update(sessions, (current) => {
        const next = new Map(current);
        next.delete(session.id);
        return next;
      });
      return { released: true as const };
    }),
  });
});
export const layer = Layer.effect(VaultWorkloads, make);
