import { newerVaultRun, vaultRun } from "./VaultActiveRun.testkit.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { RunId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import {
  vaultWorkloadRequestMessage,
  vaultWorkloadProofMessage,
  type VaultWorkloadSession,
  type VaultWorkloadChallengeRequest,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Clock from "effect/Clock";
import * as TestClock from "effect/testing/TestClock";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";
import { workloadFixture } from "./VaultWorkloads.testkit.ts";
const test = <A, E, R>(
  use: (
    fixture: Effect.Success<typeof workloadFixture>,
    service: VaultWorkloads.VaultWorkloads["Service"],
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const f = yield* workloadFixture;
    return yield* Effect.flatMap(VaultWorkloads.VaultWorkloads, (service) => use(f, service)).pipe(
      Effect.provide(f.layer),
    );
  }).pipe(Effect.provide(Layer.merge(BrokerCrypto.layer, NodeServices.layer)));
let ordinal = 0;
const request = Effect.fnUntraced(function* (
  f: Effect.Success<typeof workloadFixture>,
  session: VaultWorkloadSession,
  operation: "check" | "release" = "check",
) {
  const input = {
    environmentId: f.environmentId,
    sessionId: session.id,
    requestId: (++ordinal).toString(16).padStart(32, "0"),
    operation,
    at: yield* Clock.currentTimeMillis,
  };
  return {
    ...input,
    machineSignature: yield* f.keys.sign(f.machine.privateKey, vaultWorkloadRequestMessage(input)),
    workloadSignature: yield* f.keys.sign(
      f.workload.privateKey,
      vaultWorkloadRequestMessage(input),
    ),
  } satisfies VaultWorkloadChallengeRequest;
});
const prove = Effect.fnUntraced(function* (
  f: Effect.Success<typeof workloadFixture>,
  service: VaultWorkloads.VaultWorkloads["Service"],
  session: VaultWorkloadSession,
  operation: "check" | "release" = "check",
) {
  const challenge = yield* service.challenge(yield* request(f, session, operation));
  return {
    challenge,
    machineSignature: yield* f.keys.sign(
      f.machine.privateKey,
      vaultWorkloadProofMessage(challenge),
    ),
    workloadSignature: yield* f.keys.sign(
      f.workload.privateKey,
      vaultWorkloadProofMessage(challenge),
    ),
  };
});
it.effect(
  "binds a session to the authenticated run, exact item and destination and rechecks use grants",
  () =>
    test((f, service) =>
      Effect.gen(function* () {
        const session = yield* service.open(f.input, f.threadId);
        expect(session.threadId).toBe(f.threadId);
        expect(session.runId).toBe(f.state.thread.activeRunId);
        expect(f.state.decisions[0]).toEqual({
          threadId: f.threadId,
          itemId: f.input.itemId,
          action: "use",
          destination: f.input.destination,
        });
        const proof = yield* prove(f, service, session);
        expect((yield* service.check(proof)).credentialDelivery).toBe("unsupported");
        expect(f.state.decisions).toHaveLength(3);
        expect((yield* service.check(proof).pipe(Effect.flip)).reason).toBe("invalid-proof");
        f.state.allow = false;
        expect((yield* service.open(f.input, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
      }),
    ),
);
it.effect(
  "requires both keys and binds proofs to their environment, operation and exact challenge",
  () =>
    test((f, service) =>
      Effect.gen(function* () {
        const session = yield* service.open(f.input, f.threadId),
          input = yield* request(f, session);
        const stranger = yield* f.keys.create;
        expect(
          (yield* service
            .challenge({
              ...input,
              workloadSignature: yield* f.keys.sign(
                stranger.privateKey,
                vaultWorkloadRequestMessage(input),
              ),
            })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-proof");
        const proof = yield* prove(f, service, session);
        expect((yield* service.release(proof).pipe(Effect.flip)).reason).toBe("invalid-proof");
        expect(
          (yield* service
            .check({ ...proof, challenge: { ...proof.challenge, requestId: "f".repeat(32) } })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-proof");
        expect(
          (yield* service
            .check({ ...proof, workloadSignature: proof.machineSignature })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-proof");
        yield* service.check(proof);
      }),
    ),
);
it.effect(
  "rejects revocation, runtime reductions, replaced runs and disabled hosts after challenge issuance",
  () =>
    test((f, service) =>
      Effect.gen(function* () {
        const session = yield* service.open(f.input, f.threadId);
        let proof = yield* prove(f, service, session);
        f.state.allow = false;
        expect((yield* service.check(proof).pipe(Effect.flip)).reason).toBe("denied");
        f.state.allow = true;
        proof = yield* prove(f, service, session);
        f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
        expect((yield* service.check(proof).pipe(Effect.flip)).reason).toBe("denied");
        f.state.thread = { ...f.state.thread, runtimeMode: "full-access" };
        proof = yield* prove(f, service, session);
        f.state.thread = { ...f.state.thread, activeRunId: RunId.make("replacement") };
        expect((yield* service.check(proof).pipe(Effect.flip)).reason).toBe("denied");
        f.state.thread = { ...f.state.thread, activeRunId: session.runId };
        proof = yield* prove(f, service, session);
        f.state.hostActive = false;
        expect((yield* service.check(proof).pipe(Effect.flip)).reason).toBe("denied");
      }),
    ),
);
it.effect(
  "allows cleanup after grant revocation and offline heartbeat, and refuses another thread's close",
  () =>
    test((f, service) =>
      Effect.gen(function* () {
        const session = yield* service.open(f.input, f.threadId);
        expect(
          (yield* service.close(session.id, ThreadId.make("other")).pipe(Effect.flip)).reason,
        ).toBe("denied");
        f.state.allow = false;
        f.state.leaseUntil = 0;
        expect(yield* service.release(yield* prove(f, service, session, "release"))).toEqual({
          released: true,
        });
        expect(yield* service.list(f.threadId)).toEqual([]);
        yield* service.close(session.id, f.threadId);
      }),
    ),
);
it.effect(
  "expires sessions/challenges, bounds issuance and loses authorization on control-plane reconstruction",
  () =>
    test((f, service) =>
      Effect.gen(function* () {
        const session = yield* service.open(f.input, f.threadId),
          proof = yield* prove(f, service, session);
        yield* TestClock.adjust("31 seconds");
        expect((yield* service.check(proof).pipe(Effect.flip)).reason).toBe("expired");
        for (let n = 0; n < 7; n++) yield* service.open(f.input, f.threadId);
        expect((yield* service.open(f.input, f.threadId).pipe(Effect.flip)).reason).toBe(
          "capacity",
        );
        const fresh = yield* VaultWorkloads.VaultWorkloads.pipe(
          Effect.provide(Layer.fresh(f.layer)),
        );
        expect((yield* fresh.challenge(yield* request(f, session)).pipe(Effect.flip)).reason).toBe(
          "invalid-proof",
        );
        yield* TestClock.adjust("5 minutes");
        expect(
          (yield* service.challenge(yield* request(f, session)).pipe(Effect.flip)).reason,
        ).toBe("expired");
        expect(
          (yield* service
            .open({ ...f.input, publicKey: f.machine.publicKey }, f.threadId)
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-proof");
      }),
    ),
);
it.effect(
  "terminal readiness identifies this provider/run without claiming account-use readiness",
  () =>
    test((f, service) =>
      Effect.gen(function* () {
        const result = yield* service.terminalReadiness(
          f.threadId,
          f.state.thread.providerInstanceId!,
        );
        expect(result.activeRun).toBe(true);
        expect(result.runId).toBe(f.state.thread.activeRunId);
        expect(result.credentialUse).toBe("requires-selection-and-current-grant");
        expect(result.expiresAt - result.checkedAt).toBe(60_000);
        expect(f.state.decisions).toHaveLength(0);
        expect(
          (yield* service
            .terminalReadiness(f.threadId, ProviderInstanceId.make("other"))
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        f.state.thread = { ...f.state.thread, activeRunId: null };
        expect(
          (yield* service.terminalReadiness(f.threadId, f.state.thread.providerInstanceId!))
            .activeRun,
        ).toBe(false);
      }),
    ),
);

it.effect.each(["cancelled", "completed"] as const)(
  "keeps workload readiness and issuance on the active run after a newer %s turn",
  (status) =>
    test((f, service) =>
      Effect.gen(function* () {
        newerVaultRun(f.state, status);
        expect(f.state.thread.status).toBe(status);
        expect(
          (yield* service.terminalReadiness(f.threadId, f.state.thread.providerInstanceId!))
            .activeRun,
        ).toBe(true);
        expect((yield* service.open(f.input, f.threadId)).runId).toBe(f.state.thread.activeRunId);
      }),
    ),
);

it.effect("keeps a queued root run's workload live and refuses it when root ownership ends", () =>
  test((f, service) =>
    Effect.gen(function* () {
      const session = yield* service.open(f.input, f.threadId);
      f.state.runs.push(vaultRun(f.state.thread));
      f.state.thread = { ...f.state.thread, status: "queued" };
      expect(
        (yield* service.terminalReadiness(f.threadId, f.state.thread.providerInstanceId!))
          .activeRun,
      ).toBe(true);
      expect((yield* service.check(yield* prove(f, service, session))).session.runId).toBe(
        session.runId,
      );
      const queuedSession = yield* service.open(f.input, f.threadId);
      expect(queuedSession.runId).toBe(session.runId);
      f.state.thread = { ...f.state.thread, status: "waiting", activeRunId: null };
      expect(
        (yield* service.terminalReadiness(f.threadId, f.state.thread.providerInstanceId!))
          .activeRun,
      ).toBe(false);
      expect((yield* service.open(f.input, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
    }),
  ),
);
