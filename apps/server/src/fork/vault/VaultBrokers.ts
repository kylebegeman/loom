import {
  VaultError,
  VaultBrokerError,
  VaultBrokerMachine,
  VaultBrokerEnrollment,
  VaultBrokerInvitation,
  VaultBrokerBegin,
  VaultBrokerMutation,
  VaultBrokerMutationResult,
  VaultBrokerEvent,
  VaultBrokerClaim,
  VaultBrokerHeartbeat,
  VaultBrokerHeartbeatChallenge,
  VaultBrokerChallengeRequest,
  vaultBrokerChallengeMessage,
  type VaultBrokerSnapshot,
  type VaultBrokerHeartbeatResult,
  vaultBrokerClaimMessage,
  vaultBrokerHeartbeatMessage,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";

type Failure = VaultError | VaultBrokerError;
const Enrollment = Schema.Struct({
  ...VaultBrokerEnrollment.fields,
  nonce: VaultBrokerInvitation.fields.nonce,
});
const Receipt = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    fingerprint: Schema.String,
    type: Schema.Literal("begin"),
    result: VaultBrokerInvitation,
  }),
  Schema.Struct({
    id: Schema.String,
    fingerprint: Schema.String,
    type: Schema.Literal("apply"),
    result: VaultBrokerMutationResult,
  }),
]);
const Registry = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  machines: Schema.Array(VaultBrokerMachine).check(Schema.isMaxLength(64)),
  enrollments: Schema.Array(Enrollment).check(Schema.isMaxLength(16)),
  events: Schema.Array(VaultBrokerEvent).check(Schema.isMaxLength(128)),
  omittedEvents: Schema.Int,
  receipts: Schema.Array(Receipt).check(Schema.isMaxLength(32)),
});
type Registry = typeof Registry.Type;
const decode = Schema.decodeUnknownOption(Registry),
  encode = Schema.encodeEffect(Registry);
const empty: Registry = {
  schemaVersion: 1,
  revision: 0,
  machines: [],
  enrollments: [],
  events: [],
  omittedEvents: 0,
  receipts: [],
};
const BROKER_INVITATION_MS = 10 * 60_000;
const BROKER_CHALLENGE_MS = 60_000;
const BROKER_LEASE_MS = 120_000;

export class VaultBrokers extends Context.Service<
  VaultBrokers,
  {
    readonly snapshot: Effect.Effect<VaultBrokerSnapshot, Failure>;
    readonly begin: (
      input: VaultBrokerBegin,
      actor: string,
    ) => Effect.Effect<VaultBrokerInvitation, Failure>;
    readonly apply: (
      input: VaultBrokerMutation,
      actor: string,
      authorize?: Effect.Effect<void, Failure>,
    ) => Effect.Effect<VaultBrokerMutationResult, Failure>;
    readonly claim: (
      input: VaultBrokerClaim,
    ) => Effect.Effect<{ machineId: string; state: "awaiting-approval" }, Failure>;
    readonly challenge: (
      input: VaultBrokerChallengeRequest,
    ) => Effect.Effect<VaultBrokerHeartbeatChallenge, Failure>;
    readonly heartbeat: (
      input: VaultBrokerHeartbeat,
    ) => Effect.Effect<VaultBrokerHeartbeatResult, Failure>;
  }
>()("t3/fork/vault/VaultBrokers") {}

const isBrokerBegin = Schema.is(VaultBrokerBegin);
const isBrokerClaim = Schema.is(VaultBrokerClaim);
const isBrokerMutation = Schema.is(VaultBrokerMutation);
const isChallengeRequest = Schema.is(VaultBrokerChallengeRequest);
const isBrokerHeartbeat = Schema.is(VaultBrokerHeartbeat);
const encodeEffectBeginRequest = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ input: VaultBrokerBegin, actor: Schema.String })),
);
const encodeEffectMutationRequest = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ input: VaultBrokerMutation, actor: Schema.String })),
);
const make = Effect.gen(function* () {
  const store = yield* OpenBaoStore.OpenBaoStore,
    keys = yield* BrokerCrypto.BrokerCrypto;
  const identity = yield* ServerEnvironmentIdentity,
    crypto = yield* Crypto.Crypto;
  const environmentId = yield* identity.getEnvironmentId;
  const digest = (value: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
    );
  const path = `environments/${yield* digest(environmentId)}/brokers`;
  const id = crypto.randomUUIDv4().pipe(
    Effect.map((value) => value.replaceAll("-", "")),
    Effect.mapError(() => new VaultError({ reason: "unavailable" })),
  );
  const nonce = Effect.gen(function* () {
    return (yield* id) + (yield* id);
  });
  const pending = yield* Ref.make<
    ReadonlyMap<string, { challenge: VaultBrokerHeartbeatChallenge; consumed: boolean }>
  >(new Map());
  const load = Effect.fnUntraced(function* () {
    const record = yield* store.read(path);
    if (!record) return { registry: empty, version: 0 };
    const decoded = decode(Redacted.value(record.value));
    if (
      Option.isNone(decoded) ||
      new Set(decoded.value.machines.map((m) => m.id)).size !== decoded.value.machines.length
    )
      return yield* new VaultError({ reason: "invalid-response" });
    return { registry: decoded.value, version: record.version };
  });
  const persist = Effect.fnUntraced(function* (registry: Registry, version: number) {
    const encoded = yield* encode(registry).pipe(
      Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
    );
    return yield* store.write(path, Redacted.make(encoded), version);
  });
  const event = Effect.fnUntraced(function* (
    registry: Registry,
    kind: (typeof VaultBrokerEvent.Type)["kind"],
    actor: string,
    machineId: string,
  ) {
    return {
      ...registry,
      events: [
        ...registry.events,
        { id: yield* id, at: yield* Clock.currentTimeMillis, actor, kind, machineId },
      ].slice(-128),
      omittedEvents: registry.omittedEvents + (registry.events.length === 128 ? 1 : 0),
    };
  });
  const invitation = (enrollment: typeof Enrollment.Type): VaultBrokerInvitation => ({
    protocol: 1,
    environmentId,
    enrollmentId: enrollment.id,
    nonce: enrollment.nonce,
    fingerprint: enrollment.fingerprint,
    expiresAt: enrollment.expiresAt,
  });
  const active = (registry: Registry, machineId: string) => {
    const machine = registry.machines.find((m) => m.id === machineId);
    if (!machine) return Effect.fail(new VaultBrokerError({ reason: "approval-pending" }));
    return machine.state === "disabled"
      ? Effect.fail(new VaultBrokerError({ reason: "disabled" }))
      : Effect.succeed(machine);
  };
  return VaultBrokers.of({
    snapshot: Effect.gen(function* () {
      const { registry } = yield* load();
      return {
        environmentId,
        revision: registry.revision,
        machines: registry.machines,
        enrollments: registry.enrollments.map(({ nonce: _nonce, ...enrollment }) => enrollment),
        events: registry.events.toReversed(),
        omittedEvents: registry.omittedEvents,
      };
    }),
    begin: Effect.fn("VaultBrokers.begin")(function* (input, actor) {
      if (!isBrokerBegin(input) || !actor.trim() || actor.length > 256)
        return yield* new VaultError({ reason: "invalid-input" });
      const fingerprint = yield* keys.fingerprint(input.publicKey);
      const request = yield* digest(
        yield* encodeEffectBeginRequest({ input, actor }).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        ),
      );
      for (let attempt = 0; attempt < 4; attempt++) {
        const { registry, version } = yield* load();
        const receipt = registry.receipts.find((r) => r.id === input.operationId);
        if (receipt) {
          if (receipt.fingerprint !== request || receipt.type !== "begin")
            return yield* new VaultError({ reason: "conflict" });
          return receipt.result;
        }
        if (input.expectedRevision !== registry.revision)
          return yield* new VaultError({ reason: "conflict" });
        if (registry.machines.some((m) => m.fingerprint === fingerprint))
          return yield* new VaultBrokerError({ reason: "disabled" });
        const now = yield* Clock.currentTimeMillis;
        const enrollments = registry.enrollments.filter((e) => e.expiresAt > now);
        if (enrollments.some((e) => e.fingerprint === fingerprint))
          return yield* new VaultError({ reason: "conflict" });
        if (enrollments.length >= 16 || registry.machines.length >= 64)
          return yield* new VaultBrokerError({ reason: "capacity" });
        const enrollment: typeof Enrollment.Type = {
          id: yield* id,
          label: input.label,
          platform: input.platform,
          publicKey: input.publicKey,
          fingerprint,
          nonce: yield* nonce,
          expiresAt: now + BROKER_INVITATION_MS,
          state: "waiting-for-claim",
        };
        const result = invitation(enrollment);
        const changed: Registry = {
          ...registry,
          revision: registry.revision + 1,
          enrollments: [...enrollments, enrollment],
          receipts: [
            ...registry.receipts,
            { id: input.operationId, fingerprint: request, type: "begin" as const, result },
          ].slice(-32),
        };
        const next = yield* event(changed, "invited", actor, fingerprint.slice(0, 32));
        const saved = yield* persist(next, version).pipe(Effect.result);
        if (saved._tag === "Success") return result;
        if (saved.failure.reason !== "conflict") return yield* saved.failure;
      }
      return yield* new VaultError({ reason: "conflict" });
    }),
    claim: Effect.fn("VaultBrokers.claim")(function* (input) {
      if (!isBrokerClaim(input)) return yield* new VaultError({ reason: "invalid-input" });
      for (let attempt = 0; attempt < 4; attempt++) {
        const { registry, version } = yield* load();
        const enrollment = registry.enrollments.find((e) => e.id === input.invitation.enrollmentId);
        if (
          !enrollment ||
          vaultBrokerClaimMessage(invitation(enrollment)) !==
            vaultBrokerClaimMessage(input.invitation)
        )
          return yield* new VaultBrokerError({ reason: "invalid-proof" });
        if (enrollment.expiresAt <= (yield* Clock.currentTimeMillis))
          return yield* new VaultBrokerError({ reason: "expired" });
        if (
          !(yield* keys.verify(
            enrollment.publicKey,
            vaultBrokerClaimMessage(input.invitation),
            input.signature,
          ))
        )
          return yield* new VaultBrokerError({ reason: "invalid-proof" });
        const machineId = enrollment.fingerprint.slice(0, 32);
        if (enrollment.state === "awaiting-approval")
          return { machineId, state: "awaiting-approval" as const };
        const next = yield* event(
          {
            ...registry,
            revision: registry.revision + 1,
            enrollments: registry.enrollments.map((e) =>
              e.id === enrollment.id ? { ...e, state: "awaiting-approval" as const } : e,
            ),
          },
          "claimed",
          `broker:${machineId}`,
          machineId,
        );
        const saved = yield* persist(next, version).pipe(Effect.result);
        if (saved._tag === "Success") return { machineId, state: "awaiting-approval" as const };
        if (saved.failure.reason !== "conflict") return yield* saved.failure;
      }
      return yield* new VaultError({ reason: "conflict" });
    }),
    apply: Effect.fn("VaultBrokers.apply")(function* (input, actor, authorize) {
      if (!isBrokerMutation(input) || !actor.trim() || actor.length > 256)
        return yield* new VaultError({ reason: "invalid-input" });
      const change = input.change;
      const request = yield* digest(
        yield* encodeEffectMutationRequest({ input, actor }).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        ),
      );
      for (let attempt = 0; attempt < 4; attempt++) {
        const { registry, version } = yield* load();
        yield* authorize ?? Effect.void;
        const receipt = registry.receipts.find((r) => r.id === input.operationId);
        if (receipt) {
          if (receipt.fingerprint !== request || receipt.type !== "apply")
            return yield* new VaultError({ reason: "conflict" });
          return receipt.result;
        }
        if (input.expectedRevision !== registry.revision)
          return yield* new VaultError({ reason: "conflict" });
        let machine: VaultBrokerMachine | null = null;
        let machines = registry.machines,
          enrollments = registry.enrollments;
        let machineId: string;
        let kind: (typeof VaultBrokerEvent.Type)["kind"];
        if (change.type === "disable") {
          const target = registry.machines.find((m) => m.id === change.machineId);
          if (!target) return yield* new VaultError({ reason: "not-found" });
          machine = { ...target, state: "disabled", leaseUntil: 0, revision: target.revision + 1 };
          machines = registry.machines.map((m) => (m.id === target.id ? machine! : m));
          machineId = target.id;
          kind = "disabled";
        } else {
          const target = registry.enrollments.find((e) => e.id === change.enrollmentId);
          if (!target) return yield* new VaultError({ reason: "not-found" });
          machineId = target.fingerprint.slice(0, 32);
          if (change.type === "approve") {
            if (target.state !== "awaiting-approval" || target.fingerprint !== change.fingerprint)
              return yield* new VaultError({ reason: "denied" });
            if (target.expiresAt <= (yield* Clock.currentTimeMillis))
              return yield* new VaultBrokerError({ reason: "expired" });
            if (registry.machines.length >= 64)
              return yield* new VaultBrokerError({ reason: "capacity" });
            if (registry.machines.some((m) => m.id === machineId))
              return yield* new VaultError({ reason: "conflict" });
            machine = {
              id: machineId,
              publicKey: target.publicKey,
              fingerprint: target.fingerprint,
              label: target.label,
              platform: target.platform,
              state: "active",
              revision: 1,
              approvedBy: actor,
              approvedAt: yield* Clock.currentTimeMillis,
              lastSeenAt: null,
              leaseUntil: 0,
            };
            machines = [...machines, machine];
            kind = "approved";
          } else kind = "cancelled";
          enrollments = enrollments.filter((e) => e.id !== target.id);
        }
        const result = { revision: registry.revision + 1, machine };
        const next = yield* event(
          {
            ...registry,
            revision: result.revision,
            machines,
            enrollments,
            receipts: [
              ...registry.receipts,
              { id: input.operationId, fingerprint: request, type: "apply" as const, result },
            ].slice(-32),
          },
          kind,
          actor,
          machineId,
        );
        yield* authorize ?? Effect.void;
        const saved = yield* persist(next, version).pipe(Effect.result);
        if (saved._tag === "Success") return result;
        if (saved.failure.reason !== "conflict") return yield* saved.failure;
      }
      return yield* new VaultError({ reason: "conflict" });
    }),
    challenge: Effect.fn("VaultBrokers.challenge")(function* (input) {
      if (!isChallengeRequest(input)) return yield* new VaultError({ reason: "invalid-input" });
      const { registry } = yield* load();
      const machine = yield* active(registry, input.machineId);
      const now = yield* Clock.currentTimeMillis;
      if (
        input.environmentId !== environmentId ||
        Math.abs(now - input.at) > 30_000 ||
        !(yield* keys.verify(
          machine.publicKey,
          vaultBrokerChallengeMessage(input),
          input.signature,
        ))
      )
        return yield* new VaultBrokerError({ reason: "invalid-proof" });
      const challenge: VaultBrokerHeartbeatChallenge = {
        protocol: 1,
        environmentId,
        machineId: machine.id,
        requestId: input.requestId,
        operation: "heartbeat",
        nonce: yield* nonce,
        expiresAt: now + BROKER_CHALLENGE_MS,
      };
      const accepted = yield* Ref.modify(pending, (current) => {
        const next = new Map([...current].filter(([, entry]) => entry.challenge.expiresAt > now));
        const existing = [...next.values()].find(
          (entry) =>
            entry.challenge.machineId === machine.id &&
            entry.challenge.requestId === input.requestId,
        );
        if (existing) return [existing.challenge, next] as const;
        if (
          next.size >= 256 ||
          [...next.values()].filter((entry) => entry.challenge.machineId === machine.id).length >= 4
        )
          return [null, next] as const;
        next.set(challenge.nonce, { challenge, consumed: false });
        return [challenge, next] as const;
      });
      if (!accepted) return yield* new VaultBrokerError({ reason: "capacity" });
      return accepted;
    }),
    heartbeat: Effect.fn("VaultBrokers.heartbeat")(function* (input) {
      if (!isBrokerHeartbeat(input)) return yield* new VaultError({ reason: "invalid-input" });
      const now = yield* Clock.currentTimeMillis;
      if (input.challenge.expiresAt <= now)
        return yield* new VaultBrokerError({ reason: "expired" });
      const { registry: initial } = yield* load();
      const original = yield* active(initial, input.challenge.machineId);
      if (
        !(yield* keys.verify(
          original.publicKey,
          vaultBrokerHeartbeatMessage(input.challenge),
          input.signature,
        ))
      )
        return yield* new VaultBrokerError({ reason: "invalid-proof" });
      const consumed = yield* Ref.modify(pending, (current) => {
        const held = current.get(input.challenge.nonce);
        if (
          !held ||
          held.consumed ||
          vaultBrokerHeartbeatMessage(held.challenge) !==
            vaultBrokerHeartbeatMessage(input.challenge)
        )
          return [false, current] as const;
        const next = new Map(current);
        next.set(input.challenge.nonce, { ...held, consumed: true });
        return [true, next] as const;
      });
      if (!consumed) return yield* new VaultBrokerError({ reason: "invalid-proof" });
      for (let attempt = 0; attempt < 4; attempt++) {
        const { registry, version } = yield* load();
        const machine = yield* active(registry, input.challenge.machineId);
        const checkedAt = yield* Clock.currentTimeMillis;
        if (input.challenge.expiresAt <= checkedAt)
          return yield* new VaultBrokerError({ reason: "expired" });
        const leaseUntil = checkedAt + BROKER_LEASE_MS;
        const next = yield* event(
          {
            ...registry,
            machines: registry.machines.map((m) =>
              m.id === machine.id ? { ...m, lastSeenAt: checkedAt, leaseUntil } : m,
            ),
          },
          "renewed",
          `broker:${machine.id}`,
          machine.id,
        );
        const saved = yield* persist(next, version).pipe(Effect.result);
        if (saved._tag === "Success")
          return {
            environmentId,
            machineId: machine.id,
            leaseUntil,
            renewAfter: checkedAt + BROKER_LEASE_MS / 2,
            credentialDelivery: "unsupported" as const,
          };
        if (saved.failure.reason !== "conflict") return yield* saved.failure;
      }
      return yield* new VaultError({ reason: "conflict" });
    }),
  });
});
export const layer = Layer.effect(VaultBrokers, make);
