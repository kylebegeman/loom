import {
  AuthSessionId,
  AuthSettingsWriteScope,
  type ProviderInstanceId,
  type ThreadId,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  LIBRARY_MANAGEMENT_FEATURE,
  LibraryError,
  LibraryManagementActor,
  LibraryManagementDelegation,
  LibraryManagementInvocation,
  LibraryManagementRequest,
  LibraryProject,
  type LibraryManagementEnrollment,
  type LibraryManagementStatus,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  decodeEd25519PublicKey,
  directoryPublicKeyFromPem,
  keyFingerprint,
} from "@t3tools/shared/fork/directory";
import { signRelayJwt, verifyRelayJwt } from "@t3tools/shared/relayJwt";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClientRequest } from "effect/http";
import { SessionStore } from "../../auth/SessionStore.ts";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { isCurrentIdentitySession, identitySessionPrefix } from "../../auth/identityPolicy.ts";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { isVaultRunRunning } from "../vault/active-run.ts";
import { LibraryConnectionService } from "./LibraryConnection.ts";
import { LibraryPublisher } from "./LibraryPublisher.ts";
import { LibraryService } from "./LibraryService.ts";

const DELEGATION_TYP = "loom-project-management-delegation+jwt";
const REQUEST_TYP = "loom-project-management-request+jwt";
const DELEGATION_SECONDS = 30 * 24 * 60 * 60;
const REQUEST_SECONDS = 30;
const SECRET_NAME = "library-project-management";
const delegationCodec = Schema.fromJsonString(LibraryManagementDelegation);
const encodeRequest = Schema.encodeSync(Schema.fromJsonString(LibraryManagementRequest));
const encodeDelegation = Schema.encodeEffect(delegationCodec);
const decodeDelegation = Schema.decodeEffect(delegationCodec);
const decodeInvocation = Schema.decodeUnknownEffect(LibraryManagementInvocation);
const decodeProject = Schema.decodeUnknownEffect(LibraryProject);
const DelegationClaims = Schema.Struct({
  sessionId: AuthSessionId,
  subject: Schema.String,
  sourceEnvironmentId: LibraryManagementDelegation.fields.sourceEnvironmentId,
  libraryEnvironmentId: LibraryManagementDelegation.fields.libraryEnvironmentId,
  authorityId: LibraryManagementDelegation.fields.authorityId,
  authorityEpoch: LibraryManagementDelegation.fields.authorityEpoch,
  keyFingerprint: LibraryManagementDelegation.fields.keyFingerprint,
  exp: Schema.Number,
});
const RequestClaims = Schema.Struct({
  actor: LibraryManagementActor,
  digest: Schema.String,
  delegationDigest: Schema.String,
  authorityId: LibraryManagementDelegation.fields.authorityId,
  authorityEpoch: LibraryManagementDelegation.fields.authorityEpoch,
  iat: Schema.Number,
  exp: Schema.Number,
});
const decodeDelegationClaims = Schema.decodeUnknownEffect(DelegationClaims);
const decodeRequestClaims = Schema.decodeUnknownEffect(RequestClaims);
const decodeErrorResponse = Schema.decodeUnknownEffect(
  Schema.Struct({ reason: LibraryError.fields.reason, detail: LibraryError.fields.detail }),
);
const deny = (detail = "This caller is not authorized to manage shared projects.") =>
  new LibraryError({ reason: "blocked", detail });
const unavailable = () => new LibraryError({ reason: "io" });
const unconfirmed = () =>
  new LibraryError({
    reason: "io",
    detail:
      "Loom could not confirm the Library response. Retry the identical request with the same requestId; it may already have applied.",
  });
const SIGN_IN_ENDED =
  "The Library sign-in that authorized project management has expired or been revoked. Sign in again to that Library connection; publishing enrollment is still separate.";
const UNSUPPORTED =
  "This Library version does not support agent project management. Update Loom on the Library before retrying; this computer's enrollment does not need replacing.";
const DELEGATION_MISSING =
  "This computer has no current project-management delegation from your Library. Loom establishes it through your signed-in Library connection automatically.";
const fenceMatches = (
  a: { authorityId: string; authorityEpoch: number },
  b: { authorityId: string; authorityEpoch: number },
) => a.authorityId === b.authorityId && a.authorityEpoch === b.authorityEpoch;

export class LibraryManagement extends Context.Service<
  LibraryManagement,
  {
    readonly status: Effect.Effect<LibraryManagementStatus, LibraryError>;
    readonly issue: (
      input: LibraryManagementEnrollment,
      session: AuthenticatedSession,
    ) => Effect.Effect<LibraryManagementDelegation, LibraryError>;
    readonly install: (
      delegation: LibraryManagementDelegation,
    ) => Effect.Effect<void, LibraryError>;
    readonly execute: (
      request: LibraryManagementRequest,
      actor: LibraryManagementActor,
    ) => Effect.Effect<LibraryProject, LibraryError>;
    readonly executeAgent: (
      request: LibraryManagementRequest,
      caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
    ) => Effect.Effect<LibraryProject, LibraryError>;
    readonly accept: (
      input: LibraryManagementInvocation,
      source: EnvironmentId,
    ) => Effect.Effect<LibraryProject, LibraryError>;
  }
>()("t3/fork/project-library/LibraryManagement") {}

const make = Effect.gen(function* () {
  const library = yield* LibraryService;
  const publisher = yield* LibraryPublisher;
  const connection = yield* LibraryConnectionService;
  const secrets = yield* ServerSecretStore;
  const sessions = yield* SessionStore;
  const directory = yield* DirectoryService;
  const threads = yield* ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  const environment = yield* HostProcess.Environment;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const sessionPrefix = identitySessionPrefix(environment);
  const keys = getOrCreateEnvironmentKeyPairFromSecretStore(secrets).pipe(
    Effect.mapError(unavailable),
  );
  const fingerprint = Effect.gen(function* () {
    const publicKey = directoryPublicKeyFromPem((yield* keys).publicKey);
    const der = publicKey === null ? null : decodeEd25519PublicKey(publicKey);
    if (der === null) return yield* unavailable();
    return keyFingerprint(der);
  });
  const digest = Effect.fn("LibraryManagement.digest")(function* (text: string) {
    return Hex.encode(
      yield* crypto
        .digest("SHA-256", new TextEncoder().encode(text))
        .pipe(Effect.mapError(unavailable)),
    );
  });
  const currentSession = Effect.fn("LibraryManagement.currentSession")(function* (
    id: AuthSessionId,
  ) {
    const chain = yield* sessions.renewalsOf(id);
    const active = yield* sessions.listActive().pipe(Effect.mapError(unavailable));
    const now = yield* Clock.currentTimeMillis;
    return active.find(
      (session) =>
        chain.has(session.sessionId) &&
        session.expiresAt.epochMilliseconds > now &&
        isCurrentIdentitySession(session.subject, sessionPrefix),
    );
  });
  const managementSession = Effect.fn("LibraryManagement.managementSession")(function* (
    id: AuthSessionId,
  ) {
    const session = yield* currentSession(id);
    if (!session) return yield* deny(SIGN_IN_ENDED);
    if (
      !(session.permissions ?? session.scopes).includes(AuthSettingsWriteScope) ||
      session.subject === "mcp-client" ||
      session.subject.startsWith("loom-host:")
    )
      return yield* deny();
    return session;
  });
  const readDelegation = secrets.get(SECRET_NAME).pipe(
    Effect.mapError(unavailable),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(null),
        onSome: (bytes) =>
          decodeDelegation(new TextDecoder().decode(bytes)).pipe(Effect.mapError(unavailable)),
      }),
    ),
  );
  const dispatch = Effect.fn("LibraryManagement.dispatch")(function* (
    request: LibraryManagementRequest,
  ) {
    switch (request.kind) {
      case "create":
        return yield* library.createProject(request.input);
      case "update":
        return yield* library.updateProject(request.input);
      case "archive":
        return yield* library.archiveProject(request.input);
    }
  });
  const authorizeActor = Effect.fn("LibraryManagement.authorizeActor")(function* (
    actor: LibraryManagementActor,
  ) {
    if (actor.kind === "client") {
      yield* managementSession(actor.sessionId);
      return;
    }
    const thread = yield* threads.getThreadShell(actor.threadId).pipe(Effect.mapError(unavailable));
    if (
      !thread ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.activeRunId !== actor.runId ||
      thread.providerInstanceId !== actor.providerInstanceId ||
      !(yield* isVaultRunRunning(threads, thread).pipe(Effect.mapError(() => deny())))
    )
      return yield* deny(
        "This agent turn has ended or changed. Project management requires its current active turn.",
      );
    if (thread.runtimeMode !== "full-access" || thread.interactionMode !== "default")
      return yield* deny("Project management requires an active full-access/default agent turn.");
  });
  const issue = Effect.fn("LibraryManagement.issue")(function* (
    input: LibraryManagementEnrollment,
    session: AuthenticatedSession,
  ) {
    const info = yield* library.info;
    if (!info.isAuthority) return yield* new LibraryError({ reason: "not-authority" });
    const current = yield* managementSession(session.sessionId);
    if (current.subject !== session.subject || !session.scopes.includes(AuthSettingsWriteScope))
      return yield* deny();
    const pin = yield* directory.pinned(input.environmentId).pipe(Effect.mapError(unavailable));
    if (pin === null || pin.keyFingerprint !== input.keyFingerprint)
      return yield* deny(
        "The Library has no matching enrolled signing key for this computer. Project management was not delegated.",
      );
    const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    const claims = {
      sessionId: current.sessionId,
      subject: current.subject,
      sourceEnvironmentId: input.environmentId,
      libraryEnvironmentId: environmentId,
      authorityId: info.authorityId,
      authorityEpoch: info.authorityEpoch,
      keyFingerprint: pin.keyFingerprint,
      exp: now + DELEGATION_SECONDS,
    };
    const token = yield* signRelayJwt({
      privateKey: (yield* keys).privateKey,
      typ: DELEGATION_TYP,
      payload: {
        ...claims,
        iss: environmentId,
        sub: input.environmentId,
        aud: input.environmentId,
        iat: now,
      },
    }).pipe(Effect.mapError(unavailable));
    return {
      token,
      sourceEnvironmentId: input.environmentId,
      libraryEnvironmentId: environmentId,
      authorityId: info.authorityId,
      authorityEpoch: info.authorityEpoch,
      keyFingerprint: pin.keyFingerprint,
      expiresAt: claims.exp * 1000,
    };
  });
  const install = Effect.fn("LibraryManagement.install")(function* (
    delegation: LibraryManagementDelegation,
  ) {
    const info = yield* publisher.info;
    if (
      delegation.sourceEnvironmentId !== environmentId ||
      delegation.libraryEnvironmentId !== info.environmentId ||
      !fenceMatches(delegation, info) ||
      delegation.keyFingerprint !== (yield* fingerprint) ||
      delegation.expiresAt <= (yield* Clock.currentTimeMillis)
    )
      return yield* deny(
        "This project-management delegation belongs to another computer or Library, or has expired.",
      );
    yield* secrets
      .set(
        SECRET_NAME,
        new TextEncoder().encode(
          yield* encodeDelegation(delegation).pipe(Effect.mapError(unavailable)),
        ),
      )
      .pipe(Effect.mapError(unavailable));
  });
  const accept = Effect.fn("LibraryManagement.accept")(function* (
    untrusted: LibraryManagementInvocation,
    source: EnvironmentId,
  ) {
    const input = yield* decodeInvocation(untrusted).pipe(Effect.mapError(() => deny()));
    const info = yield* library.info;
    if (!info.isAuthority) return yield* new LibraryError({ reason: "not-authority" });
    if (input.sourceEnvironmentId !== source || !fenceMatches(info, input))
      return yield* deny(
        "The project-management request targets a different Library authority revision.",
      );
    const now = (yield* Clock.currentTimeMillis) / 1000;
    const grant = yield* verifyRelayJwt({
      publicKey: (yield* keys).publicKey,
      token: input.delegation,
      typ: DELEGATION_TYP,
      issuer: environmentId,
      audience: source,
      nowEpochSeconds: now,
      maxTokenAge: DELEGATION_SECONDS,
    }).pipe(
      Effect.flatMap(decodeDelegationClaims),
      Effect.mapError(() =>
        deny("The Library project-management delegation is invalid or expired."),
      ),
    );
    if (
      grant.sourceEnvironmentId !== source ||
      grant.libraryEnvironmentId !== environmentId ||
      !fenceMatches(grant, info) ||
      grant.exp <= now
    )
      return yield* deny();
    const owner = yield* managementSession(grant.sessionId);
    if (owner.subject !== grant.subject) return yield* deny();
    const pin = yield* directory.pinned(source).pipe(Effect.mapError(unavailable));
    if (pin === null || pin.keyFingerprint !== grant.keyFingerprint)
      return yield* deny(
        "This computer's enrolled signing key no longer matches its project-management delegation.",
      );
    const proof = yield* verifyRelayJwt({
      publicKey: `-----BEGIN PUBLIC KEY-----\n${pin.publicKey}\n-----END PUBLIC KEY-----`,
      token: input.proof,
      typ: REQUEST_TYP,
      issuer: source,
      audience: environmentId,
      nowEpochSeconds: now,
      maxTokenAge: REQUEST_SECONDS,
    }).pipe(
      Effect.flatMap(decodeRequestClaims),
      Effect.mapError(() => deny("The signed project-management request is invalid or expired.")),
    );
    if (
      !fenceMatches(proof, info) ||
      proof.iat > now ||
      proof.exp <= now ||
      proof.exp - proof.iat > REQUEST_SECONDS ||
      proof.digest !== (yield* digest(encodeRequest(input.request))) ||
      proof.delegationDigest !== (yield* digest(input.delegation))
    )
      return yield* deny();
    return yield* dispatch(input.request);
  });
  const execute = Effect.fn("LibraryManagement.execute")(function* (
    request: LibraryManagementRequest,
    actor: LibraryManagementActor,
  ) {
    yield* authorizeActor(actor);
    const destination = yield* connection.current;
    if (destination.kind === "authority") return yield* dispatch(request);
    if (destination.kind !== "remote") {
      if (destination.kind === "unavailable") {
        const status = yield* connection.status;
        if (status.state === "expired")
          return yield* deny(
            `This computer's Library enrollment expired at ${status.expiresAt}. Automatic renewal did not complete.`,
          );
      }
      return yield* deny(
        "This computer's enrolled Library connection is unavailable. Project management has not been attempted.",
      );
    }
    const info = yield* publisher.info;
    if (!info.features?.includes(LIBRARY_MANAGEMENT_FEATURE)) return yield* deny(UNSUPPORTED);
    const delegation = yield* readDelegation;
    if (delegation === null || delegation.expiresAt <= (yield* Clock.currentTimeMillis))
      return yield* deny(DELEGATION_MISSING);
    if (
      delegation.libraryEnvironmentId !== info.environmentId ||
      !fenceMatches(delegation, info) ||
      delegation.keyFingerprint !== (yield* fingerprint)
    )
      return yield* deny(
        "The computer's project-management delegation no longer matches this Library or signing key.",
      );
    const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    const proof = yield* signRelayJwt({
      privateKey: (yield* keys).privateKey,
      typ: REQUEST_TYP,
      payload: {
        iss: environmentId,
        sub: environmentId,
        aud: info.environmentId,
        iat: now,
        exp: now + REQUEST_SECONDS,
        authorityId: info.authorityId,
        authorityEpoch: info.authorityEpoch,
        actor,
        digest: yield* digest(encodeRequest(request)),
        delegationDigest: yield* digest(delegation.token),
      },
    }).pipe(Effect.mapError(unavailable));
    // Recheck after preparing the signed request so a changed turn cannot send its proof.
    yield* authorizeActor(actor);
    const response = yield* connection
      .send(
        HttpClientRequest.post(destination.endpoint("/api/loom/library/projects/manage")).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            sourceEnvironmentId: environmentId,
            authorityId: info.authorityId,
            authorityEpoch: info.authorityEpoch,
            delegation: delegation.token,
            proof,
            request,
          }),
        ),
      )
      .pipe(
        Effect.timeout("30 seconds"),
        Effect.mapError((error) =>
          error._tag === "LibraryError" && error.reason !== "io" ? error : unconfirmed(),
        ),
      );
    if (response.status === 401)
      return yield* deny(
        "This computer's Library enrollment has expired or been revoked. Project management has not been authorized.",
      );
    if (response.status === 403 && !response.headers["content-type"]?.includes("application/json"))
      return yield* deny();
    if (
      response.status === 404 ||
      (response.status === 200 && !response.headers["content-type"]?.includes("application/json"))
    )
      return yield* deny(UNSUPPORTED);
    if (!response.headers["content-type"]?.includes("application/json"))
      return yield* unconfirmed();
    const body = yield* response.json.pipe(Effect.mapError(unconfirmed));
    if (response.status !== 200) {
      const error = yield* decodeErrorResponse(body).pipe(Effect.mapError(unavailable));
      return yield* new LibraryError(error);
    }
    return yield* decodeProject(body).pipe(Effect.mapError(unavailable));
  });
  const executeAgent = Effect.fn("LibraryManagement.executeAgent")(function* (
    request: LibraryManagementRequest,
    caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
  ) {
    const thread = yield* threads
      .getThreadShell(caller.threadId)
      .pipe(Effect.mapError(unavailable));
    if (!thread?.activeRunId)
      return yield* deny("This agent turn has ended. Project management requires an active turn.");
    return yield* execute(request, { ...caller, kind: "agent", runId: thread.activeRunId });
  });
  const status = Effect.gen(function* () {
    const destination = yield* connection.current;
    const base = { environmentId, keyFingerprint: yield* fingerprint, expiresAt: null };
    if (destination.kind === "authority") return { ...base, state: "ready" as const };
    if (destination.kind !== "remote") return { ...base, state: "missing" as const };
    const info = yield* publisher.info;
    if (!info.features?.includes(LIBRARY_MANAGEMENT_FEATURE))
      return { ...base, state: "unsupported" as const };
    const delegation = yield* readDelegation;
    return {
      ...base,
      state:
        delegation !== null &&
        delegation.expiresAt > (yield* Clock.currentTimeMillis) &&
        delegation.libraryEnvironmentId === info.environmentId &&
        fenceMatches(delegation, info) &&
        delegation.keyFingerprint === base.keyFingerprint
          ? ("ready" as const)
          : ("missing" as const),
      expiresAt: delegation?.expiresAt ?? null,
    };
  });
  return LibraryManagement.of({ status, issue, install, execute, executeAgent, accept });
});
export const layer = Layer.effect(LibraryManagement, make);
