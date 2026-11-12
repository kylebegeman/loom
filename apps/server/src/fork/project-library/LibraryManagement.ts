import * as Signature from "effect/crypto/Signature";
import {
  AuthSessionId,
  AuthSettingsWriteScope,
  AuthOrchestrationReadScope,
  type ProviderInstanceId,
  type ThreadId,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  LIBRARY_MANAGEMENT_FEATURE,
  PROJECT_ECOSYSTEM_FEATURE,
  LIBRARY_SITES_FEATURE,
  type LibrarySitesMutation,
  SitesSnapshot,
  SitesError,
  LibraryError,
  LibraryApiCatalog,
  type LibraryApiRequest,
  LIBRARY_API_FEATURE,
  LibraryManagementActor,
  LibraryManagementDelegation,
  LibraryManagementInvocation,
  LibraryManagementRequest,
  LibraryProject,
  LibraryWorkstream,
  type LibrarySaveWorkstream,
  type LibraryProjectManagementRequest,
  type LibraryManagementEnrollment,
  type LibraryManagementStatus,
  type LibraryAccessRepair,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  decodeEd25519PublicKey,
  directoryPublicKeyFromPem,
  keyFingerprint,
} from "@t3tools/shared/fork/directory";
import { signRelayJwt as signRelayJwtEffect } from "@t3tools/shared/relayJwt";
import { verifyRelayJwt as verifyRelayJwtEffect } from "@t3tools/shared/fork/relayJwt";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
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
import { getOrCreateEnvironmentKeyPairFromSecretStore as getOrCreateEnvironmentKeyPairFromSecretStoreEffect } from "../../cloud/environmentKeys.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { isVaultRunRunning } from "../vault/active-run.ts";
import { LibraryConnectionService } from "./LibraryConnection.ts";
import * as LibraryApis from "./LibraryApiWorkspaces.ts";
import { ProjectWorkflows } from "./ProjectWorkflows.ts";
import { LibraryPublisher } from "./LibraryPublisher.ts";
import { LibraryService } from "./LibraryService.ts";
import * as SitesService from "../sites/SitesService.ts";

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
const decodeWorkstream = Schema.decodeUnknownEffect(LibraryWorkstream);
const decodeProject = Schema.decodeUnknownEffect(LibraryProject);
const decodeSitesSnapshot = Schema.decodeUnknownEffect(SitesSnapshot);
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
const isLibraryError = Schema.is(LibraryError);
const decodeErrorResponse = Schema.decodeUnknownEffect(
  Schema.Struct({
    reason: LibraryError.fields.reason,
    detail: LibraryError.fields.detail,
    accessRepair: LibraryError.fields.accessRepair,
  }),
);
const deny = (
  detail = "This caller is not authorized to manage shared projects.",
  kind: LibraryAccessRepair["kind"] = "permission",
  environmentId?: EnvironmentId,
) =>
  new LibraryError({
    reason: "blocked",
    detail,
    accessRepair: { kind, ...(environmentId === undefined ? {} : { environmentId }) },
  });
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
    readonly authorizeEnrollment: (
      session: AuthenticatedSession,
      access?: "read" | "write",
    ) => Effect.Effect<void, LibraryError>;
    readonly issue: (
      input: LibraryManagementEnrollment,
      session: AuthenticatedSession,
    ) => Effect.Effect<LibraryManagementDelegation, LibraryError>;
    readonly install: (
      delegation: LibraryManagementDelegation,
    ) => Effect.Effect<void, LibraryError>;
    readonly execute: (
      request: LibraryProjectManagementRequest,
      actor: LibraryManagementActor,
    ) => Effect.Effect<LibraryProject, LibraryError>;
    readonly executeAgent: (
      request: LibraryProjectManagementRequest,
      caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
    ) => Effect.Effect<LibraryProject, LibraryError>;
    readonly apiWorkspace: (
      input: LibraryApiRequest,
      actor: LibraryManagementActor,
    ) => Effect.Effect<LibraryApiCatalog, LibraryError>;
    readonly apiWorkspaceAgent: (
      input: LibraryApiRequest,
      caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
    ) => Effect.Effect<LibraryApiCatalog, LibraryError>;
    readonly sites: (
      input: LibrarySitesMutation,
      actor: LibraryManagementActor,
      authorize?: Effect.Effect<void, LibraryError>,
    ) => Effect.Effect<SitesSnapshot, LibraryError>;
    readonly sitesAgent: (
      input: LibrarySitesMutation,
      caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
      authorize?: Effect.Effect<void, LibraryError>,
    ) => Effect.Effect<SitesSnapshot, LibraryError>;
    readonly saveWorkstream: (
      input: LibrarySaveWorkstream,
      actor: LibraryManagementActor,
    ) => Effect.Effect<LibraryWorkstream, LibraryError>;
    readonly saveWorkstreamAgent: (
      input: LibrarySaveWorkstream,
      caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
    ) => Effect.Effect<LibraryWorkstream, LibraryError>;
    readonly accept: (
      input: LibraryManagementInvocation,
      source: EnvironmentId,
    ) => Effect.Effect<
      LibraryProject | LibraryWorkstream | LibraryApiCatalog | SitesSnapshot,
      LibraryError
    >;
  }
>()("t3/fork/project-library/LibraryManagement") {}

const make = Effect.gen(function* () {
  const signature = yield* Signature.Signature;
  const signRelayJwt = (...args: Parameters<typeof signRelayJwtEffect>) =>
    signRelayJwtEffect(...args).pipe(Effect.provideService(Signature.Signature, signature));
  const verifyRelayJwt = (...args: Parameters<typeof verifyRelayJwtEffect>) =>
    verifyRelayJwtEffect(...args).pipe(Effect.provideService(Signature.Signature, signature));
  const getOrCreateEnvironmentKeyPairFromSecretStore = (
    ...args: Parameters<typeof getOrCreateEnvironmentKeyPairFromSecretStoreEffect>
  ) =>
    getOrCreateEnvironmentKeyPairFromSecretStoreEffect(...args).pipe(
      Effect.provideService(Signature.Signature, signature),
    );
  const library = yield* LibraryService;
  const sites = yield* SitesService.SitesService;
  const apis = yield* Effect.serviceOption(LibraryApis.LibraryApiWorkspaces);
  const workflows = yield* ProjectWorkflows;
  const publisher = yield* LibraryPublisher;
  const connection = yield* LibraryConnectionService;
  const secrets = yield* ServerSecretStore;
  const sessions = yield* SessionStore;
  const directory = yield* DirectoryService;
  const threads = yield* ThreadManagementService;
  const crypto = yield* Digest.Digest;
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
        .digest(Digest.sha256, new TextEncoder().encode(text))
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
    scope:
      | typeof AuthOrchestrationReadScope
      | typeof AuthSettingsWriteScope = AuthSettingsWriteScope,
  ) {
    const session = yield* currentSession(id);
    if (!session) return yield* deny(SIGN_IN_ENDED, "sign-in", environmentId);
    if (
      !(session.permissions ?? session.scopes).includes(scope) ||
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
    authorize: Effect.Effect<void, LibraryError> = Effect.void,
  ) {
    switch (request.kind) {
      case "create":
        return yield* library.createProject(request.input);
      case "update":
        return yield* library.updateProject(request.input);
      case "archive":
        return yield* library.archiveProject(request.input);
      case "apply-blueprint":
        return yield* workflows.applyBlueprint(request.input);
      case "api-workspace":
        if (Option.isNone(apis))
          return yield* new LibraryError({
            reason: "blocked",
            detail: "This Library version does not support shared API workspaces.",
          });
        return yield* apis.value.execute(request.input);
      case "save-workstream":
        return yield* workflows.saveWorkstream(request.input);
      case "sites": {
        const check = authorize.pipe(
          Effect.mapError((cause) => new SitesError({ stage: "permission", cause })),
        );
        const input = request.input;
        const write =
          input.action === "runChecks"
            ? sites.runChecks(check, input.input)
            : input.action === "saveSite"
              ? sites.saveSite(input.input, check)
              : input.action === "saveService"
                ? sites.saveService(input.input, check)
                : sites.saveCheck(input.input, check);
        return yield* write.pipe(
          Effect.mapError(
            (cause) =>
              new LibraryError({
                reason:
                  cause.stage === "revision-conflict" || cause.stage === "request-conflict"
                    ? cause.stage
                    : cause.stage === "authentication" || cause.stage === "permission"
                      ? "blocked"
                      : cause.stage === "validation" || cause.stage === "revision-required"
                        ? "invalid"
                        : cause.stage === "project"
                          ? "not-found"
                          : "io",
                detail: cause.message,
                cause,
              }),
          ),
        );
      }
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
  const authorizeEnrollment = Effect.fn("LibraryManagement.authorizeEnrollment")(function* (
    session: AuthenticatedSession,
    access: "read" | "write" = "write",
  ) {
    if (!(yield* library.info).isAuthority)
      return yield* new LibraryError({ reason: "not-authority" });
    const scope = access === "read" ? AuthOrchestrationReadScope : AuthSettingsWriteScope;
    const current = yield* managementSession(session.sessionId, scope);
    if (current.subject !== session.subject || !session.scopes.includes(scope))
      return yield* deny();
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
    return yield* dispatch(input.request, managementSession(grant.sessionId).pipe(Effect.asVoid));
  });
  const send = Effect.fn("LibraryManagement.send")(function* <A>(
    request: LibraryManagementRequest,
    actor: LibraryManagementActor,
    decode: (value: unknown) => Effect.Effect<A, Schema.SchemaError>,
    authorize: Effect.Effect<void, LibraryError> = Effect.void,
  ) {
    yield* authorizeActor(actor);
    yield* authorize;
    const responseUnconfirmed =
      request.kind === "sites"
        ? () => {
            const requestId = request.input.input?.requestId;
            const cause = new SitesError({
              stage: "unknown-outcome",
              ...(requestId ? { requestId } : {}),
            });
            return new LibraryError({ reason: "io", detail: cause.message, cause });
          }
        : unconfirmed;
    const destination = yield* connection.current;
    if (destination.kind === "authority")
      return yield* dispatch(request, authorizeActor(actor).pipe(Effect.andThen(authorize))).pipe(
        Effect.flatMap(decode),
        Effect.mapError((error) => (isLibraryError(error) ? error : unavailable())),
      );
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
        "connection",
      );
    }
    const info = yield* publisher.info;
    if (!info.features?.includes(LIBRARY_MANAGEMENT_FEATURE)) return yield* deny(UNSUPPORTED);
    if (
      (request.kind === "create" || request.kind === "update") &&
      request.input.dependencies !== undefined &&
      !info.features?.includes(PROJECT_ECOSYSTEM_FEATURE)
    )
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "Update Loom on the Library to save project dependencies. Keep this computer enrolled.",
        accessRepair: { kind: "connection", environmentId: info.environmentId },
      });
    if (request.kind === "api-workspace" && !info.features?.includes(LIBRARY_API_FEATURE))
      return yield* deny(
        "Update Loom on the Library to share API workspaces. The existing connection can stay enrolled.",
      );
    if (request.kind === "sites" && !info.features?.includes(LIBRARY_SITES_FEATURE))
      return yield* deny(
        "Update Loom on the Library to manage Sites from agents. Keep this computer enrolled.",
      );
    const delegation = yield* readDelegation;
    if (delegation === null || delegation.expiresAt <= (yield* Clock.currentTimeMillis))
      return yield* deny(DELEGATION_MISSING, "connection");
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
    yield* authorize;
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
        Effect.timeout(request.kind === "sites" ? "120 seconds" : "30 seconds"),
        Effect.mapError((error) =>
          error._tag === "LibraryError" && error.reason !== "io" ? error : responseUnconfirmed(),
        ),
      );
    if (response.status === 401)
      return yield* deny(
        "This computer's Library enrollment has expired or been revoked. Project management has not been authorized.",
        "connection",
      );
    if (response.status === 403 && !response.headers["content-type"]?.includes("application/json"))
      return yield* deny();
    if (
      response.status === 404 ||
      (response.status === 200 && !response.headers["content-type"]?.includes("application/json"))
    )
      return yield* deny(UNSUPPORTED);
    if (!response.headers["content-type"]?.includes("application/json"))
      return yield* responseUnconfirmed();
    const body = yield* response.json.pipe(Effect.mapError(responseUnconfirmed));
    if (response.status !== 200) {
      const error = yield* decodeErrorResponse(body).pipe(Effect.mapError(unavailable));
      return yield* new LibraryError(error);
    }
    return yield* decode(body).pipe(Effect.mapError(unavailable));
  });
  const execute = Effect.fn("LibraryManagement.execute")(
    (request: LibraryProjectManagementRequest, actor: LibraryManagementActor) =>
      send(request, actor, decodeProject),
  );
  const saveWorkstream = Effect.fn("LibraryManagement.saveWorkstream")(
    (input: LibrarySaveWorkstream, actor: LibraryManagementActor) =>
      send({ kind: "save-workstream", input }, actor, decodeWorkstream),
  );
  const agentActor = Effect.fn("LibraryManagement.agentActor")(function* (caller: {
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
  }) {
    const thread = yield* threads
      .getThreadShell(caller.threadId)
      .pipe(Effect.mapError(unavailable));
    if (!thread?.activeRunId)
      return yield* deny("This agent turn has ended. Project management requires an active turn.");
    return { ...caller, kind: "agent" as const, runId: thread.activeRunId };
  });
  const executeAgent = Effect.fn("LibraryManagement.executeAgent")(function* (
    request: LibraryProjectManagementRequest,
    caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
  ) {
    return yield* execute(request, yield* agentActor(caller));
  });
  const saveWorkstreamAgent = Effect.fn("LibraryManagement.saveWorkstreamAgent")(function* (
    input: LibrarySaveWorkstream,
    caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
  ) {
    return yield* saveWorkstream(input, yield* agentActor(caller));
  });
  const apiWorkspace = Effect.fn("LibraryManagement.apiWorkspace")(
    (input: LibraryApiRequest, actor: LibraryManagementActor) =>
      send({ kind: "api-workspace", input }, actor, Schema.decodeUnknownEffect(LibraryApiCatalog)),
  );
  const apiWorkspaceAgent = Effect.fn("LibraryManagement.apiWorkspaceAgent")(function* (
    input: LibraryApiRequest,
    caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
  ) {
    return yield* apiWorkspace(input, yield* agentActor(caller));
  });
  const manageSites = Effect.fn("LibraryManagement.sites")(function* (
    input: LibrarySitesMutation,
    actor: LibraryManagementActor,
    authorize?: Effect.Effect<void, LibraryError>,
  ) {
    const destination = yield* connection.current;
    if (destination.kind === "authority" || destination.kind === "none")
      return yield* dispatch({ kind: "sites", input }, authorize ?? authorizeActor(actor)).pipe(
        Effect.flatMap(decodeSitesSnapshot),
        Effect.mapError((cause) => (isLibraryError(cause) ? cause : unavailable())),
      );
    return yield* send({ kind: "sites", input }, actor, decodeSitesSnapshot, authorize);
  });
  const sitesAgent = Effect.fn("LibraryManagement.sitesAgent")(function* (
    input: LibrarySitesMutation,
    caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
    authorize?: Effect.Effect<void, LibraryError>,
  ) {
    return yield* manageSites(input, yield* agentActor(caller), authorize);
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
  return LibraryManagement.of({
    status,
    authorizeEnrollment,
    issue,
    install,
    execute,
    executeAgent,
    apiWorkspace,
    apiWorkspaceAgent,
    sites: manageSites,
    sitesAgent,
    saveWorkstream,
    saveWorkstreamAgent,
    accept,
  });
});
export const layer = Layer.effect(LibraryManagement, make);
