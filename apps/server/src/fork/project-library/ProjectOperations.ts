import * as VaultGitHub from "../vault/VaultGitHub.ts";
import type { RepositoryAuthorizer } from "../vault/GitHubRepositoryTransport.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  identityOwnershipSubject,
  identitySessionPrefix,
  isCurrentIdentitySession,
} from "../../auth/identityPolicy.ts";
import { ProjectWorkflows } from "./ProjectWorkflows.ts";
import {
  AuthOrchestrationOperateScope,
  AuthSessionId,
  AuthSettingsWriteScope,
  AuthTerminalOperateScope,
  AuthAccessWriteScope,
  CommandId,
  OrchestrationV2DelegatedFrom,
  OrchestrationV2LinkOrigin,
  ThreadId,
  ProviderInstanceId,
  RunId,
  type AuthEnvironmentScope,
  type Project,
  type ProjectSharing,
} from "@t3tools/contracts";
import {
  LIBRARY_SIGN_IN_NOT_CURRENT_TEXT,
  LibraryError,
  VaultError,
  LibraryOperation,
  LibraryOperationInput,
  LibraryWorkingCopy,
  LibraryProject,
  LibraryCreateProjectRequest,
  LibraryUpdateProjectRequest,
  LibraryRegisterCopyRequest,
  type LibraryRecoveryGrant,
  type LibraryResolvedBinding,
  type LibraryOperationOutcomeRequest,
} from "@t3tools/contracts/fork";
import {
  buildTemporaryWorktreeBranchName,
  flattenTemporaryWorktreeBranchName,
  WORKTREE_BRANCH_PREFIX,
  normalizeGitRemoteUrl,
} from "@t3tools/shared/git";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { isVaultRunRunning } from "../vault/active-run.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../../serverActivation.ts";
import { LibraryPublisher } from "./LibraryPublisher.ts";
import { validLibraryResources } from "./policy.ts";
import { LibraryManagement } from "./LibraryManagement.ts";
import { LibraryWorkspaceStore } from "./LibraryWorkspaceStore.ts";
import { LibraryWorkspace } from "./LibraryWorkspace.ts";
import * as SetupMarker from "../../workspace/setupMarker.ts";

const isLibraryFailure = Schema.is(LibraryError);
const io = (cause: unknown) =>
  isLibraryFailure(cause) ? cause : new LibraryError({ reason: "io" });
const denied = (reason: "session" | "access" | "outside" | "turn" | "workload" = "session") =>
  new LibraryError({
    reason: "blocked",
    accessRepair: { kind: reason === "session" ? "sign-in" : "permission" },
    detail:
      reason === "turn"
        ? "The conversation that started this operation is no longer running a turn. Resume it from that conversation with loom_library_operation_control."
        : reason === "workload"
          ? "This operation's agent authorization is no longer current. Resume it from its original conversation during a full-access/default turn with loom_library_operation_control."
          : reason === "outside"
            ? "This agent needs Full access for this file work. Revoke it under Settings → Sharing & access, then approve its next sign-in with Full access."
            : reason === "access"
              ? "This device's access level doesn't allow this kind of file work. Use a device with a higher access level."
              : LIBRARY_SIGN_IN_NOT_CURRENT_TEXT,
  });
const SET_ASIDE =
  "Loom already moved these files aside to remove them. Resume this operation to finish removing them.";
const OUTSIDE_CREATE =
  "No project in the Library matches this folder, and outside agents cannot create shared projects. Add this folder to the Library from Loom, or import it with the projectId of the project it belongs to.";
type OperationActor = { readonly subject: string; readonly sessionId: string };
// In-app agents act as their conversation; every outside agent's MCP session shares one subject.
const isAgent = (subject: string) => subject.startsWith("workload:") || subject === "mcp-client";
const ownedElsewhere = (owner: string) =>
  new LibraryError({
    reason: "blocked",
    accessRepair: { kind: "ownership" },
    detail: owner.startsWith("workload:")
      ? `This operation was started by an agent in conversation ${owner.slice(9)}. Resume or cancel it from that conversation with loom_library_operation_control.`
      : owner === "mcp-client"
        ? "This operation was started by an agent connected over MCP. Resume or cancel it from that agent."
        : "This operation belongs to another signed-in session. Use the session that started it to resume or cancel.",
  });
const Workload = Schema.Struct({
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  runId: RunId,
});
const workloadCodec = Schema.fromJsonString(Workload);
const operationCodec = Schema.fromJsonString(LibraryOperation);
const requestCodec = Schema.fromJsonString(LibraryOperationInput);
const copyCodec = Schema.fromJsonString(LibraryWorkingCopy);
const requireOneRepository = (resolved: LibraryResolvedBinding) =>
  resolved.repositoryPaths.length === 1 && resolved.repositoryPaths[0] === resolved.cwd
    ? Effect.void
    : Effect.fail(
        new LibraryError({
          reason: "blocked",
          detail:
            "Only a conversation working in one repository can start in its own worktree. Choose that repository, or start in the project folder.",
        }),
      );
const worktreeCodec = Schema.fromJsonString(
  Schema.Struct({ path: Schema.String, branch: Schema.String }),
);
/** Where a launch came from. Only the server sets it, so it is kept apart from the request. */
const LaunchOrigin = Schema.Struct({
  linkOrigin: Schema.optional(OrchestrationV2LinkOrigin),
  delegatedFrom: Schema.optional(OrchestrationV2DelegatedFrom),
});
type LaunchOrigin = typeof LaunchOrigin.Type;
const originCodec = Schema.fromJsonString(LaunchOrigin);
const creationCodec = Schema.fromJsonString(LibraryCreateProjectRequest);
const updateCodec = Schema.fromJsonString(LibraryUpdateProjectRequest);
const registrationCodec = Schema.fromJsonString(LibraryRegisterCopyRequest);
const decodeProject = Schema.decodeUnknownEffect(LibraryProject);
function operationScopes(kind: LibraryOperationInput["kind"]): readonly AuthEnvironmentScope[] {
  return kind === "import"
    ? [AuthSettingsWriteScope, AuthTerminalOperateScope]
    : kind === "create"
      ? [AuthSettingsWriteScope]
      : kind === "launch"
        ? [AuthTerminalOperateScope, AuthOrchestrationOperateScope]
        : kind === "release" || kind === "unregister"
          ? [AuthOrchestrationOperateScope]
          : [AuthTerminalOperateScope];
}
type CreationCaller =
  | { readonly kind: "client"; readonly sessionId: string }
  | {
      readonly kind: "agent";
      readonly threadId: ThreadId;
      readonly providerInstanceId: ProviderInstanceId;
    };
type CreatedProject = Pick<Project, "id" | "workspaceRoot"> & { readonly title?: string };

export class ProjectOperations extends Context.Service<
  ProjectOperations,
  {
    readonly repositoryPublished: (
      project: CreatedProject,
      remoteUrl: string,
      caller: CreationCaller,
    ) => Effect.Effect<ProjectSharing>;
    readonly shareCreated: (
      project: CreatedProject,
      caller: CreationCaller,
    ) => Effect.Effect<ProjectSharing>;
    readonly operationId: (
      requestId: string,
      kind: LibraryOperationInput["kind"],
    ) => Effect.Effect<string, LibraryError>;
    readonly outcomeClient: (
      input: LibraryOperationOutcomeRequest,
      sessionId: string,
    ) => Effect.Effect<LibraryOperation | null, LibraryError>;
    readonly executeClient: (
      id: string,
      request: LibraryOperationInput,
      sessionId: string,
      origin?: LaunchOrigin,
    ) => Effect.Effect<LibraryOperation, LibraryError>;
    readonly executeAgent: (
      id: string,
      request: LibraryOperationInput,
      caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
      origin?: LaunchOrigin,
    ) => Effect.Effect<LibraryOperation, LibraryError>;
    readonly controlClient: (
      id: string,
      action: "resume" | "cancel",
      sessionId: string,
    ) => Effect.Effect<LibraryOperation, LibraryError>;
    readonly controlAgent: (
      id: string,
      action: "resume" | "cancel",
      caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
    ) => Effect.Effect<LibraryOperation, LibraryError>;
    readonly list: (input: {
      projectId?: string | undefined;
      includeFolderImports?: boolean;
    }) => Effect.Effect<readonly LibraryOperation[], LibraryError>;
    readonly run: (
      id: string,
      request: LibraryOperationInput,
      actor: OperationActor,
      origin?: LaunchOrigin,
    ) => Effect.Effect<LibraryOperation, LibraryError>;
    readonly execute: (
      id: string,
      request: LibraryOperationInput,
      actor: OperationActor,
      origin?: LaunchOrigin,
    ) => Effect.Effect<LibraryOperation, LibraryError>;
    readonly resume: (
      id: string,
      actor: OperationActor,
    ) => Effect.Effect<LibraryOperation, LibraryError>;
    readonly cancel: (
      id: string,
      actor: OperationActor,
    ) => Effect.Effect<LibraryOperation, LibraryError>;
  }
>()("t3/fork/project-library/ProjectOperations") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Digest.Digest;
  /** Existing IDs stay stable; maximum-length client request IDs still leave room for the operation kind. */
  const operationId = Effect.fn("ProjectOperations.operationId")(function* (
    requestId: string,
    kind: LibraryOperationInput["kind"],
  ) {
    const candidate = `${requestId}:${kind}`;
    if (candidate.length <= 200) return candidate;
    const digest = yield* crypto
      .digest(Digest.sha256, new TextEncoder().encode(requestId))
      .pipe(Effect.mapError(io));
    return `${Hex.encode(digest)}:${kind}`;
  });

  const management = yield* LibraryManagement;
  const publisher = yield* LibraryPublisher;
  const workflows = yield* ProjectWorkflows;
  const workspace = yield* LibraryWorkspace;
  const workspaceStore = yield* LibraryWorkspaceStore;
  const threads = yield* ThreadManagementService;
  const sessions = yield* SessionStore;
  const environment = yield* HostProcess.Environment;
  const repositoryVault = yield* Effect.serviceOption(VaultGitHub.VaultGitHub);
  const sessionPrefix = identitySessionPrefix(environment);
  const ownershipSubject = (subject: string) => identityOwnershipSubject(subject, environment);
  // A signed-in person may take over what any agent started; otherwise only the owner may.
  const mayControl = (owner: string, actor: OperationActor) =>
    ownershipSubject(owner) === ownershipSubject(actor.subject) ||
    (isAgent(owner) && !isAgent(actor.subject));
  const git = yield* GitWorkflowService;
  const fs = yield* FileSystem.FileSystem;
  const markerServices = yield* Effect.context<SetupMarker.Services>();
  const identity = yield* ServerEnvironmentIdentity;
  const environmentId = yield* identity.getEnvironmentId;
  const scope = yield* Effect.scope;
  // Per operation: a cancel waiting on its copy must not hold up every other operation.
  const lock = yield* KeyedLock.make<string>();
  const folderImports = yield* KeyedLock.make<string>();
  const restoreGrants = new Map<string, LibraryRecoveryGrant>();
  const pending = new Map<string, Deferred.Deferred<LibraryOperation, LibraryError>>();
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const read = Effect.fn("ProjectOperations.read")(function* (id: string) {
    const rows = yield* sql<{
      subject: string;
      session_id: string;
      request_json: string;
      payload_json: string;
    }>`SELECT subject,session_id,request_json,payload_json FROM fork_library_operations WHERE id = ${id}`;
    if (!rows[0]) return null;
    return {
      ...rows[0],
      operation: yield* Schema.decodeEffect(operationCodec)(rows[0].payload_json),
    };
  }, Effect.mapError(io));
  const save = Effect.fn("ProjectOperations.save")(function* (value: LibraryOperation) {
    const payload = yield* Schema.encodeEffect(operationCodec)(value);
    yield* sql`UPDATE fork_library_operations SET payload_json=${payload},state=${value.state},project_id=${value.projectId} WHERE id=${value.id}`;
    yield* workflows.changed;
    return value;
  }, Effect.mapError(io));
  // A socket keeps the session it opened with while Identity renews it hourly, so a renewal of
  // that session speaks for the same client.
  const currentSession = Effect.fn("ProjectOperations.currentSession")(function* (
    sessionId: string,
  ) {
    const chain = yield* sessions.renewalsOf(AuthSessionId.make(sessionId));
    const observedAt = yield* DateTime.now;
    const active = (yield* sessions.listActive()).filter(
      (session) =>
        chain.has(session.sessionId) &&
        session.expiresAt.epochMilliseconds > observedAt.epochMilliseconds &&
        isCurrentIdentitySession(session.subject, sessionPrefix),
    );
    return active.find((session) => session.sessionId === sessionId) ?? active[0];
  });
  const authorize = Effect.fn("ProjectOperations.authorize")(function* (
    sessionId: string,
    subject: string,
    request: LibraryOperationInput,
  ) {
    if (sessionId.startsWith("workload:")) {
      const claims = yield* Schema.decodeEffect(workloadCodec)(sessionId.slice(9)).pipe(
        Effect.mapError(() => denied("workload")),
      );
      const thread = yield* threads
        .getThreadShell(claims.threadId)
        .pipe(Effect.mapError(() => denied("workload")));
      if (
        !thread ||
        thread.archivedAt !== null ||
        thread.deletedAt !== null ||
        thread.activeRunId !== claims.runId ||
        !(yield* isVaultRunRunning(threads, thread))
      )
        return yield* denied("turn");
      if (
        thread.providerInstanceId !== claims.providerInstanceId ||
        thread.runtimeMode !== "full-access" ||
        thread.interactionMode !== "default"
      )
        return yield* denied("workload");
      return;
    }
    const active = yield* currentSession(sessionId);
    if (!active || ownershipSubject(active.subject) !== ownershipSubject(subject))
      return yield* denied();
    const outside = subject === "mcp-client";
    // Outside agents never get terminal:operate; settings:write marks their Full access grant.
    const required = operationScopes(request.kind).map((permission) =>
      outside && permission === AuthTerminalOperateScope ? AuthSettingsWriteScope : permission,
    );
    if (!required.every((permission) => (active.permissions ?? active.scopes).includes(permission)))
      return yield* denied(outside ? "outside" : "access");
  }, Effect.mapError(io));
  /**
   * A launch's own worktree, made once so a retry never gives the conversation a second checkout.
   * It goes where Loom keeps worktrees, so landed-work cleanup, and remaking it after a removal,
   * treat it like any other conversation's worktree.
   */
  const launchWorktree = Effect.fn("ProjectOperations.launchWorktree")(function* (
    id: string,
    resolved: LibraryResolvedBinding,
  ) {
    const receiptId = `${id}:worktree`;
    const saved = yield* sql<{
      result_json: string;
    }>`SELECT result_json FROM fork_library_workflow_receipts WHERE id=${receiptId}`;
    if (saved[0]) return yield* Schema.decodeEffect(worktreeCodec)(saved[0].result_json);
    yield* requireOneRepository(resolved);
    const cwd = resolved.cwd;
    const uuid = yield* randomUuidV4;
    const temporary = buildTemporaryWorktreeBranchName(() => uuid.replaceAll("-", ""));
    const branch = (yield* git.hasCommit({ cwd, refName: `refs/heads/${WORKTREE_BRANCH_PREFIX}` }))
      ? flattenTemporaryWorktreeBranchName(temporary)
      : temporary;
    const base = (yield* git.localStatus({ cwd })).refName;
    // Once the worktree exists, its receipt must be saved even if the operation is cancelled.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const created = yield* restore(
          git.createWorktree({
            cwd,
            refName: base ?? "HEAD",
            newRefName: branch,
            ...(base === null ? {} : { baseRefName: base }),
            path: null,
          }),
        );
        const worktree = {
          path: yield* fs.realPath(created.worktree.path),
          branch: created.worktree.refName,
        };
        // The first turn runs the project's setup script here before the agent starts.
        yield* SetupMarker.write(worktree.path).pipe(Effect.provide(markerServices));
        const payload = yield* Schema.encodeEffect(worktreeCodec)(worktree);
        yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${receiptId},${"worktree"},${payload})`;
        return worktree;
      }),
    );
  }, Effect.mapError(io));
  /**
   * Moves a conversation that opened in its copy's folder into the worktree it asked for, once the
   * files it is made from are in. One whose first message went ahead keeps working in the folder.
   */
  const moveToWorktree = Effect.fn("ProjectOperations.moveToWorktree")(function* (
    id: string,
    threadId: ThreadId,
    resolved: LibraryResolvedBinding,
  ) {
    const thread = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(io));
    if (thread === null || thread.deletedAt !== null) return;
    if (thread.worktreePath === resolved.cwd && thread.latestRunId !== null) return;
    const worktree = yield* launchWorktree(id, resolved);
    const movedThere = threads
      .getThreadShell(threadId)
      .pipe(Effect.map((current) => current?.worktreePath === worktree.path));
    const moved = yield* workspace.moveThread({
      threadId,
      worktreePath: worktree.path,
      move:
        thread.worktreePath === worktree.path
          ? Effect.succeed(true)
          : threads
              .dispatch({
                type: "thread.metadata.update",
                commandId: CommandId.make(`${id}:move-to-worktree`),
                threadId,
                branch: worktree.branch,
                worktreePath: worktree.path,
                expectedWorktreePath: resolved.cwd,
                expectedEmpty: true,
              })
              .pipe(
                Effect.as(true),
                // Refused once a message lands, which keeps the conversation where it started.
                Effect.catch(() => movedThere),
                Effect.mapError(io),
              ),
    });
    if (!moved)
      yield* Effect.logInfo("A Library conversation started before its worktree was ready.", {
        threadId,
      });
  });
  const worker = Effect.fn("ProjectOperations.worker")(function* (
    id: string,
    opened: (operation: LibraryOperation) => Effect.Effect<void>,
  ) {
    const row = yield* read(id);
    if (!row || ["succeeded", "cancelled"].includes(row.operation.state))
      return row?.operation ?? null;
    const request = yield* Schema.decodeEffect(requestCodec)(row.request_json).pipe(
      Effect.mapError(io),
    );
    const repositoryAuthorization: RepositoryAuthorizer = Effect.fn(
      "ProjectOperations.repositoryAuthorization",
    )(function* () {
      if (isAgent(row.subject) || row.session_id.startsWith("workload:"))
        return yield* new VaultError({ reason: "denied" });
      const active = yield* currentSession(row.session_id).pipe(
        Effect.mapError(() => new VaultError({ reason: "unavailable" })),
      );
      if (
        !active ||
        isAgent(active.subject) ||
        ownershipSubject(active.subject) !== ownershipSubject(row.subject) ||
        ![AuthTerminalOperateScope, AuthAccessWriteScope].every((permission) =>
          (active.permissions ?? active.scopes).includes(permission),
        )
      )
        return yield* new VaultError({ reason: "denied" });
    });
    const withRepositoryContext = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Option.isSome(repositoryVault)
        ? effect.pipe(Effect.provideService(VaultGitHub.VaultGitHub, repositoryVault.value))
        : effect;
    let operation = row.operation;
    // Each step rechecks access until a launch's conversation exists. The steps after it finish
    // that launch, so a download outlasting the session or agent turn that asked for it completes.
    let launched = false;
    const phase = Effect.fn("ProjectOperations.phase")(function* (name: string) {
      if (!launched) yield* authorize(row.session_id, row.subject, request);
      operation = yield* save({
        ...Struct.omit(operation, ["accessRepair"]),
        phase: name,
        state: "running",
        error: null,
        updatedAt: yield* now,
      });
    });
    const managementActor = Effect.fn("ProjectOperations.managementActor")(function* () {
      return row.session_id.startsWith("workload:")
        ? {
            kind: "agent" as const,
            ...(yield* Schema.decodeEffect(workloadCodec)(row.session_id.slice(9)).pipe(
              Effect.mapError(io),
            )),
          }
        : { kind: "client" as const, sessionId: AuthSessionId.make(row.session_id) };
    });
    const action = Effect.gen(function* () {
      yield* phase("Checking access");
      let result: LibraryOperation["result"];
      switch (request.kind) {
        case "import": {
          const input = request.input;
          yield* phase("Checking existing folder and shared projects");
          const folder = yield* workspace.inspectFolder({ rootPath: input.rootPath });
          if (!folder.exists)
            return yield* new LibraryError({
              reason: "not-found",
              detail: "The folder no longer exists on this computer.",
            });
          result = yield* folderImports.withLock(
            folder.rootPath,
            Effect.gen(function* () {
              const inspection = yield* workspace.inspectFolder({ rootPath: folder.rootPath });
              if (!inspection.exists) return yield* new LibraryError({ reason: "not-found" });
              let selected =
                operation.result === null
                  ? null
                  : yield* decodeProject(operation.result).pipe(Effect.mapError(io));
              if (!selected) {
                const catalog = yield* publisher.projects({ includeArchived: true });
                const registrations =
                  inspection.registrations ??
                  (inspection.registration ? [inspection.registration] : []);
                const holders = registrations.filter((registration) =>
                  catalog.some(
                    (project) => project.id === registration.projectId && !project.archived,
                  ),
                );
                const matches = input.projectId
                  ? catalog.filter((project) => project.id === input.projectId && !project.archived)
                  : holders.length
                    ? catalog.filter(
                        (project) =>
                          !project.archived &&
                          holders.some((holder) => holder.projectId === project.id),
                      )
                    : catalog.filter((project) => {
                        const repositories = project.resources.filter(
                          (resource) => resource.kind !== "link",
                        );
                        return (
                          !project.archived &&
                          repositories.length > 0 &&
                          repositories.length === inspection.repositories.length &&
                          repositories.every((resource) => {
                            const remote = resource.remoteUrl;
                            return (
                              remote !== null &&
                              inspection.repositories.some(
                                (repository) =>
                                  repository.relativePath === resource.relativePath &&
                                  repository.remoteUrl !== null &&
                                  normalizeGitRemoteUrl(remote) ===
                                    normalizeGitRemoteUrl(repository.remoteUrl),
                              )
                            );
                          })
                        );
                      });
                if (matches.length > 1)
                  return yield* new LibraryError({
                    reason: "blocked",
                    detail:
                      "Several shared projects match this folder. Read the project list and retry with the intended projectId.",
                  });
                if (input.projectId && !matches.length)
                  return yield* new LibraryError({
                    reason: "not-found",
                    detail: "The selected shared project is missing or archived.",
                  });
                selected = matches[0] ?? null;
                if (holders.some((holder) => holder.projectId !== selected?.id))
                  return yield* new LibraryError({
                    reason: "blocked",
                    detail:
                      "Another current project holds this folder. Its files were not reassigned.",
                  });
                if (
                  registrations.some(
                    (registration) =>
                      registration.ownership !== "borrowed" &&
                      registration.projectId !== selected?.id,
                  )
                )
                  return yield* new LibraryError({
                    reason: "blocked",
                    detail:
                      "Files created for another project still hold this folder. Review that project's Files before reusing it.",
                  });
                if (!selected) {
                  // Creating a shared project needs a person's Library sign-in.
                  if (row.subject === "mcp-client")
                    return yield* new LibraryError({ reason: "blocked", detail: OUTSIDE_CREATE });
                  const receiptId = yield* operationId(id, "create");
                  const saved = yield* sql<{
                    request_json: string;
                    result_json: string;
                  }>`SELECT request_json,result_json FROM fork_library_workflow_receipts WHERE id=${receiptId}`.pipe(
                    Effect.mapError(io),
                  );
                  if (saved[0] && saved[0].request_json !== row.request_json)
                    return yield* new LibraryError({ reason: "request-conflict" });
                  let creation: LibraryCreateProjectRequest;
                  if (saved[0])
                    creation = yield* Schema.decodeEffect(creationCodec)(saved[0].result_json).pipe(
                      Effect.mapError(io),
                    );
                  else {
                    const title =
                      input.title ??
                      inspection.rootPath.split(/[\\/]/).findLast(Boolean)?.slice(0, 160) ??
                      "Project";
                    creation = {
                      requestId: receiptId,
                      title,
                      resources: inspection.repositories.map((repository, index) => ({
                        id: `repository-${index}`,
                        kind: "repository" as const,
                        title:
                          repository.relativePath === "."
                            ? title
                            : repository.relativePath.slice(0, 160),
                        relativePath: repository.relativePath,
                        remoteUrl:
                          repository.remoteUrl &&
                          !/^(?:file:|[\\/]|[a-z]:[\\/])/i.test(repository.remoteUrl)
                            ? repository.remoteUrl
                            : null,
                        defaultBranch: null,
                      })),
                    };
                    if (!validLibraryResources(creation.resources ?? []))
                      return yield* new LibraryError({
                        reason: "invalid",
                        detail:
                          "The folder's repositories cannot form one portable project. Choose a folder with separate repositories and supported repository URLs.",
                      });
                    const encoded = yield* Schema.encodeEffect(creationCodec)(creation).pipe(
                      Effect.mapError(io),
                    );
                    yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${receiptId},${row.request_json},${encoded}) ON CONFLICT(id) DO NOTHING`.pipe(
                      Effect.mapError(io),
                    );
                  }
                  yield* phase("Creating shared project");
                  selected = yield* management.execute(
                    { kind: "create", input: creation },
                    yield* managementActor(),
                  );
                }
                if (input.repositoryUpdate) {
                  const change = input.repositoryUpdate;
                  const resource = selected.resources.find(
                    (entry) => entry.id === change.resourceId && entry.kind !== "link",
                  );
                  const repository = inspection.repositories.find(
                    (entry) => entry.relativePath === resource?.relativePath,
                  );
                  if (
                    !resource ||
                    !repository?.remoteUrl ||
                    normalizeGitRemoteUrl(repository.remoteUrl) !==
                      normalizeGitRemoteUrl(change.remoteUrl) ||
                    (resource.remoteUrl !== null &&
                      normalizeGitRemoteUrl(resource.remoteUrl) !==
                        normalizeGitRemoteUrl(change.remoteUrl))
                  )
                    return yield* new LibraryError({
                      reason: "blocked",
                      detail:
                        "The published repository does not match the saved project and current folder. The saved repository URL was preserved.",
                    });
                  const updateId = yield* operationId(`${id}:repository-url`, "import");
                  const receipts = yield* sql<{
                    request_json: string;
                    result_json: string;
                  }>`SELECT request_json,result_json FROM fork_library_workflow_receipts WHERE id=${updateId}`.pipe(
                    Effect.mapError(io),
                  );
                  if (receipts[0] && receipts[0].request_json !== row.request_json)
                    return yield* new LibraryError({ reason: "request-conflict" });
                  if (resource.remoteUrl === null || receipts[0]) {
                    const update = receipts[0]
                      ? yield* Schema.decodeEffect(updateCodec)(receipts[0].result_json).pipe(
                          Effect.mapError(io),
                        )
                      : {
                          requestId: updateId,
                          projectId: selected.id,
                          expectedRevision: selected.revision,
                          resourceUpdates: [{ id: resource.id, remoteUrl: change.remoteUrl }],
                        };
                    if (!receipts[0]) {
                      const encoded = yield* Schema.encodeEffect(updateCodec)(update).pipe(
                        Effect.mapError(io),
                      );
                      yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${updateId},${row.request_json},${encoded})`.pipe(
                        Effect.mapError(io),
                      );
                    }
                    yield* phase("Saving published repository URL");
                    selected = yield* management.execute(
                      { kind: "update", input: update },
                      yield* managementActor(),
                    );
                  }
                }
                operation = yield* save({
                  ...operation,
                  projectId: selected.id,
                  result: selected,
                  updatedAt: yield* now,
                });
              }
              yield* phase("Registering existing files");
              const registrationId = yield* operationId(id, "import");
              const previous = yield* sql<{
                request_json: string;
                result_json: string;
              }>`SELECT request_json,result_json FROM fork_library_workflow_receipts WHERE id=${registrationId}`.pipe(
                Effect.mapError(io),
              );
              if (previous[0] && previous[0].request_json !== row.request_json)
                return yield* new LibraryError({ reason: "request-conflict" });
              let registration: LibraryRegisterCopyRequest;
              if (previous[0])
                registration = yield* Schema.decodeEffect(registrationCodec)(
                  previous[0].result_json,
                ).pipe(Effect.mapError(io));
              else {
                const copy = yield* workspace.prepareCopy({
                  requestId: yield* operationId(id, "prepare"),
                  project: selected,
                  rootPath: input.rootPath,
                  strategy: "reuse",
                });
                const authority = yield* publisher.info;
                registration = {
                  requestId: registrationId,
                  authorityId: authority.authorityId,
                  authorityEpoch: authority.authorityEpoch,
                  copy,
                };
                const encoded = yield* Schema.encodeEffect(registrationCodec)(registration).pipe(
                  Effect.mapError(io),
                );
                yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${registrationId},${row.request_json},${encoded}) ON CONFLICT(id) DO NOTHING`.pipe(
                  Effect.mapError(io),
                );
              }
              yield* phase("Saving files in Projects");
              yield* publisher.registerCopy(registration);
              return selected;
            }),
          );
          break;
        }
        case "create":
          yield* phase("Creating project");
          result = yield* management.execute(request, yield* managementActor());
          break;
        case "prepare":
          yield* phase("Preparing files");
          result = yield* withRepositoryContext(
            workspace.prepareCopy(request.input, repositoryAuthorization),
          );
          break;
        case "restore": {
          yield* phase("Restoring saved recovery archive");
          const grant = restoreGrants.get(id);
          if (!grant)
            return yield* new LibraryError({
              reason: "blocked",
              detail:
                "Recovery authorization was not saved. Reopen Start and retry the same restore to obtain fresh authorization.",
            });
          result = yield* workspace.restoreCopy({ ...request.input, grant });
          break;
        }
        case "reopen":
          yield* phase("Restoring files on this computer");
          result = yield* workspace.reopenCopy(request.input);
          break;
        case "snapshot":
          yield* phase("Preserving recovery archive");
          result = yield* workspace.snapshotCopy(request.input);
          break;
        case "release":
          yield* phase("Rechecking reviewed files before removal");
          result = yield* workspace.release(request.input);
          break;
        case "unregister":
          yield* phase("Forgetting existing folder");
          result = yield* workspace.unregister(request.input);
          break;
        case "launch": {
          const input = request.input;
          const files = input.files;
          if (
            input.binding.environmentId !== environmentId ||
            (files !== undefined &&
              (files.requestId !== input.binding.workingCopyId ||
                files.project.id !== input.project.id))
          )
            return yield* new LibraryError({ reason: "invalid" });
          yield* phase("Checking files and project scope");
          // With files, the launch reserves them, opens the conversation in them, then downloads.
          const reserved =
            files === undefined
              ? null
              : yield* withRepositoryContext(workspace.reserveCopy(files, repositoryAuthorization));
          const binding =
            reserved === null ? input.binding : { ...input.binding, workingCopyId: reserved.id };
          const resolved = yield* workspace.resolveBinding({ binding, project: input.project });
          const earlier = yield* threads.getThreadShell(input.threadId).pipe(Effect.mapError(io));
          // A worktree is made from the copy's files, so a conversation opening before they
          // arrive, or one an earlier try opened in the copy's folder, moves into it afterwards.
          const worktreeAfter =
            input.workspace === "worktree" &&
            reserved !== null &&
            (earlier === null ? reserved.state !== "ready" : earlier.worktreePath === resolved.cwd);
          if (worktreeAfter) yield* requireOneRepository(resolved);
          const worktreeFirst = input.workspace === "worktree" && !worktreeAfter;
          if (worktreeFirst) yield* phase("Creating worktree");
          const worktree = worktreeFirst ? yield* launchWorktree(id, resolved) : null;
          yield* phase("Creating conversation");
          const origin = yield* sql<{
            result_json: string;
          }>`SELECT result_json FROM fork_library_workflow_receipts WHERE id=${`${id}:origin`}`.pipe(
            Effect.flatMap(([saved]) =>
              saved
                ? Schema.decodeEffect(originCodec)(saved.result_json)
                : Effect.succeed<LaunchOrigin>({}),
            ),
            Effect.mapError(io),
          );
          yield* threads
            .dispatch({
              type: "thread.create",
              commandId: CommandId.make(`${id}:create`),
              threadId: input.threadId,
              projectId: resolved.localProjectId,
              title: input.title,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
              branch: worktree?.branch ?? null,
              worktreePath: worktree?.path ?? resolved.cwd,
              ...origin,
              createdBy: isAgent(row.subject) ? "agent" : "user",
              creationSource: isAgent(row.subject) ? "mcp" : "web",
            })
            .pipe(Effect.mapError(io));
          // A retry reuses the first try's create, which does nothing for a conversation deleted
          // since. Binding files to it would end at a conversation nobody can open.
          const created = yield* threads.getThreadShell(input.threadId).pipe(Effect.mapError(io));
          if (created === null || created.deletedAt !== null)
            return yield* new LibraryError({
              reason: "blocked",
              detail:
                "The conversation from an earlier try was deleted. Start over to begin a new one.",
            });
          yield* phase("Binding conversation to files");
          yield* workspace.bindThread({
            threadId: input.threadId,
            binding,
            project: input.project,
            ...(worktree === null ? {} : { worktreePath: worktree.path }),
          });
          if (reserved !== null) {
            launched = true;
            // The caller gets the open conversation now; its files, worktree and retention follow.
            operation = yield* save({
              ...operation,
              result: { threadId: input.threadId },
              updatedAt: yield* now,
            });
            yield* opened(operation);
            yield* phase("Downloading files");
            yield* withRepositoryContext(
              workspace.fillCopy(
                { workingCopyId: reserved.id, operationId: id },
                repositoryAuthorization,
              ),
            );
            if (worktreeAfter) {
              yield* phase("Creating worktree");
              yield* moveToWorktree(
                id,
                input.threadId,
                yield* workspace.resolveBinding({ binding, project: input.project }),
              );
            }
          }
          if (input.keepOnComputer !== undefined) {
            yield* phase("Saving file retention");
            // The receipt keeps a retried launch from undoing a change made since the first try.
            const saved = yield* sql<{
              id: string;
            }>`SELECT id FROM fork_library_workflow_receipts WHERE id=${`${id}:retention`}`;
            if (!saved[0]) {
              // Only the launch's placement knows whether its files are borrowed, and a borrowed
              // checkout always stays on the computer, so a request to remove it has no effect.
              const copy = yield* workspace
                .setCopyRetention({
                  workingCopyId: binding.workingCopyId,
                  keepOnComputer: input.keepOnComputer,
                })
                .pipe(
                  Effect.catchIf(
                    (cause) => cause.reason === "not-managed",
                    () => Effect.succeed(null),
                  ),
                );
              if (copy !== null) {
                const payload = yield* Schema.encodeEffect(copyCodec)(copy).pipe(
                  Effect.mapError(io),
                );
                yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${`${id}:retention`},${"retention"},${payload})`.pipe(
                  Effect.mapError(io),
                );
              }
            }
          }
          // Replication publishes the new conversation and the copy's retention within seconds
          // through this computer's fenced journal. A separate upload here would lack that fence,
          // which a hosted Library refuses, and would fail a launch whose conversation exists.
          result = { threadId: input.threadId };
          break;
        }
      }
      return yield* save({
        ...operation,
        projectId:
          (request.kind === "create" || request.kind === "import") &&
          result &&
          "resources" in result
            ? result.id
            : operation.projectId,
        state: "succeeded",
        phase: "Done",
        result,
        error: null,
        updatedAt: yield* now,
      });
    });
    return yield* action.pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          if (Cause.hasInterrupts(cause)) return yield* Effect.failCause(cause);
          const error = io(Cause.squash(cause));
          return yield* save({
            ...operation,
            state: error.reason === "blocked" ? "needs-input" : "failed",
            error: error.message,
            failureReason: error.reason,
            ...(error.repair ? { repair: error.repair } : {}),
            ...(error.accessRepair ? { accessRepair: error.accessRepair } : {}),
            updatedAt: yield* now,
          });
        }),
      ),
    );
  }, Effect.mapError(io));
  const start = Effect.fn("ProjectOperations.start")(function* (id: string) {
    if (pending.has(id)) return;
    const completion = yield* Deferred.make<LibraryOperation, LibraryError>();
    pending.set(id, completion);
    const release = Effect.sync(() => {
      if (pending.get(id) === completion) {
        pending.delete(id);
        restoreGrants.delete(id);
      }
    });
    yield* worker(id, (operation) =>
      Deferred.succeed(completion, operation).pipe(Effect.asVoid),
    ).pipe(
      Effect.flatMap((result) =>
        release.pipe(
          Effect.andThen(
            result
              ? Deferred.succeed(completion, result)
              : Deferred.fail(completion, new LibraryError({ reason: "not-found" })),
          ),
        ),
      ),
      Effect.catch((error) => release.pipe(Effect.andThen(Deferred.fail(completion, io(error))))),
      Effect.onExit((exit) =>
        release.pipe(
          Effect.andThen(
            Exit.isFailure(exit)
              ? Deferred.fail(completion, io(Cause.squash(exit.cause)))
              : Effect.void,
          ),
        ),
      ),
      Effect.forkIn(scope),
    );
  });
  const run = Effect.fn("ProjectOperations.run")(
    function* (
      id: string,
      request: LibraryOperationInput,
      actor: OperationActor,
      origin?: LaunchOrigin,
    ) {
      yield* authorize(actor.sessionId, actor.subject, request);
      const durableRequest =
        request.kind === "restore"
          ? {
              ...request,
              input: {
                ...request.input,
                grant: {
                  ...request.input.grant,
                  accessToken: "credential-required",
                  expiresAt: "1970-01-01T00:00:00.000Z",
                },
              },
            }
          : request;
      const encoded = yield* Schema.encodeEffect(requestCodec)(durableRequest).pipe(
        Effect.mapError(io),
      );
      const existing = yield* read(id);
      if (existing && existing.request_json !== encoded)
        return yield* new LibraryError({ reason: "request-conflict" });
      // An agent retry after a person took the operation over still gets its outcome.
      if (existing && ["succeeded", "cancelled"].includes(existing.operation.state)) {
        if (!isAgent(actor.subject) && !mayControl(existing.subject, actor))
          return yield* ownedElsewhere(existing.subject);
        return existing.operation;
      }
      if (existing && !mayControl(existing.subject, actor))
        return yield* ownedElsewhere(existing.subject);
      if (existing && pending.has(id)) return existing.operation;
      // The first try's origin stays, so a person resuming the launch keeps it nested.
      if (request.kind === "launch" && (origin?.linkOrigin || origin?.delegatedFrom)) {
        const saved = yield* Schema.encodeEffect(originCodec)(origin).pipe(Effect.mapError(io));
        yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${`${id}:origin`},${"origin"},${saved}) ON CONFLICT(id) DO NOTHING`.pipe(
          Effect.mapError(io),
        );
      }
      const timestamp = yield* now;
      const projectId =
        request.kind === "create" || request.kind === "import"
          ? (existing?.operation.projectId ?? null)
          : request.kind === "launch" || request.kind === "prepare" || request.kind === "restore"
            ? request.input.project.id
            : (yield* workspaceStore.get(request.input.workingCopyId)).copy.projectId;
      const value: LibraryOperation = {
        id,
        kind: request.kind,
        projectId,
        environmentId,
        state: "queued",
        phase: "Waiting to start",
        attempt: (existing?.operation.attempt ?? 0) + 1,
        error: null,
        result: request.kind === "import" ? (existing?.operation.result ?? null) : null,
        createdAt: existing?.operation.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      const payload = yield* Schema.encodeEffect(operationCodec)(value).pipe(Effect.mapError(io));
      yield* sql`INSERT INTO fork_library_operations (id,subject,session_id,request_json,payload_json,state,project_id,created_at) VALUES (${id},${ownershipSubject(actor.subject)},${actor.sessionId},${encoded},${payload},${value.state},${projectId},${value.createdAt}) ON CONFLICT(id) DO UPDATE SET subject=excluded.subject,session_id=excluded.session_id,payload_json=excluded.payload_json,state=excluded.state`.pipe(
        Effect.mapError(io),
      );
      yield* workflows.changed;
      if (request.kind === "restore") restoreGrants.set(id, request.input.grant);
      yield* start(id);
      return value;
    },
    (effect, id) => lock.withLock(id, effect),
  );
  const execute = Effect.fn("ProjectOperations.execute")(function* (
    id: string,
    request: LibraryOperationInput,
    actor: OperationActor,
    origin?: LaunchOrigin,
  ) {
    const initial = yield* run(id, request, actor, origin);
    if (initial.state === "succeeded") return initial;
    if (initial.state === "cancelled")
      return yield* new LibraryError({
        reason: "blocked",
        detail: "This operation was cancelled. Start a new operation to continue.",
      });
    const completion = pending.get(id);
    const result = completion ? yield* Deferred.await(completion) : (yield* read(id))?.operation;
    if (!result) return yield* new LibraryError({ reason: "not-found" });
    // A launch with files answers once its conversation exists, while the files still download.
    if (result.state === "running" && result.result !== null) return result;
    if (result.state !== "succeeded")
      return yield* new LibraryError({
        reason: result.failureReason ?? "blocked",
        detail: result.error ?? "Review the interrupted operation, then retry.",
        ...(result.repair ? { repair: result.repair } : {}),
        ...(result.accessRepair ? { accessRepair: result.accessRepair } : {}),
      });
    return result;
  });
  const list = Effect.fn("ProjectOperations.list")(function* (input: {
    projectId?: string | undefined;
    includeFolderImports?: boolean;
  }) {
    const rows = input.projectId
      ? yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_operations WHERE project_id=${input.projectId} ORDER BY created_at DESC LIMIT 100`
      : yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_operations ORDER BY created_at DESC LIMIT 100`;
    const operations = yield* Effect.forEach(rows, (row) =>
      Schema.decodeEffect(operationCodec)(row.payload_json),
    );
    // Older clients cannot decode the new operation kind until they opt into folder imports.
    return input.includeFolderImports === true
      ? operations
      : operations.filter((operation) => operation.kind !== "import");
  }, Effect.mapError(io));
  const cancel = Effect.fn("ProjectOperations.cancel")(
    function* (id: string, actor: OperationActor) {
      const row = yield* read(id);
      if (!row) return yield* new LibraryError({ reason: "not-found" });
      if (!mayControl(row.subject, actor)) return yield* ownedElsewhere(row.subject);
      const request = yield* Schema.decodeEffect(requestCodec)(row.request_json).pipe(
        Effect.mapError(io),
      );
      yield* authorize(actor.sessionId, actor.subject, request);
      if (row.operation.state === "running" || pending.has(id))
        return yield* new LibraryError({
          reason: "blocked",
          detail: "The current step is already running. Let it finish before changing these files.",
        });
      if (row.operation.state === "succeeded") return row.operation;
      if (
        request.kind === "release" &&
        (yield* workspace.cancelRelease(request.input)) === "set-aside"
      )
        return yield* new LibraryError({ reason: "blocked", detail: SET_ASIDE });
      return yield* save({
        ...row.operation,
        state: "cancelled",
        phase: "Cancelled; completed steps were kept",
        updatedAt: yield* now,
      });
    },
    (effect, id) => lock.withLock(id, effect),
  );
  const outcomeClient = Effect.fn("ProjectOperations.outcomeClient")(function* (
    input: LibraryOperationOutcomeRequest,
    sessionId: string,
  ) {
    const actor = yield* currentSession(sessionId).pipe(Effect.mapError(io));
    if (!actor) return yield* denied();
    const id = yield* operationId(input.requestId, input.kind);
    type Row = { subject: string; request_json: string; payload_json: string };
    // Ordinary requests use the primary key; older workflow IDs need the original request payload.
    for (const lookup of [
      sql<Row>`SELECT subject,request_json,payload_json FROM fork_library_operations WHERE id=${id}`,
      sql<Row>`SELECT subject,request_json,payload_json FROM fork_library_operations
        WHERE id=${input.requestId}
        OR (json_extract(request_json,'$.kind')=${input.kind}
            AND json_extract(request_json,'$.input.requestId')=${input.requestId})`,
    ]) {
      const outcomes: LibraryOperation[] = [];
      for (const row of yield* lookup) {
        if (ownershipSubject(row.subject) !== ownershipSubject(actor.subject)) continue;
        const request = yield* Schema.decodeEffect(requestCodec)(row.request_json).pipe(
          Effect.mapError(io),
        );
        if (request.kind !== input.kind) continue;
        if (request.kind !== "launch" && request.input.requestId !== input.requestId) continue;
        outcomes.push(
          yield* Schema.decodeEffect(operationCodec)(row.payload_json).pipe(Effect.mapError(io)),
        );
      }
      if (outcomes.length > 1) return yield* new LibraryError({ reason: "request-conflict" });
      if (outcomes[0]) return outcomes[0];
    }
    return null;
  }, Effect.mapError(io));
  const executeClient = Effect.fn("ProjectOperations.executeClient")(function* (
    id: string,
    request: LibraryOperationInput,
    sessionId: string,
    origin?: LaunchOrigin,
  ) {
    const actor = yield* currentSession(sessionId).pipe(Effect.mapError(io));
    if (!actor) return yield* denied();
    return yield* execute(id, request, actor, origin);
  });
  const executeAgent = Effect.fn("ProjectOperations.executeAgent")(function* (
    id: string,
    request: LibraryOperationInput,
    caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
    origin?: LaunchOrigin,
  ) {
    const thread = yield* threads
      .getThreadShell(caller.threadId)
      .pipe(Effect.mapError(() => denied("workload")));
    if (!thread?.activeRunId) return yield* denied("turn");
    const claims = yield* Schema.encodeEffect(workloadCodec)({
      ...caller,
      runId: thread.activeRunId,
    }).pipe(Effect.mapError(io));
    return yield* execute(
      id,
      request,
      { subject: `workload:${caller.threadId}`, sessionId: `workload:${claims}` },
      origin,
    );
  });
  const shareCreated = Effect.fn("ProjectOperations.shareCreated")(function* (
    project: CreatedProject,
    caller: CreationCaller,
  ) {
    if (!publisher.enabled)
      return {
        state: "unconnected" as const,
        operationId: null,
        projectId: null,
        message:
          "This project is ready on this computer. No Library is connected to save it across computers.",
      };
    const id = yield* operationId(`created-project:${project.id}`, "import").pipe(Effect.orDie);
    const request: LibraryOperationInput = {
      kind: "import",
      input: {
        requestId: id,
        rootPath: project.workspaceRoot,
        ...(project.title === undefined ? {} : { title: project.title.slice(0, 160).trim() }),
      },
    };
    return yield* (
      caller.kind === "client"
        ? executeClient(id, request, caller.sessionId)
        : executeAgent(id, request, caller)
    ).pipe(
      Effect.map((operation): ProjectSharing => ({
        state: "shared",
        operationId: id,
        projectId: operation.projectId,
        message: null,
      })),
      Effect.catch((error) =>
        Effect.succeed({
          state: "pending" as const,
          operationId: id,
          projectId: null,
          message: error.message,
        }),
      ),
    );
  });
  const repositoryPublished = Effect.fn("ProjectOperations.repositoryPublished")(function* (
    project: CreatedProject,
    remoteUrl: string,
    caller: CreationCaller,
  ) {
    const sync = Effect.gen(function* () {
      let inspection = yield* workspace.inspectFolder({ rootPath: project.workspaceRoot });
      if (!(inspection.registrations?.length || inspection.registration)) {
        const sharing = yield* shareCreated(project, caller);
        if (sharing.state !== "shared") return sharing;
        inspection = yield* workspace.inspectFolder({ rootPath: project.workspaceRoot });
      }
      const matches = [];
      for (const registration of inspection.registrations ??
        (inspection.registration ? [inspection.registration] : [])) {
        const { copy } = yield* workspaceStore.get(registration.workingCopyId);
        for (const repository of copy.repositories) {
          if (repository.path === inspection.rootPath)
            matches.push({ copy, resourceId: repository.resourceId });
        }
      }
      if (matches.length !== 1)
        return yield* new LibraryError({
          reason: "blocked",
          detail:
            "The repository was published, but Loom could not identify one current project repository for these files. Its saved URLs were preserved.",
        });
      const { copy, resourceId } = matches[0]!;
      const id = yield* operationId(
        `published-repository:${copy.id}:${resourceId}:${normalizeGitRemoteUrl(remoteUrl)}`,
        "import",
      );
      const request: LibraryOperationInput = {
        kind: "import",
        input: {
          requestId: id,
          rootPath: copy.rootPath,
          projectId: copy.projectId,
          repositoryUpdate: { resourceId, remoteUrl },
        },
      };
      const operation = yield* caller.kind === "client"
        ? executeClient(id, request, caller.sessionId)
        : executeAgent(id, request, caller);
      return {
        state: "shared" as const,
        operationId: id,
        projectId: operation.projectId,
        message: null,
      };
    });
    return yield* sync.pipe(
      Effect.catch((error) =>
        Effect.succeed({
          state: "pending" as const,
          operationId: null,
          projectId: null,
          message: error.message,
        }),
      ),
    );
  });
  const resume = Effect.fn("ProjectOperations.resume")(function* (
    id: string,
    actor: OperationActor,
  ) {
    const row = yield* read(id);
    if (!row) return yield* denied();
    if (!mayControl(row.subject, actor)) return yield* ownedElsewhere(row.subject);
    const request = yield* Schema.decodeEffect(requestCodec)(row.request_json).pipe(
      Effect.mapError(io),
    );
    if (request.kind === "restore")
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "Open Start to renew this restore authorization. Recovery credentials are never stored in operation history.",
      });
    return yield* run(id, request, actor);
  });
  const controlClient = Effect.fn("ProjectOperations.controlClient")(function* (
    id: string,
    action: "resume" | "cancel",
    sessionId: string,
  ) {
    const actor = yield* currentSession(sessionId).pipe(Effect.mapError(io));
    if (!actor) return yield* denied();
    return yield* (action === "resume" ? resume : cancel)(id, actor);
  });
  const controlAgent = Effect.fn("ProjectOperations.controlAgent")(function* (
    id: string,
    action: "resume" | "cancel",
    caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
  ) {
    const thread = yield* threads
      .getThreadShell(caller.threadId)
      .pipe(Effect.mapError(() => denied("workload")));
    if (!thread?.activeRunId) return yield* denied("turn");
    const claims = yield* Schema.encodeEffect(workloadCodec)({
      ...caller,
      runId: thread.activeRunId,
    }).pipe(Effect.mapError(io));
    return yield* (action === "resume" ? resume : cancel)(id, {
      subject: `workload:${caller.threadId}`,
      sessionId: `workload:${claims}`,
    });
  });
  const upgradeOwnership = Effect.fn("ProjectOperations.upgradeOwnership")(function* () {
    if (sessionPrefix === null) return;
    const rows = yield* sql<{
      subject: string;
    }>`SELECT DISTINCT subject FROM fork_library_operations
      WHERE substr(subject,1,${sessionPrefix.length})=${sessionPrefix}`;
    for (const row of rows) {
      const principal = ownershipSubject(row.subject);
      if (principal !== row.subject)
        yield* sql`UPDATE fork_library_operations SET subject=${principal} WHERE subject=${row.subject}`;
    }
  }, Effect.mapError(io));
  yield* upgradeOwnership();
  yield* forkParked(
    Effect.gen(function* () {
      const rows = yield* sql<{
        id: string;
      }>`SELECT id FROM fork_library_operations WHERE state IN ('queued','running')`;
      for (const row of rows) yield* start(row.id);
      // Cancels before cancelRelease existed left removals recorded. Files still in place are
      // forgotten; files already set aside wait for a Resume to finish removing them.
      const cancelled = yield* sql<{
        id: string;
        request_json: string;
      }>`SELECT id,request_json FROM fork_library_operations WHERE state='cancelled'`;
      for (const row of cancelled)
        yield* lock
          .withLock(
            row.id,
            Effect.gen(function* () {
              const request = yield* Schema.decodeEffect(requestCodec)(row.request_json);
              if (
                request.kind !== "release" ||
                (yield* workspace.cancelRelease(request.input)) !== "set-aside"
              )
                return;
              const current = yield* read(row.id);
              if (current?.operation.state !== "cancelled") return;
              yield* save({
                ...current.operation,
                state: "needs-input",
                phase: "Waiting to finish removing files",
                error: SET_ASIDE,
                failureReason: "blocked",
                updatedAt: yield* now,
              });
            }),
          )
          .pipe(Effect.ignore);
    }).pipe(Effect.ignoreCause),
  );
  return {
    shareCreated,
    repositoryPublished,
    operationId,
    list,
    run,
    execute,
    executeAgent,
    executeClient,
    outcomeClient,
    cancel,
    resume,
    controlClient,
    controlAgent,
  };
});
export const layer = Layer.effect(ProjectOperations, make);
