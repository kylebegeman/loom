import { brokerFixture } from "./VaultBrokers.testkit.ts";
import { expect, it } from "@effect/vitest";
import {
  VaultError,
  vaultBrokerClaimMessage,
  vaultBrokerHeartbeatMessage,
  vaultBrokerChallengeMessage,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as VaultBrokers from "./VaultBrokers.ts";

const run = <A, E, R>(
  use: (context: {
    service: VaultBrokers.VaultBrokers["Service"];
    crypto: BrokerCrypto.BrokerCrypto["Service"];
    fixture: ReturnType<typeof brokerFixture>;
  }) => Effect.Effect<A, E, R>,
) => {
  const f = brokerFixture();
  return Effect.gen(function* () {
    return yield* use({
      service: yield* VaultBrokers.VaultBrokers,
      crypto: yield* BrokerCrypto.BrokerCrypto,
      fixture: f,
    });
  }).pipe(Effect.provide(f.layer));
};
const challengeFor = Effect.fnUntraced(function* (
  service: VaultBrokers.VaultBrokers["Service"],
  keys: BrokerCrypto.BrokerCrypto["Service"],
  key: Effect.Success<typeof keys.create>,
  machineId: string,
) {
  const crypto = yield* Crypto.Crypto;
  const input = {
    environmentId: "broker-test",
    machineId,
    requestId: (yield* crypto.randomUUIDv4()).replaceAll("-", ""),
    at: yield* Clock.currentTimeMillis,
  };
  return yield* service.challenge({
    ...input,
    signature: yield* keys.sign(key.privateKey, vaultBrokerChallengeMessage(input)),
  });
});
const enroll = Effect.fnUntraced(function* (
  service: VaultBrokers.VaultBrokers["Service"],
  crypto: BrokerCrypto.BrokerCrypto["Service"],
) {
  const key = yield* crypto.create;
  const input = {
    operationId: "a".repeat(32),
    expectedRevision: 0,
    publicKey: key.publicKey,
    label: "Headless test host",
    platform: "linux" as const,
  };
  const invite = yield* service.begin(input, "admin");
  const signature = yield* crypto.sign(key.privateKey, vaultBrokerClaimMessage(invite));
  const claim = yield* service.claim({ invitation: invite, signature });
  const approved = yield* service.apply(
    {
      operationId: "b".repeat(32),
      expectedRevision: 2,
      change: { type: "approve", enrollmentId: invite.enrollmentId, fingerprint: key.fingerprint },
    },
    "admin",
  );
  return { key, input, invite, claim, approved };
});
it.effect(
  "enrolls only the bound key, requires reviewed approval and never exposes private identity in metadata",
  () =>
    run(({ service, crypto }) =>
      Effect.gen(function* () {
        const key = yield* crypto.create,
          intruder = yield* crypto.create;
        const input = {
          operationId: "a".repeat(32),
          expectedRevision: 0,
          publicKey: key.publicKey,
          label: "Runner",
          platform: "darwin" as const,
        };
        const invite = yield* service.begin(input, "admin");
        expect(yield* service.begin(input, "admin")).toEqual(invite);
        const copied = yield* crypto.sign(intruder.privateKey, vaultBrokerClaimMessage(invite));
        expect(
          (yield* service.claim({ invitation: invite, signature: copied }).pipe(Effect.flip))
            .reason,
        ).toBe("invalid-proof");
        expect(
          (yield* service
            .apply(
              {
                operationId: "b".repeat(32),
                expectedRevision: 1,
                change: {
                  type: "approve",
                  enrollmentId: invite.enrollmentId,
                  fingerprint: key.fingerprint,
                },
              },
              "admin",
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        const signature = yield* crypto.sign(key.privateKey, vaultBrokerClaimMessage(invite));
        const claim = yield* service.claim({ invitation: invite, signature });
        expect(yield* service.claim({ invitation: invite, signature })).toEqual(claim);
        expect(
          (yield* challengeFor(service, crypto, key, claim.machineId).pipe(Effect.flip)).reason,
        ).toBe("approval-pending");
        const snapshot = yield* service.snapshot;
        expect(snapshot.revision).toBe(2);
        expect(snapshot.enrollments[0]?.state).toBe("awaiting-approval");
        expect(JSON.stringify(snapshot)).not.toContain(invite.nonce);
        expect(JSON.stringify(snapshot)).not.toContain(Redacted.value(key.privateKey));
      }),
    ),
);
it.effect(
  "renews a bounded online lease, rejects proof replay and invalidates a disabled host",
  () =>
    run(({ service, crypto }) =>
      Effect.gen(function* () {
        const { key, claim } = yield* enroll(service, crypto);
        const challenge = yield* challengeFor(service, crypto, key, claim.machineId);
        const input = {
          challenge,
          signature: yield* crypto.sign(key.privateKey, vaultBrokerHeartbeatMessage(challenge)),
        };
        const result = yield* service.heartbeat(input);
        expect(result).toMatchObject({
          credentialDelivery: "unsupported",
          leaseUntil: 120_000,
          renewAfter: 60_000,
        });
        expect((yield* service.snapshot).revision).toBe(3);
        expect((yield* service.heartbeat(input).pipe(Effect.flip)).reason).toBe("invalid-proof");
        const pending = yield* challengeFor(service, crypto, key, claim.machineId);
        yield* service.apply(
          {
            operationId: "c".repeat(32),
            expectedRevision: 3,
            change: { type: "disable", machineId: claim.machineId },
          },
          "admin",
        );
        expect(
          (yield* service
            .heartbeat({
              challenge: pending,
              signature: yield* crypto.sign(key.privateKey, vaultBrokerHeartbeatMessage(pending)),
            })
            .pipe(Effect.flip)).reason,
        ).toBe("disabled");
        expect((yield* service.snapshot).machines[0]?.leaseUntil).toBe(0);
      }),
    ),
);
it.effect(
  "rejects altered environment proofs, expired heartbeats and expired enrollment invitations",
  () =>
    run(({ service, crypto }) =>
      Effect.gen(function* () {
        const { key, claim } = yield* enroll(service, crypto);
        const challenge = yield* challengeFor(service, crypto, key, claim.machineId);
        const altered = { ...challenge, environmentId: "another-control-plane" };
        expect(
          (yield* service
            .heartbeat({
              challenge: altered,
              signature: yield* crypto.sign(key.privateKey, vaultBrokerHeartbeatMessage(altered)),
            })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-proof");
        yield* TestClock.adjust("61 seconds");
        expect(
          (yield* service
            .heartbeat({
              challenge,
              signature: yield* crypto.sign(key.privateKey, vaultBrokerHeartbeatMessage(challenge)),
            })
            .pipe(Effect.flip)).reason,
        ).toBe("expired");
        const other = yield* crypto.create;
        const invitation = yield* service.begin(
          {
            operationId: "d".repeat(32),
            expectedRevision: 3,
            publicKey: other.publicKey,
            label: "Expired",
            platform: "linux",
          },
          "admin",
        );
        yield* TestClock.adjust("11 minutes");
        expect(
          (yield* service
            .claim({
              invitation,
              signature: yield* crypto.sign(other.privateKey, vaultBrokerClaimMessage(invitation)),
            })
            .pipe(Effect.flip)).reason,
        ).toBe("expired");
      }),
    ),
);
it.effect(
  "persists disable across service reconstruction and refuses reused or forged review mutations",
  () =>
    run(({ service, crypto, fixture }) =>
      Effect.gen(function* () {
        const { key, invite, claim } = yield* enroll(service, crypto);
        expect(
          (yield* service
            .apply(
              {
                operationId: "c".repeat(32),
                expectedRevision: 0,
                change: { type: "disable", machineId: claim.machineId },
              },
              "admin",
            )
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        fixture.state.conflictOnce = true;
        const input = {
          operationId: "c".repeat(32),
          expectedRevision: 3,
          change: { type: "disable" as const, machineId: claim.machineId },
        };
        const disabled = yield* service.apply(input, "admin");
        expect(yield* service.apply(input, "admin")).toEqual(disabled);
        expect((yield* service.apply(input, "different-admin").pipe(Effect.flip)).reason).toBe(
          "conflict",
        );
        const fresh = yield* VaultBrokers.VaultBrokers.pipe(Effect.provide(fixture.layer));
        expect(
          (yield* challengeFor(fresh, crypto, key, claim.machineId).pipe(Effect.flip)).reason,
        ).toBe("disabled");
        expect(
          (yield* fresh
            .begin(
              {
                operationId: "d".repeat(32),
                expectedRevision: 4,
                publicKey: key.publicKey,
                label: "Reuse disabled key",
                platform: "linux",
              },
              "admin",
            )
            .pipe(Effect.flip)).reason,
        ).toBe("disabled");
        expect(
          (yield* fresh
            .claim({
              invitation: invite,
              signature: yield* crypto.sign(key.privateKey, vaultBrokerClaimMessage(invite)),
            })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-proof");
      }),
    ),
);
it.effect(
  "fails closed on audit/storage failure and rechecks authorization before applying a review",
  () =>
    run(({ service, crypto, fixture }) =>
      Effect.gen(function* () {
        const { key: identityKey, claim } = yield* enroll(service, crypto);
        const challenge = yield* challengeFor(service, crypto, identityKey, claim.machineId);
        const key = (yield* service.snapshot).machines[0]!;
        fixture.state.failWrites = true;
        expect(
          (yield* service
            .apply(
              {
                operationId: "c".repeat(32),
                expectedRevision: 3,
                change: { type: "disable", machineId: claim.machineId },
              },
              "admin",
            )
            .pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        fixture.state.failWrites = false;
        let checks = 0;
        const authorize = Effect.suspend(() =>
          ++checks === 1 ? Effect.void : Effect.fail(new VaultError({ reason: "denied" })),
        );
        expect(
          (yield* service
            .apply(
              {
                operationId: "d".repeat(32),
                expectedRevision: 3,
                change: { type: "disable", machineId: claim.machineId },
              },
              "admin",
              authorize,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect((yield* service.snapshot).machines[0]?.state).toBe("active");
        expect(challenge.machineId).toBe(key.id);
      }),
    ),
);

it.effect("cancels an invitation durably and rejects its later signed claim", () =>
  run(({ service, crypto }) =>
    Effect.gen(function* () {
      const key = yield* crypto.create;
      const invitation = yield* service.begin(
        {
          operationId: "a".repeat(32),
          expectedRevision: 0,
          publicKey: key.publicKey,
          label: "Cancelled host",
          platform: "linux",
        },
        "admin",
      );
      const input = {
        operationId: "b".repeat(32),
        expectedRevision: 1,
        change: { type: "cancel" as const, enrollmentId: invitation.enrollmentId },
      };
      const result = yield* service.apply(input, "admin");
      expect(yield* service.apply(input, "admin")).toEqual(result);
      expect((yield* service.snapshot).enrollments).toHaveLength(0);
      expect(
        (yield* service
          .claim({
            invitation,
            signature: yield* crypto.sign(key.privateKey, vaultBrokerClaimMessage(invitation)),
          })
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-proof");
      expect((yield* service.snapshot).machines).toHaveLength(0);
    }),
  ),
);
