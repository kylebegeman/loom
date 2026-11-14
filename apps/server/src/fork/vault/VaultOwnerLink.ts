import {
  AuthLibraryPublishScope,
  AuthStandardClientScopes,
  AuthVaultWriteScope,
} from "@t3tools/contracts";
import {
  VaultError,
  VaultOwnerLinkRequest,
  VaultOwnerLinkApproval,
  VaultOwnerLinkVerification,
  VAULT_OWNER_LINK_VERIFY_ROUTE,
  type VaultPolicySnapshot,
} from "@t3tools/contracts/fork";
import { decodeEd25519PublicKey, keyFingerprint } from "@t3tools/shared/fork/directory";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClientRequest } from "effect/http";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { identityAccountFromSession, identityOwnershipSubject } from "../../auth/identityPolicy.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { DirectoryReporter } from "../directory/DirectoryReporter.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { LibraryService } from "../project-library/LibraryService.ts";
import { ReachStore } from "../reach/library/ReachStore.ts";
import { VaultAccess } from "./VaultAccess.ts";

const APPROVAL_LIFETIME_MS = 300_000;
const MAX_PENDING_APPROVALS = 128;
const decodeRequest = Schema.decodeUnknownEffect(VaultOwnerLinkRequest);
const decodeApproval = Schema.decodeUnknownEffect(VaultOwnerLinkApproval);
const decodeVerification = Schema.decodeUnknownEffect(VaultOwnerLinkVerification);
const encodeRequest = Schema.encodeSync(Schema.fromJsonString(VaultOwnerLinkRequest));
const encodeApproval = Schema.encodeEffect(Schema.fromJsonString(VaultOwnerLinkApproval));
const denied = () => new VaultError({ reason: "denied" });
const unavailable = () => new VaultError({ reason: "unavailable" });
const human = (session: AuthenticatedSession) =>
  !/^(thread:|client:|broker:|host:|library:|loom-host:|mcp-client$)/.test(session.subject) &&
  AuthStandardClientScopes.every((scope) => session.scopes.includes(scope));

export class VaultOwnerLink extends Context.Service<
  VaultOwnerLink,
  {
    readonly prepare: (
      operationId: string,
      session: AuthenticatedSession,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultOwnerLinkRequest, VaultError>;
    readonly approve: (
      input: VaultOwnerLinkRequest,
      session: AuthenticatedSession,
    ) => Effect.Effect<VaultOwnerLinkApproval, VaultError>;
    readonly verify: (
      input: VaultOwnerLinkApproval,
      publisher: AuthenticatedSession,
    ) => Effect.Effect<VaultOwnerLinkVerification, VaultError>;
    readonly apply: (
      input: VaultOwnerLinkApproval,
      session: AuthenticatedSession,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultPolicySnapshot, VaultError>;
  }
>()("t3/fork/vault/VaultOwnerLink") {}

const make = Effect.gen(function* () {
  const access = yield* VaultAccess;
  const reach = yield* ReachStore;
  const management = yield* LibraryManagement;
  const library = yield* LibraryService;
  const publisher = yield* LibraryPublisher;
  const connection = yield* LibraryConnectionService;
  const directory = yield* DirectoryService;
  const reporter = yield* DirectoryReporter;
  const sessions = yield* SessionStore;
  const environment = yield* HostProcess.Environment;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const random = yield* SecureRandom.SecureRandom;
  const pending = new Map<
    string,
    {
      readonly request: VaultOwnerLinkRequest;
      readonly session: AuthenticatedSession;
      readonly ownerSubject: string;
      readonly expiresAt: number;
    }
  >();
  const authority = Effect.fn("VaultOwnerLink.authority")(function* (
    request: VaultOwnerLinkRequest,
  ) {
    const info = yield* library.info.pipe(Effect.mapError(unavailable));
    if (
      !info.isAuthority ||
      request.libraryEnvironmentId !== environmentId ||
      request.sourceEnvironmentId === environmentId ||
      request.authorityId !== info.authorityId ||
      request.authorityEpoch !== info.authorityEpoch
    )
      return yield* denied();
    const pin = yield* directory
      .pinned(request.sourceEnvironmentId)
      .pipe(Effect.mapError(unavailable));
    if (!pin || pin.keyFingerprint !== request.keyFingerprint) return yield* denied();
  });
  const ownerSession = Effect.fn("VaultOwnerLink.ownerSession")(function* (
    session: AuthenticatedSession,
  ) {
    const accountOwner = session.scopes.includes(AuthVaultWriteScope);
    if (
      (!human(session) && !accountOwner) ||
      !identityAccountFromSession(session.subject, environment)
    )
      return yield* denied();
    if (!accountOwner) yield* management.authorizeEnrollment(session).pipe(Effect.mapError(denied));
    const chain = yield* sessions.renewalsOf(session.sessionId);
    const active = yield* sessions.listActive().pipe(Effect.mapError(unavailable));
    const now = yield* Clock.currentTimeMillis;
    const current = active.find(
      (candidate) =>
        chain.has(candidate.sessionId) &&
        candidate.subject === session.subject &&
        candidate.expiresAt.epochMilliseconds > now &&
        ((candidate.permissions ?? candidate.scopes).includes(AuthVaultWriteScope) ||
          AuthStandardClientScopes.every((scope) =>
            (candidate.permissions ?? candidate.scopes).includes(scope),
          )),
    );
    if (!current || !identityAccountFromSession(current.subject, environment))
      return yield* denied();
    return identityOwnershipSubject(current.subject, environment);
  });
  const source = Effect.fn("VaultOwnerLink.source")(function* () {
    const current = yield* connection.current.pipe(Effect.mapError(unavailable));
    if (
      current.kind !== "remote" ||
      !current.credential ||
      current.credential.sourceEnvironmentId !== environmentId
    )
      return yield* denied();
    const info = yield* publisher.info.pipe(Effect.mapError(unavailable));
    if (info.environmentId !== current.credential.libraryEnvironmentId) return yield* denied();
    const report = yield* reporter.prepare(current.origin).pipe(Effect.mapError(unavailable));
    const key = decodeEd25519PublicKey(report.request.publicKey);
    if (report.environmentId !== environmentId || key === null) return yield* denied();
    return {
      current,
      binding: {
        sourceEnvironmentId: environmentId,
        libraryEnvironmentId: info.environmentId,
        authorityId: info.authorityId,
        authorityEpoch: info.authorityEpoch,
        keyFingerprint: keyFingerprint(key),
      },
    };
  });
  const verify = Effect.fn("VaultOwnerLink.verify")(function* (
    raw: VaultOwnerLinkApproval,
    caller: AuthenticatedSession,
  ) {
    const input = yield* decodeApproval(raw).pipe(Effect.mapError(denied));
    const entry = pending.get(input.token);
    const now = yield* Clock.currentTimeMillis;
    if (
      !entry ||
      entry.expiresAt <= now ||
      input.expiresAt !== entry.expiresAt ||
      encodeRequest(input.request) !== encodeRequest(entry.request) ||
      caller.subject !== `loom-host:${entry.request.sourceEnvironmentId}` ||
      !caller.scopes.includes(AuthLibraryPublishScope)
    )
      return yield* denied();
    const active = yield* sessions.listActive().pipe(Effect.mapError(unavailable));
    if (
      !active.some(
        (session) =>
          session.sessionId === caller.sessionId &&
          session.subject === caller.subject &&
          session.expiresAt.epochMilliseconds > now &&
          (session.permissions ?? session.scopes).includes(AuthLibraryPublishScope),
      )
    )
      return yield* denied();
    yield* authority(entry.request);
    const ownerSubject = yield* ownerSession(entry.session);
    if (ownerSubject !== entry.ownerSubject) return yield* denied();
    if (input.applied) {
      const approved = {
        environmentId: entry.request.sourceEnvironmentId,
        keyFingerprint: entry.request.keyFingerprint,
        ownerSubject,
      };
      const saved = yield* reach
        .update((state) => ({
          ...state,
          vaultBackend: state.vaultBackend ?? approved,
        }))
        .pipe(Effect.mapError(unavailable));
      if (
        saved.vaultBackend?.environmentId !== approved.environmentId ||
        saved.vaultBackend.keyFingerprint !== approved.keyFingerprint ||
        saved.vaultBackend.ownerSubject !== approved.ownerSubject
      )
        return yield* new VaultError({ reason: "conflict" });
    }
    return { request: entry.request, ownerSubject, expiresAt: entry.expiresAt };
  });
  const remoteVerification = Effect.fn("VaultOwnerLink.remoteVerification")(function* (
    input: VaultOwnerLinkApproval,
  ) {
    const { current, binding } = yield* source();
    if (encodeRequest({ ...input.request, ...binding }) !== encodeRequest(input.request))
      return yield* denied();
    const response = yield* current
      .send(
        HttpClientRequest.post(current.endpoint(VAULT_OWNER_LINK_VERIFY_ROUTE)).pipe(
          HttpClientRequest.bodyText(
            yield* encodeApproval(input).pipe(Effect.mapError(unavailable)),
            "application/json",
          ),
        ),
      )
      .pipe(Effect.mapError(unavailable));
    if (response.status !== 200) return yield* response.status === 403 ? denied() : unavailable();
    const result = yield* response.json.pipe(
      Effect.flatMap(decodeVerification),
      Effect.mapError(unavailable),
    );
    if (
      encodeRequest(result.request) !== encodeRequest(input.request) ||
      result.expiresAt !== input.expiresAt ||
      result.expiresAt <= (yield* Clock.currentTimeMillis)
    )
      return yield* denied();
    return result;
  });
  return VaultOwnerLink.of({
    prepare: Effect.fn("VaultOwnerLink.prepare")(function* (operationId, session, authorize) {
      if (!human(session)) return yield* denied();
      const owner = yield* access.ownerLinkBinding(session.subject, authorize);
      const { binding } = yield* source();
      return yield* decodeRequest({ ...owner, ...binding, operationId }).pipe(
        Effect.mapError(denied),
      );
    }),
    approve: Effect.fn("VaultOwnerLink.approve")(function* (raw, session) {
      const request = yield* decodeRequest(raw).pipe(Effect.mapError(denied));
      const ownerSubject = yield* ownerSession(session);
      yield* authority(request);
      const backend = (yield* reach.read.pipe(Effect.mapError(unavailable))).vaultBackend;
      if (
        backend &&
        (backend.environmentId !== request.sourceEnvironmentId ||
          backend.keyFingerprint !== request.keyFingerprint ||
          backend.ownerSubject !== ownerSubject)
      )
        return yield* new VaultError({ reason: "conflict" });
      const now = yield* Clock.currentTimeMillis;
      for (const [token, entry] of pending) if (entry.expiresAt <= now) pending.delete(token);
      if (pending.size >= MAX_PENDING_APPROVALS) return yield* unavailable();
      const token = Hex.encode(yield* random.randomBytes(32).pipe(Effect.mapError(unavailable)));
      const expiresAt = now + APPROVAL_LIFETIME_MS;
      pending.set(token, { request, session, ownerSubject, expiresAt });
      return { request, token, expiresAt };
    }),
    verify,
    apply: Effect.fn("VaultOwnerLink.apply")(function* (raw, session, authorize) {
      if (!human(session)) return yield* denied();
      const input = yield* decodeApproval(raw).pipe(Effect.mapError(denied));
      yield* authorize;
      const verified = yield* remoteVerification(input);
      const revalidate = authorize.pipe(
        Effect.andThen(remoteVerification(input)),
        Effect.flatMap((current) =>
          current.ownerSubject === verified.ownerSubject ? Effect.void : Effect.fail(denied()),
        ),
      );
      const snapshot = yield* access.linkOwner(
        input.request,
        verified.ownerSubject,
        session.subject,
        revalidate,
      );
      yield* remoteVerification({ ...input, applied: true });
      return snapshot;
    }),
  });
});
export const layer = Layer.effect(VaultOwnerLink, make);
