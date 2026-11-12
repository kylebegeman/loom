import {
  AccountVaultRequest,
  type AccountVaultEnvelope,
  type AccountVaultResponse,
  type VaultConnectionPin,
  type VaultSshAgentSession,
  VaultError,
  VaultSshError,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import * as AccountWorkloads from "../account-access/AccountWorkloads.ts";
import * as SshAgentFrames from "./SshAgentFrames.ts";
import * as SshCrypto from "./SshCrypto.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultConnections from "./VaultConnections.ts";
import * as VaultCore from "./VaultCore.ts";
import { StoredKey } from "./VaultSsh.ts";

type Lease = Effect.Success<ReturnType<AccountWorkloads.AccountWorkloads["Service"]["accept"]>>;
const SESSION_MS = 5 * 60_000;
const MAX_SESSIONS = 64;
const decodeRequest = Schema.decodeEffect(Schema.fromJsonString(AccountVaultRequest));
const decodeKey = Schema.decodeEffect(Schema.fromJsonString(StoredKey));
const denied = () => new VaultError({ reason: "denied" });
const sameWorkload = (a: Lease, b: Lease) =>
  a.sourceEnvironmentId === b.sourceEnvironmentId &&
  a.keyFingerprint === b.keyFingerprint &&
  a.ownerSubject === b.ownerSubject &&
  a.membershipRevision === b.membershipRevision &&
  a.membershipEpoch === b.membershipEpoch &&
  a.authorityId === b.authorityId &&
  a.authorityEpoch === b.authorityEpoch &&
  a.workload.threadId === b.workload.threadId &&
  a.workload.runId === b.workload.runId &&
  a.workload.projectId === b.workload.projectId &&
  a.workload.providerInstanceId === b.workload.providerInstanceId;

export class AccountVaultAuthority extends Context.Service<
  AccountVaultAuthority,
  {
    readonly execute: (
      envelope: AccountVaultEnvelope,
      publisher: AuthenticatedSession,
    ) => Effect.Effect<AccountVaultResponse, VaultError | VaultSshError>;
  }
>()("t3/fork/vault/AccountVaultAuthority") {}

const make = Effect.gen(function* () {
  const workloads = yield* AccountWorkloads.AccountWorkloads;
  const access = yield* VaultAccess.VaultAccess;
  const connections = yield* VaultConnections.VaultConnections;
  const core = yield* VaultCore.VaultCore;
  const crypto = yield* SshCrypto.SshCrypto;
  const random = yield* SecureRandom.SecureRandom;
  type Activation = {
    lease: Lease;
    pin: VaultConnectionPin;
    session: VaultSshAgentSession;
    channels: SshAgentFrames.Channels;
    lock: Semaphore.Semaphore;
  };
  const sessions = new Map<string, Activation>();
  const authorize = (lease: Lease, pin: VaultConnectionPin) =>
    access.authorizeAccount(
      {
        lease,
        itemId: pin.item.id,
        expectedVersion: pin.item.version,
        action: "use",
        destination: pin.destination,
      },
      workloads.revalidate(lease),
    );
  const readKey = Effect.fn("AccountVaultAuthority.readKey")(function* (
    lease: Lease,
    pin: VaultConnectionPin,
  ) {
    yield* authorize(lease, pin);
    const value = yield* core.reveal({ id: pin.item.id, expectedVersion: pin.item.version });
    if (value.item.kind !== "ssh-key" || value.item.state !== "active") return yield* denied();
    const key = yield* decodeKey(Redacted.value(value.value)).pipe(
      Effect.mapError(() => new VaultSshError({ reason: "invalid-key" })),
    );
    if ((yield* crypto.publicKey(key.privateKey)) !== key.publicKey)
      return yield* new VaultSshError({ reason: "invalid-key" });
    if (key.target.hostKey === null) return yield* new VaultSshError({ reason: "untrusted-host" });
    yield* crypto.fingerprint(key.target.hostKey);
    yield* authorize(lease, pin);
    return key;
  });
  return AccountVaultAuthority.of({
    execute: Effect.fn("AccountVaultAuthority.execute")(function* (envelope, publisher) {
      const lease = yield* workloads.accept(envelope.payload, envelope.proof, publisher);
      const request = yield* decodeRequest(envelope.payload).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      const now = yield* Clock.currentTimeMillis;
      for (const [id, held] of sessions) if (held.session.expiresAt <= now) sessions.delete(id);
      if (request.kind === "sessions") {
        yield* workloads.revalidate(lease);
        return {
          kind: "sessions",
          sessions: [...sessions.values()]
            .filter((held) => sameWorkload(held.lease, lease))
            .map((held) => held.session),
        };
      }
      if (request.kind === "resolve" || request.kind === "open") {
        const report = yield* connections.resolveForAccount(request.input, {
          lease,
          authorize: workloads.revalidate(lease),
        });
        yield* workloads.revalidate(lease);
        if (request.kind === "resolve") return { kind: "resolve", report };
        if (report.state !== "ready" || !report.selected || request.input.kind === "github")
          return yield* denied();
        const pin = report.selected;
        const key = yield* readKey(lease, pin);
        const lock = yield* Semaphore.make(1);
        const sessionId = yield* random.uuidV4().pipe(
          Effect.map((id) => id.replaceAll("-", "")),
          Effect.mapError(() => new VaultError({ reason: "unavailable" })),
        );
        yield* authorize(lease, pin);
        if (sessions.size >= MAX_SESSIONS) return yield* new VaultSshError({ reason: "capacity" });
        const session: VaultSshAgentSession = {
          sessionId,
          id: pin.item.id,
          version: pin.item.version,
          expiresAt: now + SESSION_MS,
          destination: pin.destination,
          target: key.target,
          publicKey: key.publicKey,
        };
        sessions.set(session.sessionId, { lease, pin, session, lock, channels: new Map() });
        return { kind: "open", pin, session };
      }
      const held = sessions.get(request.input.sessionId);
      if (!held || !sameWorkload(held.lease, lease)) return yield* denied();
      const checkSession = Effect.gen(function* () {
        if (
          sessions.get(held.session.sessionId) !== held ||
          held.session.expiresAt <= (yield* Clock.currentTimeMillis)
        )
          return yield* denied();
        yield* workloads.revalidate(lease);
      });
      return yield* Effect.gen(function* () {
        yield* checkSession;
        if (request.kind === "close") {
          yield* workloads.revalidate(lease);
          sessions.delete(held.session.sessionId);
          return { kind: "close" as const, closed: true as const };
        }
        const result = yield* SshAgentFrames.respond(
          held.channels,
          request.input,
          readKey(lease, held.pin),
          checkSession.pipe(Effect.andThen(authorize(lease, held.pin))),
        ).pipe(Effect.provideService(SshCrypto.SshCrypto, crypto));
        return { kind: "frame" as const, ...result };
      }).pipe(held.lock.withPermit);
    }),
  });
});
export const layer = Layer.effect(AccountVaultAuthority, make);
