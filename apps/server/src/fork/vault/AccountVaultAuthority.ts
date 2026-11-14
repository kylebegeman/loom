import {
  AccountVaultRequest,
  type AccountVaultEnvelope,
  type AccountVaultResponse,
  type VaultConnectionPin,
  type VaultSshAgentSession,
  VaultError,
  VaultSshError,
  VaultConnectionError,
  type VaultGitHubError,
  type VaultGitHubResult,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
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
import * as VaultGitHub from "./VaultGitHub.ts";
import * as AccountGitHubJournal from "./AccountGitHubJournal.ts";

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
      publisher: AuthenticatedSession | undefined,
    ) => Effect.Effect<
      AccountVaultResponse,
      VaultError | VaultSshError | VaultGitHubError | VaultConnectionError
    >;
  }
>()("t3/fork/vault/AccountVaultAuthority") {}

const make = Effect.gen(function* () {
  const workloads = yield* AccountWorkloads.AccountWorkloads;
  const access = yield* VaultAccess.VaultAccess;
  const connections = yield* VaultConnections.VaultConnections;
  const core = yield* VaultCore.VaultCore;
  const github = yield* VaultGitHub.VaultGitHub;
  const journal = yield* AccountGitHubJournal.AccountGitHubJournal;
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
  const githubSessions = new Map<
    string,
    { lease: Lease; scope: Scope.Closeable; done: Deferred.Deferred<void> }
  >();
  const closeGitHub = (id: string) =>
    Effect.suspend(() => {
      const held = githubSessions.get(id);
      githubSessions.delete(id);
      return held
        ? Scope.close(held.scope, Exit.void).pipe(
            Effect.andThen(Deferred.succeed(held.done, undefined)),
            Effect.asVoid,
          )
        : Effect.void;
    });
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...githubSessions.keys()], closeGitHub, { discard: true }),
  );
  const githubLifetime = yield* Effect.scope;
  const githubPermit = yield* Semaphore.make(1);
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
      if (request.kind === "github-terminal-close") {
        const held = githubSessions.get(request.sessionId);
        if (!held || !sameWorkload(held.lease, lease)) return yield* denied();
        yield* closeGitHub(request.sessionId);
        return { kind: "github-terminal-close", closed: true };
      }
      if (request.kind === "github" || request.kind === "github-terminal") {
        const input = request.input;
        const account = { lease, authorize: workloads.revalidate(lease) };
        const perform = Effect.gen(function* () {
          const report = yield* connections.resolveForAccount(
            {
              kind: "github",
              connection:
                "connection" in input
                  ? input.connection
                  : { id: input.id, expectedVersion: input.expectedVersion },
              repository: input.repository,
            },
            account,
          );
          if (report.state !== "ready" || report.selected === null)
            return yield* new VaultConnectionError({
              state: report.state,
              choices: report.choices,
              repair: report.repair,
            });
          if (request.kind === "github-terminal") {
            return yield* githubPermit.withPermit(
              Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                  if (githubSessions.size >= MAX_SESSIONS)
                    return yield* new VaultError({ reason: "unavailable" });
                  const id = (yield* random
                    .uuidV4()
                    .pipe(
                      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
                    )).replaceAll("-", "");
                  const scope = yield* Scope.make();
                  const credential = yield* restore(
                    github.terminalForAccount(
                      {
                        id: report.selected!.item.id,
                        expectedVersion: report.selected!.item.version,
                        repository: input.repository,
                        command: request.input.command,
                      },
                      account,
                    ),
                  ).pipe(
                    Effect.provideService(Scope.Scope, scope),
                    Effect.onError(() => Scope.close(scope, Exit.void)),
                  );
                  const done = yield* Deferred.make<void>();
                  githubSessions.set(id, { lease, scope, done });
                  yield* Deferred.await(done).pipe(
                    Effect.timeoutOption("3 minutes"),
                    Effect.andThen(closeGitHub(id)),
                    Effect.forkIn(githubLifetime),
                  );
                  return {
                    kind: "github-terminal" as const,
                    sessionId: id,
                    pin: report.selected!,
                    credential,
                  };
                }),
              ),
            );
          }
          return yield* github.runForAccount(
            {
              id: report.selected.item.id,
              expectedVersion: report.selected.item.version,
              repository: input.repository,
              operation: request.input.operation,
            },
            account,
          );
        });
        if (request.kind === "github-terminal") {
          const result = yield* perform;
          if (!("kind" in result)) return yield* new VaultError({ reason: "invalid-response" });
          return result;
        }
        const githubPerform = perform.pipe(
          Effect.filterOrFail(
            (result): result is VaultGitHubResult => !("kind" in result),
            () => new VaultError({ reason: "invalid-response" }),
          ),
        );
        const tracked =
          request.mode === "recover" ||
          ["pr-comment", "issue-comment", "issue-create"].includes(request.input.operation.action);
        if (!tracked) return { kind: "github", result: yield* githubPerform };
        if (!request.operationId || !request.mode)
          return yield* new VaultError({ reason: "invalid-input" });
        const result = yield* journal.run(
          {
            operationId: request.operationId,
            mode: request.mode,
            proposal: request.input,
            scope: {
              sourceEnvironmentId: lease.sourceEnvironmentId,
              keyFingerprint: lease.keyFingerprint,
              authorityId: lease.authorityId,
              ownerSubject: lease.ownerSubject,
              threadId: lease.workload.threadId,
              projectId: lease.workload.projectId,
            },
          },
          access.authorizeAccount(
            { lease, itemId: null, expectedVersion: null, action: "inspect", destination: null },
            account.authorize,
          ),
          githubPerform,
        );
        return { kind: "github", result };
      }
      if (request.kind === "list") {
        const authorize = access.authorizeAccount(
          {
            lease,
            itemId: null,
            expectedVersion: null,
            action: "inspect",
            destination: null,
          },
          workloads.revalidate(lease),
        );
        yield* authorize;
        const page = yield* core.list(request.input);
        yield* authorize;
        return { kind: "list", page };
      }
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
          label: pin.item.label,
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
export const layer = Layer.effect(AccountVaultAuthority, make).pipe(
  Layer.provide(AccountGitHubJournal.layer),
);
