import { ProjectWorkflows } from "./ProjectWorkflows.ts";
import {
  AuthOrchestrationOperateScope,
  AuthSessionId,
  AuthSettingsWriteScope,
  AuthTerminalOperateScope,
  CommandId,
  ThreadId,
  ProviderInstanceId,
  RunId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import {
  LibraryError,
  LibraryOperation,
  LibraryOperationInput,
  LibraryWorkingCopy,
  type LibraryRecoveryGrant,
  type LibraryResolvedBinding,
} from "@t3tools/contracts/fork";
import {
  buildTemporaryWorktreeBranchName,
  flattenTemporaryWorktreeBranchName,
  WORKTREE_BRANCH_PREFIX,
} from "@t3tools/shared/git";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { isVaultRunRunning } from "../vault/active-run.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../../serverActivation.ts";
import { LibraryService } from "./LibraryService.ts";
import { LibraryWorkspaceStore } from "./LibraryWorkspaceStore.ts";
import { LibraryWorkspace } from "./LibraryWorkspace.ts";

const isLibraryFailure = Schema.is(LibraryError);
const io = (cause: unknown) =>
  isLibraryFailure(cause) ? cause : new LibraryError({ reason: "io" });
const denied = (reason: "session" | "turn" | "workload" | "owner" = "session", threadId?: string) =>
  new LibraryError({
    reason: "blocked",
    detail:
      reason === "turn"
        ? "The conversation that started this operation is no longer running a turn. Resume it from that conversation with loom_library_operation_control."
        : reason === "workload"
          ? "This operation's agent authorization is no longer current. Resume it from its original conversation during a full-access/default turn with loom_library_operation_control."
          : reason === "owner"
            ? threadId?.startsWith("workload:")
              ? `This operation was started by an agent in conversation ${threadId.slice(9)}. Resume or cancel it from that conversation with loom_library_operation_control.`
              : "This operation belongs to another signed-in session. Use the session that started it to resume or cancel."
            : "This device's sign-in is no longer current. Sign in again from Connections in Settings, then retry.",
  });
type OperationActor = { readonly subject: string; readonly sessionId: string };
const Workload = Schema.Struct({
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  runId: RunId,
});
const workloadCodec = Schema.fromJsonString(Workload);
const operationCodec = Schema.fromJsonString(LibraryOperation);
const requestCodec = Schema.fromJsonString(LibraryOperationInput);
const copyCodec = Schema.fromJsonString(LibraryWorkingCopy);
const worktreeCodec = Schema.fromJsonString(
  Schema.Struct({ path: Schema.String, branch: Schema.String }),
);
function operationScopes(kind: LibraryOperationInput["kind"]): readonly AuthEnvironmentScope[] {
  return kind === "create"
    ? [AuthSettingsWriteScope]
    : kind === "launch"
      ? [AuthTerminalOperateScope, AuthOrchestrationOperateScope]
      : kind === "release" || kind === "unregister"
        ? [AuthOrchestrationOperateScope]
        : [AuthTerminalOperateScope];
}
export class ProjectOperations extends Context.Service<
  ProjectOperations,
  {
    readonly operationId: (
      requestId: string,
      kind: LibraryOperationInput["kind"],
    ) => Effect.Effect<string, LibraryError>;
    readonly executeClient: (
      id: string,
      request: LibraryOperationInput,
      sessionId: string,
    ) => Effect.Effect<LibraryOperation, LibraryError>;
    readonly executeAgent: (
      id: string,
      request: LibraryOperationInput,
      caller: { readonly threadId: ThreadId; readonly providerInstanceId: ProviderInstanceId },
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
    }) => Effect.Effect<readonly LibraryOperation[], LibraryError>;
    readonly run: (
      id: string,
      request: LibraryOperationInput,
      actor: OperationActor,
    ) => Effect.Effect<LibraryOperation, LibraryError>;
    readonly execute: (
      id: string,
      request: LibraryOperationInput,
      actor: OperationActor,
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
  const crypto = yield* Crypto.Crypto;
  /** Existing IDs stay stable; maximum-length client request IDs still leave room for the operation kind. */
  const operationId = Effect.fn("ProjectOperations.operationId")(function* (
    requestId: string,
    kind: LibraryOperationInput["kind"],
  ) {
    const candidate = `${requestId}:${kind}`;
    if (candidate.length <= 200) return candidate;
    const digest = yield* crypto
      .digest("SHA-256", new TextEncoder().encode(requestId))
      .pipe(Effect.mapError(io));
    return `${Hex.encode(digest)}:${kind}`;
  });

  const library = yield* LibraryService;
  const workflows = yield* ProjectWorkflows;
  const workspace = yield* LibraryWorkspace;
  const workspaceStore = yield* LibraryWorkspaceStore;
  const threads = yield* ThreadManagementService;
  const sessions = yield* SessionStore;
  const git = yield* GitWorkflowService;
  const fs = yield* FileSystem.FileSystem;
  const identity = yield* ServerEnvironmentIdentity;
  const environmentId = yield* identity.getEnvironmentId;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
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
    const active = (yield* sessions.listActive()).filter((session) => chain.has(session.sessionId));
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
    const required = operationScopes(request.kind);
    if (
      active?.subject !== subject ||
      !required.every((permission) => active.scopes.includes(permission))
    )
      return yield* denied();
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
    if (resolved.repositoryPaths.length !== 1 || resolved.repositoryPaths[0] !== resolved.cwd)
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "Only a conversation working in one repository can start in its own worktree. Choose that repository, or start in the project folder.",
      });
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
        yield* fs.writeFileString(
          `${worktree.path}.t3-setup-pending`,
          "Workspace setup must complete before starting the agent.\n",
        );
        const payload = yield* Schema.encodeEffect(worktreeCodec)(worktree);
        yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${receiptId},${"worktree"},${payload})`;
        return worktree;
      }),
    );
  }, Effect.mapError(io));
  const worker = Effect.fn("ProjectOperations.worker")(function* (id: string) {
    const row = yield* read(id);
    if (!row || ["succeeded", "cancelled"].includes(row.operation.state))
      return row?.operation ?? null;
    const request = yield* Schema.decodeEffect(requestCodec)(row.request_json).pipe(
      Effect.mapError(io),
    );
    let operation = row.operation;
    const phase = Effect.fn("ProjectOperations.phase")(function* (name: string) {
      yield* authorize(row.session_id, row.subject, request);
      operation = yield* save({
        ...operation,
        phase: name,
        state: "running",
        error: null,
        updatedAt: yield* now,
      });
    });
    const action = Effect.gen(function* () {
      yield* phase("Checking access");
      let result: LibraryOperation["result"];
      switch (request.kind) {
        case "create":
          yield* phase("Creating project");
          result = yield* library.createProject(request.input);
          break;
        case "prepare":
          yield* phase("Preparing files");
          result = yield* workspace.prepareCopy(request.input);
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
          if (input.binding.environmentId !== environmentId)
            return yield* new LibraryError({ reason: "invalid" });
          yield* phase("Checking files and project scope");
          const resolved = yield* workspace.resolveBinding({
            binding: input.binding,
            project: input.project,
          });
          if (input.workspace === "worktree") yield* phase("Creating worktree");
          const worktree =
            input.workspace === "worktree" ? yield* launchWorktree(id, resolved) : null;
          yield* phase("Creating conversation");
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
              createdBy: row.session_id.startsWith("workload:") ? "agent" : "user",
              creationSource: row.session_id.startsWith("workload:") ? "mcp" : "web",
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
            binding: input.binding,
            project: input.project,
            ...(worktree === null ? {} : { worktreePath: worktree.path }),
          });
          if (input.keepOnComputer !== undefined) {
            yield* phase("Saving file retention");
            // The receipt keeps a retried launch from undoing a change made since the first try.
            const saved = yield* sql<{
              id: string;
            }>`SELECT id FROM fork_library_workflow_receipts WHERE id=${`${id}:retention`}`;
            if (!saved[0]) {
              const copy = yield* workspace.setCopyRetention({
                workingCopyId: input.binding.workingCopyId,
                keepOnComputer: input.keepOnComputer,
              });
              const payload = yield* Schema.encodeEffect(copyCodec)(copy).pipe(Effect.mapError(io));
              yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${`${id}:retention`},${"retention"},${payload})`.pipe(
                Effect.mapError(io),
              );
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
          request.kind === "create" && result && "resources" in result
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
    yield* worker(id).pipe(
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
  const run = Effect.fn("ProjectOperations.run")(function* (
    id: string,
    request: LibraryOperationInput,
    actor: OperationActor,
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
    if (existing && (existing.subject !== actor.subject || existing.request_json !== encoded))
      return yield* new LibraryError({ reason: "request-conflict" });
    if (existing && ["succeeded", "cancelled"].includes(existing.operation.state))
      return existing.operation;
    if (existing && pending.has(id)) return existing.operation;
    const timestamp = yield* now;
    const projectId =
      request.kind === "create"
        ? null
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
      result: null,
      createdAt: existing?.operation.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const payload = yield* Schema.encodeEffect(operationCodec)(value).pipe(Effect.mapError(io));
    yield* sql`INSERT INTO fork_library_operations (id,subject,session_id,request_json,payload_json,state,project_id,created_at) VALUES (${id},${actor.subject},${actor.sessionId},${encoded},${payload},${value.state},${projectId},${value.createdAt}) ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id,payload_json=excluded.payload_json,state=excluded.state`.pipe(
      Effect.mapError(io),
    );
    yield* workflows.changed;
    if (request.kind === "restore") restoreGrants.set(id, request.input.grant);
    yield* start(id);
    return value;
  }, lock.withPermit);
  const execute = Effect.fn("ProjectOperations.execute")(function* (
    id: string,
    request: LibraryOperationInput,
    actor: OperationActor,
  ) {
    const initial = yield* run(id, request, actor);
    if (initial.state === "succeeded") return initial;
    if (initial.state === "cancelled")
      return yield* new LibraryError({
        reason: "blocked",
        detail: "This operation was cancelled. Start a new operation to continue.",
      });
    const completion = pending.get(id);
    const result = completion ? yield* Deferred.await(completion) : (yield* read(id))?.operation;
    if (!result) return yield* new LibraryError({ reason: "not-found" });
    if (result.state !== "succeeded")
      return yield* new LibraryError({
        reason: result.failureReason ?? "blocked",
        detail: result.error ?? "Review the interrupted operation, then retry.",
        ...(result.repair ? { repair: result.repair } : {}),
      });
    return result;
  });
  const list = Effect.fn("ProjectOperations.list")(function* (input: {
    projectId?: string | undefined;
  }) {
    const rows = input.projectId
      ? yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_operations WHERE project_id=${input.projectId} ORDER BY created_at DESC LIMIT 100`
      : yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_operations ORDER BY created_at DESC LIMIT 100`;
    return yield* Effect.forEach(rows, (row) =>
      Schema.decodeEffect(operationCodec)(row.payload_json),
    );
  }, Effect.mapError(io));
  const cancel = Effect.fn("ProjectOperations.cancel")(function* (
    id: string,
    actor: OperationActor,
  ) {
    const row = yield* read(id);
    if (!row) return yield* new LibraryError({ reason: "not-found" });
    if (row.subject !== actor.subject) return yield* denied("owner", row.subject);
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
    return yield* save({
      ...row.operation,
      state: "cancelled",
      phase: "Cancelled; completed steps were kept",
      updatedAt: yield* now,
    });
  }, lock.withPermit);
  const executeClient = Effect.fn("ProjectOperations.executeClient")(function* (
    id: string,
    request: LibraryOperationInput,
    sessionId: string,
  ) {
    const actor = yield* currentSession(sessionId).pipe(Effect.mapError(io));
    if (!actor) return yield* denied();
    return yield* execute(id, request, actor);
  });
  const executeAgent = Effect.fn("ProjectOperations.executeAgent")(function* (
    id: string,
    request: LibraryOperationInput,
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
    return yield* execute(id, request, {
      subject: `workload:${caller.threadId}`,
      sessionId: `workload:${claims}`,
    });
  });
  const resume = Effect.fn("ProjectOperations.resume")(function* (
    id: string,
    actor: OperationActor,
  ) {
    const row = yield* read(id);
    if (!row) return yield* denied();
    if (row.subject !== actor.subject) return yield* denied("owner", row.subject);
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
  yield* forkParked(
    Effect.gen(function* () {
      const rows = yield* sql<{
        id: string;
      }>`SELECT id FROM fork_library_operations WHERE state IN ('queued','running')`;
      for (const row of rows) yield* start(row.id);
    }).pipe(Effect.catchCause(() => Effect.void)),
  );
  return {
    operationId,
    list,
    run,
    execute,
    executeAgent,
    executeClient,
    cancel,
    resume,
    controlClient,
    controlAgent,
  };
});
export const layer = Layer.effect(ProjectOperations, make);
