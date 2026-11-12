import {
  AuthLibraryPublishScope,
  AuthSessionId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import { signRelayJwt, verifyRelayJwt } from "@t3tools/shared/relayJwt";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { ReachStore } from "../reach/library/ReachStore.ts";
import { isVaultRunRunning, readVaultThreadShell } from "../vault/active-run.ts";

const PROOF_SECONDS = 30;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_USED_PROOFS = 4096;
const PROOF_TYPE = "loom-account-workload+jwt";
const Workload = Schema.Struct({
  threadId: ThreadId,
  runId: RunId,
  projectId: ProjectId,
  providerInstanceId: ProviderInstanceId,
  runtimeMode: Schema.Literal("full-access"),
  interactionMode: Schema.Literal("default"),
});
const Claims = Schema.Struct({
  publisherSessionId: AuthSessionId,
  authorityId: Schema.String,
  authorityEpoch: Schema.Number,
  nonce: Schema.String,
  digest: Schema.String,
  workload: Schema.optionalKey(Workload),
  iat: Schema.Number,
  exp: Schema.Number,
});
type Lease = {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly publisherSessionId: AuthSessionId;
  readonly authorityId: string;
  readonly authorityEpoch: number;
  readonly keyFingerprint: string;
  readonly membershipRevision: number;
  readonly membershipEpoch: number;
  readonly ownerSubject: string;
  readonly workload: typeof Workload.Type;
  readonly expiresAt: number;
};
type MachineLease = Omit<Lease, "workload">;
const denied = () => new VaultError({ reason: "denied" });
const unavailable = () => new VaultError({ reason: "unavailable" });

export class AccountWorkloads extends Context.Service<
  AccountWorkloads,
  {
    readonly prepare: (payload: string, threadId: ThreadId) => Effect.Effect<string, VaultError>;
    readonly accept: (
      payload: string,
      proof: string,
      publisher: AuthenticatedSession,
    ) => Effect.Effect<Lease, VaultError>;
    readonly acceptProvider: (
      payload: string,
      proof: string,
      publisher: AuthenticatedSession,
    ) => Effect.Effect<MachineLease, VaultError>;
    readonly revalidate: (lease: MachineLease) => Effect.Effect<void, VaultError>;
  }
>()("t3/fork/account-access/AccountWorkloads") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService;
  const connection = yield* LibraryConnectionService;
  const library = yield* LibraryPublisher;
  const secrets = yield* ServerSecretStore;
  const sessions = yield* SessionStore;
  const directory = yield* DirectoryService;
  const reach = yield* ReachStore;
  const random = yield* SecureRandom.SecureRandom;
  const digest = yield* Digest.Digest;
  const signature = yield* Signature.Signature;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const used = new Map<string, number>();
  const hash = Effect.fn("AccountWorkloads.hash")(function* (payload: string) {
    const bytes = new TextEncoder().encode(payload);
    if (bytes.length > MAX_PAYLOAD_BYTES) return yield* new VaultError({ reason: "invalid-input" });
    return Hex.encode(
      yield* digest.digest(Digest.sha256, bytes).pipe(Effect.mapError(unavailable)),
    );
  });
  const active = Effect.fn("AccountWorkloads.active")(function* (sessionId: AuthSessionId) {
    const chain = yield* sessions.renewalsOf(sessionId);
    const live = yield* sessions.listActive().pipe(Effect.mapError(unavailable));
    const now = yield* Clock.currentTimeMillis;
    if (
      !live.some(
        (session) => chain.has(session.sessionId) && session.expiresAt.epochMilliseconds > now,
      )
    )
      return yield* denied();
  });
  const revalidate = Effect.fn("AccountWorkloads.revalidate")(function* (lease: MachineLease) {
    if (lease.expiresAt <= (yield* Clock.currentTimeMillis)) return yield* denied();
    const info = yield* library.info.pipe(Effect.mapError(unavailable));
    if (
      !info.isAuthority ||
      info.environmentId !== environmentId ||
      info.authorityId !== lease.authorityId ||
      info.authorityEpoch !== lease.authorityEpoch
    )
      return yield* denied();
    yield* active(lease.publisherSessionId);
    const pin = yield* directory
      .pinned(lease.sourceEnvironmentId)
      .pipe(Effect.mapError(unavailable));
    const computer = (yield* reach.read.pipe(Effect.mapError(unavailable))).computers[
      lease.sourceEnvironmentId
    ];
    if (
      pin?.keyFingerprint !== lease.keyFingerprint ||
      computer?.keyFingerprint !== lease.keyFingerprint ||
      computer.account?.state !== "active" ||
      computer.account.approvedAt !== lease.membershipRevision ||
      computer.account.epoch !== lease.membershipEpoch ||
      computer.account.ownerSubject !== lease.ownerSubject ||
      computer.account.authorityId !== lease.authorityId ||
      computer.account.authorityEpoch !== lease.authorityEpoch
    )
      return yield* denied();
  });
  const prepare = Effect.fn("AccountWorkloads.prepare")(function* (
    payload: string,
    threadId: ThreadId,
  ) {
    const destination = yield* connection.current;
    if (
      destination.kind !== "remote" ||
      destination.credential?.sourceEnvironmentId !== environmentId
    )
      return yield* denied();
    const info = yield* library.info.pipe(Effect.mapError(unavailable));
    if (
      !info.isAuthority ||
      info.environmentId !== destination.credential.libraryEnvironmentId ||
      info.environmentId === environmentId ||
      destination.credential.account?.authorityId !== info.authorityId ||
      destination.credential.account.authorityEpoch !== info.authorityEpoch
    )
      return yield* denied();
    const thread = yield* readVaultThreadShell(threads, threadId).pipe(Effect.mapError(denied));
    if (
      !thread ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.activeRunId === null
    )
      return yield* new VaultError({ reason: "denied", detail: "workload-inactive" });
    if (thread.runtimeMode !== "full-access" || thread.interactionMode !== "default")
      return yield* new VaultError({ reason: "denied", detail: "caller-permission" });
    if (!(yield* isVaultRunRunning(threads, thread)))
      return yield* new VaultError({ reason: "denied", detail: "workload-inactive" });
    const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    const keys = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets).pipe(
      Effect.provideService(Signature.Signature, signature),
      Effect.mapError(unavailable),
    );
    const proof = yield* signRelayJwt({
      privateKey: keys.privateKey,
      typ: PROOF_TYPE,
      payload: {
        iss: environmentId,
        sub: environmentId,
        aud: info.environmentId,
        iat: now,
        exp: now + PROOF_SECONDS,
        publisherSessionId: destination.credential.sessionId,
        authorityId: info.authorityId,
        authorityEpoch: info.authorityEpoch,
        nonce: Hex.encode(yield* random.randomBytes(16).pipe(Effect.mapError(unavailable))),
        digest: yield* hash(payload),
        workload: {
          threadId,
          runId: thread.activeRunId,
          projectId: thread.projectId,
          providerInstanceId: thread.providerInstanceId,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
        },
      },
    }).pipe(Effect.provideService(Signature.Signature, signature), Effect.mapError(unavailable));
    const current = yield* readVaultThreadShell(threads, threadId).pipe(Effect.mapError(denied));
    if (
      !current ||
      current.activeRunId !== thread.activeRunId ||
      current.projectId !== thread.projectId ||
      current.providerInstanceId !== thread.providerInstanceId ||
      current.runtimeMode !== thread.runtimeMode ||
      current.interactionMode !== thread.interactionMode ||
      current.archivedAt !== null ||
      current.deletedAt !== null ||
      !(yield* isVaultRunRunning(threads, current))
    )
      return yield* new VaultError({ reason: "denied", detail: "workload-inactive" });
    return proof;
  });
  const accept = Effect.fn("AccountWorkloads.accept")(function* (
    payload: string,
    proof: string,
    publisher: AuthenticatedSession,
  ) {
    if (
      !publisher.subject.startsWith("loom-host:") ||
      publisher.scopes.length !== 1 ||
      publisher.scopes[0] !== AuthLibraryPublishScope
    )
      return yield* denied();
    const sourceEnvironmentId = EnvironmentId.make(publisher.subject.slice("loom-host:".length));
    const pin = yield* directory.pinned(sourceEnvironmentId).pipe(Effect.mapError(unavailable));
    if (!pin || proof.length > 16384) return yield* denied();
    const claims = yield* verifyRelayJwt(Claims, {
      publicKey: `-----BEGIN PUBLIC KEY-----\n${pin.publicKey}\n-----END PUBLIC KEY-----`,
      token: proof,
      typ: PROOF_TYPE,
      issuer: sourceEnvironmentId,
      audience: environmentId,
      maxTokenAge: "30 seconds",
    }).pipe(Effect.provideService(Signature.Signature, signature), Effect.mapError(denied));
    const now = yield* Clock.currentTimeMillis;
    if (
      claims.iat > now / 1000 ||
      claims.exp <= now / 1000 ||
      claims.exp - claims.iat > PROOF_SECONDS ||
      claims.digest !== (yield* hash(payload)) ||
      !/^[a-f0-9]{32}$/u.test(claims.nonce)
    )
      return yield* denied();
    if (!(yield* sessions.renewalsOf(claims.publisherSessionId)).has(publisher.sessionId))
      return yield* denied();
    const computer = (yield* reach.read.pipe(Effect.mapError(unavailable))).computers[
      sourceEnvironmentId
    ];
    if (computer?.account?.state !== "active") return yield* denied();
    const lease = {
      sourceEnvironmentId,
      publisherSessionId: claims.publisherSessionId,
      authorityId: claims.authorityId,
      authorityEpoch: claims.authorityEpoch,
      keyFingerprint: pin.keyFingerprint,
      membershipRevision: computer.account.approvedAt,
      membershipEpoch: computer.account.epoch,
      ownerSubject: computer.account.ownerSubject,
      workload: claims.workload,
      expiresAt: claims.exp * 1000,
    };
    yield* revalidate(lease);
    const replayKey = `${sourceEnvironmentId}:${claims.nonce}`;
    for (const [key, expiry] of used) if (expiry <= now) used.delete(key);
    if (used.has(replayKey) || used.size >= MAX_USED_PROOFS) return yield* denied();
    used.set(replayKey, lease.expiresAt);
    return lease;
  });
  return AccountWorkloads.of({
    prepare,
    accept: Effect.fn("AccountWorkloads.acceptWorkload")(function* (payload, proof, publisher) {
      const lease = yield* accept(payload, proof, publisher);
      if (!lease.workload) return yield* denied();
      return { ...lease, workload: lease.workload };
    }),
    acceptProvider: Effect.fn("AccountWorkloads.acceptProvider")(
      function* (payload, proof, publisher) {
        const lease = yield* accept(payload, proof, publisher);
        if (lease.workload !== undefined) return yield* denied();
        return lease;
      },
    ),
    revalidate,
  });
});

export const layer = Layer.effect(AccountWorkloads, make);
