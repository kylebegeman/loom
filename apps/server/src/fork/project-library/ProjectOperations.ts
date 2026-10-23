import { ProjectWorkflows } from "./ProjectWorkflows.ts";
import {
  AuthOrchestrationOperateScope,
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
  LibraryThreadArchive,
  LibraryWorkingCopy,
  type LibraryRecoveryGrant,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { isVaultRunRunning } from "../vault/active-run.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../../serverActivation.ts";
import { LibraryService } from "./LibraryService.ts";
import { LibraryWorkspaceStore } from "./LibraryWorkspaceStore.ts";
import { LibraryWorkspace } from "./LibraryWorkspace.ts";
import { LibraryPublisher } from "./LibraryPublisher.ts";
import { LibraryHistorySource } from "./LibraryHistorySource.ts";

const isLibraryFailure = Schema.is(LibraryError);
const io = (cause: unknown) =>
  isLibraryFailure(cause) ? cause : new LibraryError({ reason: "io" });
const denied = () =>
  new LibraryError({
    reason: "blocked",
    detail: "This operation needs a current authorized session. Sign in again, then retry.",
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
const archiveCodec = Schema.fromJsonString(Schema.toCodecJson(LibraryThreadArchive));
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
  const library = yield* LibraryService;
  const workflows = yield* ProjectWorkflows;
  const workspace = yield* LibraryWorkspace;
  const workspaceStore = yield* LibraryWorkspaceStore;
  const publisher = yield* LibraryPublisher;
  const history = yield* LibraryHistorySource;
  const threads = yield* ThreadManagementService;
  const sessions = yield* SessionStore;
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
  const authorize = Effect.fn("ProjectOperations.authorize")(function* (
    sessionId: string,
    subject: string,
    request: LibraryOperationInput,
  ) {
    if (sessionId.startsWith("workload:")) {
      const claims = yield* Schema.decodeEffect(workloadCodec)(sessionId.slice(9)).pipe(
        Effect.mapError(() => denied()),
      );
      const thread = yield* threads
        .getThreadShell(claims.threadId)
        .pipe(Effect.mapError(() => denied()));
      if (
        !thread ||
        thread.archivedAt !== null ||
        thread.deletedAt !== null ||
        thread.activeRunId !== claims.runId ||
        thread.providerInstanceId !== claims.providerInstanceId ||
        thread.runtimeMode !== "full-access" ||
        thread.interactionMode !== "default" ||
        !(yield* isVaultRunRunning(threads, thread))
      )
        return yield* denied();
      return;
    }
    const active = (yield* sessions.listActive()).find(
      (session) => session.sessionId === sessionId && session.subject === subject,
    );
    const required = operationScopes(request.kind);
    if (!active || !required.every((permission) => active.scopes.includes(permission)))
      return yield* denied();
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
              branch: null,
              worktreePath: resolved.cwd,
              createdBy: row.session_id.startsWith("workload:") ? "agent" : "user",
              creationSource: row.session_id.startsWith("workload:") ? "mcp" : "web",
            })
            .pipe(Effect.mapError(io));
          yield* phase("Binding conversation to files");
          yield* workspace.bindThread({
            threadId: input.threadId,
            binding: input.binding,
            project: input.project,
          });
          if (input.keepOnComputer !== undefined) {
            yield* phase("Saving file retention");
            const saved = yield* sql<{
              result_json: string;
            }>`SELECT result_json FROM fork_library_workflow_receipts WHERE id=${`${id}:retention`}`;
            const copy = saved[0]
              ? yield* Schema.decodeEffect(copyCodec)(saved[0].result_json).pipe(
                  Effect.mapError(io),
                )
              : yield* workspace.setCopyRetention({
                  workingCopyId: input.binding.workingCopyId,
                  keepOnComputer: input.keepOnComputer,
                });
            if (!saved[0]) {
              const payload = yield* Schema.encodeEffect(copyCodec)(copy).pipe(Effect.mapError(io));
              yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${`${id}:retention`},${"retention"},${payload})`.pipe(
                Effect.mapError(io),
              );
            }
            yield* publisher.registerCopy({ requestId: `${id}:retention`, copy });
          }
          yield* phase("Saving conversation in Library");
          const snapshots = yield* sql<{
            result_json: string;
          }>`SELECT result_json FROM fork_library_workflow_receipts WHERE id=${`${id}:snapshot`}`;
          const archive = snapshots[0]
            ? yield* Schema.decodeEffect(archiveCodec)(snapshots[0].result_json).pipe(
                Effect.mapError(io),
              )
            : yield* history.snapshotThread({ threadId: input.threadId });
          if (!snapshots[0]) {
            const payload = yield* Schema.encodeEffect(archiveCodec)(archive).pipe(
              Effect.mapError(io),
            );
            yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${"" + id + ":snapshot"},${"snapshot"},${payload})`.pipe(
              Effect.mapError(io),
            );
          }
          yield* publisher.publishAttachments(archive);
          yield* publisher.ingest({
            requestId: `${id}:publish`,
            sourceEnvironmentId: environmentId,
            journalId: `launch:${id}`,
            fromSequence: 0,
            entries: [{ sequence: 1, thread: archive }],
          });
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
      Effect.catch((error) =>
        Effect.gen(function* () {
          return yield* save({
            ...operation,
            state: io(error).reason === "blocked" ? "needs-input" : "failed",
            error: io(error).message,
            failureReason: io(error).reason,
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
      Effect.ensuring(release),
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
    if (existing?.operation.state === "running" && pending.has(id)) return existing.operation;
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
    if (["succeeded", "cancelled"].includes(initial.state)) return initial;
    const completion = pending.get(id);
    const result = completion ? yield* Deferred.await(completion) : (yield* read(id))?.operation;
    if (!result) return yield* new LibraryError({ reason: "not-found" });
    if (result.state !== "succeeded")
      return yield* new LibraryError({
        reason: result.failureReason ?? "blocked",
        detail: result.error ?? "Review the interrupted operation, then retry.",
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
    if (row.subject !== actor.subject) return yield* denied();
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
    const actor = (yield* sessions.listActive().pipe(Effect.mapError(io))).find(
      (session) => session.sessionId === sessionId,
    );
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
      .pipe(Effect.mapError(() => denied()));
    if (!thread?.activeRunId) return yield* denied();
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
    if (!row || row.subject !== actor.subject) return yield* denied();
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
    const actor = (yield* sessions.listActive().pipe(Effect.mapError(io))).find(
      (session) => session.sessionId === sessionId,
    );
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
      .pipe(Effect.mapError(() => denied()));
    if (!thread?.activeRunId) return yield* denied();
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
