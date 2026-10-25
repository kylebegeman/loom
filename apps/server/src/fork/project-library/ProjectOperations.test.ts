import { ProjectWorkflows } from "./ProjectWorkflows.ts";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ThreadId,
  ProviderInstanceId,
  AuthSessionId,
  ProjectId,
  AuthSettingsWriteScope,
  AuthTerminalOperateScope,
  AuthOrchestrationOperateScope,
  EnvironmentId,
  type AuthClientSession,
  type OrchestrationV2ThreadShell,
  type VcsCreateWorktreeInput,
  type VcsStatusLocalResult,
} from "@t3tools/contracts";
import {
  LibraryError,
  LibraryOperation,
  LibraryOperationInput,
  type LibraryProject,
  type LibraryRecoveryGrant,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import { LibraryService } from "./LibraryService.ts";
import { LibraryWorkspaceStore } from "./LibraryWorkspaceStore.ts";
import { LibraryWorkspace } from "./LibraryWorkspace.ts";
import * as ProjectOperations from "./ProjectOperations.ts";
import { copyFor, resource } from "./Library.testkit.ts";

const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(LibraryOperationInput));
const encodeOperation = Schema.encodeEffect(Schema.fromJsonString(LibraryOperation));
const environmentId = EnvironmentId.make("computer");
const actor = { sessionId: AuthSessionId.make("session"), subject: "owner" };
const project: LibraryProject = {
  id: "project",
  title: "Project",
  brief: "",
  revision: 1,
  archived: false,
  resources: [resource],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const create: LibraryOperationInput = {
  kind: "create",
  input: { requestId: "create", title: "Project" },
};
const session = (
  scopes: AuthClientSession["scopes"] = [
    AuthSettingsWriteScope,
    AuthTerminalOperateScope,
    AuthOrchestrationOperateScope,
  ],
): AuthClientSession => ({
  ...actor,
  method: "browser-session-cookie",
  scopes,
  client: { deviceType: "desktop" },
  issuedAt: DateTime.makeUnsafe(0),
  expiresAt: DateTime.makeUnsafe(9999999999999),
  lastConnectedAt: null,
  connected: true,
  current: true,
});
const fixture = Effect.gen(function* () {
  const active = yield* Ref.make<readonly AuthClientSession[]>([session()]);
  const calls = yield* Ref.make(0);
  const failure = yield* Ref.make(false);
  const prepareFailure = yield* Ref.make<LibraryError | null>(null);
  const defect = yield* Ref.make(false);
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const pause = yield* Ref.make(false);
  const revokeAfterRead = yield* Ref.make(false);
  const dispatched = yield* Ref.make<string[]>([]);
  const retentionSaves = yield* Ref.make(0);
  const failBind = yield* Ref.make(false);
  const threadDeleted = yield* Ref.make(false);
  const revokeAtResolve = yield* Ref.make(false);
  const observedToken = yield* Ref.make<string | null>(null);
  const repositoryPaths = yield* Ref.make<readonly string[]>([]);
  const worktreePath = yield* Ref.make("/work/worktree");
  const worktreesMade = yield* Ref.make<readonly VcsCreateWorktreeInput[]>([]);
  const createdIn = yield* Ref.make<
    readonly { branch: string | null; worktreePath: string | null }[]
  >([]);
  const boundIn = yield* Ref.make<readonly (string | undefined)[]>([]);
  const external = Layer.mergeAll(
    Layer.mock(ProjectWorkflows)({ changed: Effect.void, changes: Stream.empty }),
    Layer.mock(LibraryService)({
      createProject: () =>
        Effect.gen(function* () {
          yield* Ref.update(calls, (count) => count + 1);
          yield* Deferred.succeed(entered, undefined);
          if (yield* Ref.get(pause)) yield* Deferred.await(release);
          if (yield* Ref.get(defect)) return yield* Effect.die(new Error("private backend detail"));
          if (yield* Ref.get(failure))
            return yield* new LibraryError({ reason: "revision-conflict" });
          return project;
        }),
    }),
    Layer.mock(LibraryWorkspaceStore)({
      get: () =>
        Effect.succeed({
          requestId: "copy",
          fingerprint: "copy",
          project,
          copy: copyFor(project),
          rootLocalProjectId: null,
          rootCheckpointRepository: false,
          legacyThreadIds: [],
          rootIdentity: null,
          releaseRequestId: null,
          releaseReviewToken: null,
          removalPath: null,
          archivePath: null,
          archiveDigest: null,
        }),
    }),
    Layer.mock(LibraryWorkspace)({
      setCopyRetention: (input) =>
        Ref.update(retentionSaves, (count) => count + 1).pipe(
          Effect.as({ ...copyFor(project), environmentId, keepOnComputer: input.keepOnComputer }),
        ),
      resolveBinding: (input) =>
        Ref.get(revokeAtResolve).pipe(
          Effect.flatMap((revoke) => (revoke ? Ref.set(active, []) : Effect.void)),
          Effect.andThen(Ref.get(repositoryPaths)),
          Effect.map((paths) => ({
            binding: input.binding,
            localProjectId: ProjectId.make("local"),
            cwd: "/work/project",
            repositoryPaths: paths,
          })),
        ),
      bindThread: (input) =>
        Ref.update(boundIn, (paths) => [...paths, input.worktreePath]).pipe(
          Effect.andThen(Ref.get(failBind)),
          Effect.flatMap((fail) =>
            fail
              ? Effect.fail(new LibraryError({ reason: "io", detail: "Reconnect the computer." }))
              : Effect.succeed({
                  binding: input.binding,
                  localProjectId: ProjectId.make("local"),
                  cwd: "/work/project",
                  repositoryPaths: [],
                }),
          ),
        ),
      prepareCopy: () =>
        Ref.get(prepareFailure).pipe(
          Effect.flatMap((error) =>
            error ? Effect.fail(error) : Effect.succeed({ ...copyFor(project), environmentId }),
          ),
        ),
      restoreCopy: (input) =>
        Ref.set(observedToken, input.grant.accessToken).pipe(
          Effect.as({ ...copyFor(project), environmentId }),
        ),
      release: () =>
        Effect.fail(new LibraryError({ reason: "blocked", detail: "The reviewed files changed." })),
    }),
    Layer.mock(ThreadManagementService)({
      // Only what the launch reads: whether the conversation it created still exists.
      getThreadShell: () =>
        Ref.get(threadDeleted).pipe(
          Effect.map(
            (deleted) =>
              ({
                deletedAt: deleted ? DateTime.makeUnsafe("2026-10-25T00:00:00Z") : null,
              }) as OrchestrationV2ThreadShell,
          ),
        ),
      dispatch: (command) =>
        Ref.update(dispatched, (ids) => [...ids, command.commandId]).pipe(
          Effect.andThen(
            command.type === "thread.create"
              ? Ref.update(createdIn, (list) => [
                  ...list,
                  { branch: command.branch, worktreePath: command.worktreePath },
                ])
              : Effect.void,
          ),
          Effect.as({ sequence: 1, storedEvents: [] }),
        ),
    }),
    Layer.mock(GitWorkflowService)({
      hasCommit: () => Effect.succeed(false),
      localStatus: () => Effect.succeed({ refName: "main" } as VcsStatusLocalResult),
      createWorktree: (input) =>
        Ref.update(worktreesMade, (made) => [...made, input]).pipe(
          Effect.andThen(Ref.get(worktreePath)),
          Effect.map((path) => ({
            worktree: { path, refName: input.newRefName ?? input.refName },
          })),
        ),
    }),
    Layer.mock(SessionStore)({
      cookieName: "test",
      legacyCookieName: undefined,
      listActive: () =>
        Effect.gen(function* () {
          const value = yield* Ref.get(active);
          if (yield* Ref.get(revokeAfterRead)) yield* Ref.set(active, []);
          return value;
        }),
    }),
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(environmentId) }),
  );
  return {
    repositoryPaths,
    worktreePath,
    worktreesMade,
    createdIn,
    boundIn,
    retentionSaves,
    dispatched,
    failBind,
    threadDeleted,
    revokeAtResolve,
    active,
    calls,
    failure,
    prepareFailure,
    defect,
    entered,
    release,
    pause,
    observedToken,
    external,
    revokeAfterRead,
  };
});
const run = <A, E, R>(
  use: (
    state: Effect.Success<typeof fixture> & {
      service: ProjectOperations.ProjectOperations["Service"];
    },
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ProjectLibraryMigrations);
    const state = yield* fixture;
    return yield* Effect.flatMap(ProjectOperations.ProjectOperations, (service) =>
      use({ ...state, service }),
    ).pipe(Effect.provide(ProjectOperations.layer.pipe(Layer.provide(state.external))));
  }).pipe(Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped);

describe("Project operations", () => {
  it.effect(
    "persists a clone repair through operation failure and clears it after a successful retry",
    () =>
      run((state) =>
        Effect.gen(function* () {
          const repair = {
            kind: "github-host-setup" as const,
            environmentId,
            label: "Computer",
            agentTool: "loom_github_host_setup" as const,
            action: "start" as const,
          };
          const request: LibraryOperationInput = {
            kind: "prepare",
            input: { requestId: "clone", project, rootPath: "/test/clone", strategy: "clone" },
          };
          yield* Ref.set(
            state.prepareFailure,
            new LibraryError({
              reason: "blocked",
              detail: "Git authentication failed on Computer.",
              repair,
            }),
          );
          const error = yield* state.service.execute("clone", request, actor).pipe(Effect.flip);
          expect(error.repair).toEqual(repair);
          expect((yield* state.service.list({}))[0]).toMatchObject({
            state: "needs-input",
            repair,
          });
          yield* Ref.set(state.prepareFailure, null);
          const retried = yield* state.service.execute("clone", request, actor);
          expect(retried.state).toBe("succeeded");
          expect(retried.repair).toBeUndefined();
        }),
      ),
  );
  it.effect("deduplicates accepted operations and rejects changed inputs or another subject", () =>
    run((state) =>
      Effect.gen(function* () {
        const first = yield* state.service.execute("operation", create, actor);
        expect(first.state).toBe("succeeded");
        expect(yield* state.service.execute("operation", create, actor)).toEqual(first);
        expect(yield* Ref.get(state.calls)).toBe(1);
        expect(
          (yield* state.service
            .execute(
              "operation",
              { kind: "create", input: { ...create.input, title: "Changed" } },
              actor,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("request-conflict");
        yield* Ref.set(state.active, [
          { ...session(), sessionId: AuthSessionId.make("other"), subject: "other-owner" },
        ]);
        expect(
          (yield* state.service
            .execute("operation", create, { sessionId: "other", subject: "other-owner" })
            .pipe(Effect.flip)).reason,
        ).toBe("request-conflict");
      }),
    ),
  );
  it.effect("keeps derived operation IDs controllable for maximum-length client request IDs", () =>
    run((state) =>
      Effect.gen(function* () {
        const requestId = "a".repeat(200);
        const id = yield* state.service.operationId(requestId, "create");
        expect(id.length).toBeLessThanOrEqual(200);
        expect(id).not.toBe(yield* state.service.operationId("b".repeat(200), "create"));
        expect(yield* state.service.operationId("ordinary", "create")).toBe("ordinary:create");
        expect(
          (yield* state.service.execute(
            id,
            { kind: "create", input: { requestId, title: "Project" } },
            actor,
          )).state,
        ).toBe("succeeded");
        expect((yield* state.service.controlClient(id, "resume", actor.sessionId)).state).toBe(
          "succeeded",
        );
      }),
    ),
  );
  it.effect("retains typed failures and retries the same request with a renewed session", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.failure, true);
        expect(
          (yield* state.service.execute("operation", create, actor).pipe(Effect.flip)).reason,
        ).toBe("revision-conflict");
        expect((yield* state.service.list({}))[0]?.state).toBe("failed");
        yield* Ref.set(state.failure, false);
        const renewed = { ...actor, sessionId: AuthSessionId.make("renewed") };
        yield* Ref.set(state.active, [{ ...session(), ...renewed }]);
        expect((yield* state.service.execute("operation", create, renewed)).state).toBe(
          "succeeded",
        );
        expect((yield* state.service.list({}))[0]?.attempt).toBe(2);
      }),
    ),
  );
  it.effect("records unexpected worker failures and keeps the same operation retryable", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.defect, true);
        const error = yield* state.service.execute("defect", create, actor).pipe(Effect.flip);
        expect(error.reason).toBe("io");
        const failed = (yield* state.service.list({}))[0];
        expect(failed?.state).toBe("failed");
        expect(failed?.error).not.toContain("private backend detail");
        yield* Ref.set(state.defect, false);
        expect((yield* state.service.execute("defect", create, actor)).state).toBe("succeeded");
      }),
    ),
  );
  it.effect("does not return cancelled work as a successful execution", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.failure, true);
        yield* state.service.execute("cancelled", create, actor).pipe(Effect.flip);
        yield* state.service.cancel("cancelled", actor);
        expect(
          (yield* state.service.execute("cancelled", create, actor).pipe(Effect.flip)).reason,
        ).toBe("blocked");
        expect(yield* Ref.get(state.calls)).toBe(1);
      }),
    ),
  );
  it.effect("continues after its caller disconnects and refuses cancellation mid-step", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.pause, true);
        const caller = yield* state.service
          .execute("operation", create, actor)
          .pipe(Effect.forkChild);
        yield* Deferred.await(state.entered);
        expect(
          (yield* state.service.cancel("operation", actor).pipe(Effect.flip)).message,
        ).toContain("already running");
        yield* Fiber.interrupt(caller);
        yield* Deferred.succeed(state.release, undefined);
        const result = yield* state.service.execute("operation", create, actor);
        expect(result.state).toBe("succeeded");
        expect(yield* Ref.get(state.calls)).toBe(1);
      }),
    ),
  );
  it.effect("refuses revoked or under-scoped sessions before dispatch", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.active, [session([AuthTerminalOperateScope])]);
        expect(
          (yield* state.service.execute("denied", create, actor).pipe(Effect.flip)).reason,
        ).toBe("blocked");
        expect(yield* Ref.get(state.calls)).toBe(0);
        yield* Ref.set(state.active, []);
        expect((yield* state.service.run("revoked", create, actor).pipe(Effect.flip)).reason).toBe(
          "blocked",
        );
      }),
    ),
  );
  it.effect("preserves existing file review blockers rather than bypassing them", () =>
    run((state) =>
      Effect.gen(function* () {
        const request: LibraryOperationInput = {
          kind: "release",
          input: { requestId: "release", workingCopyId: "copy", reviewToken: "old-review" },
        };
        const error = yield* state.service.execute("release", request, actor).pipe(Effect.flip);
        expect(error.reason).toBe("blocked");
        expect(error.message).toBe("The reviewed files changed.");
        const cancelled = yield* state.service.cancel("release", actor);
        expect(cancelled.state).toBe("cancelled");
        expect((yield* state.service.resume("release", actor)).state).toBe("cancelled");
      }),
    ),
  );
  it.effect(
    "does not persist recovery bearer tokens and requires fresh authorization to resume",
    () =>
      run((state) =>
        Effect.gen(function* () {
          const grant: LibraryRecoveryGrant = {
            sourceCopy: copyFor(project),
            destinationEnvironmentId: environmentId,
            libraryEnvironmentId: EnvironmentId.make("authority"),
            expiresAt: "2099-01-01T00:00:00.000Z",
            accessToken: "disposable-recovery-token",
          };
          const request: LibraryOperationInput = {
            kind: "restore",
            input: { requestId: "restore", project, rootPath: "/test/restore", grant },
          };
          expect((yield* state.service.execute("restore", request, actor)).state).toBe("succeeded");
          expect(yield* Ref.get(state.observedToken)).toBe(grant.accessToken);
          const sql = yield* SqlClient.SqlClient;
          const rows = yield* sql<{
            request_json: string;
            payload_json: string;
          }>`SELECT request_json,payload_json FROM fork_library_operations WHERE id='restore'`;
          expect(rows[0]?.request_json).not.toContain(grant.accessToken);
          expect(rows[0]?.payload_json).not.toContain(grant.accessToken);
          expect(
            (yield* state.service.execute(
              "restore",
              {
                ...request,
                input: {
                  ...request.input,
                  grant: {
                    ...grant,
                    expiresAt: "2099-02-01T00:00:00.000Z",
                    accessToken: "renewed-disposable-token",
                  },
                },
              },
              actor,
            )).state,
          ).toBe("succeeded");
          expect(
            (yield* state.service.resume("restore", actor).pipe(Effect.flip)).message,
          ).toContain("renew");
        }),
      ),
  );
  it.effect("tells a signed-in client which conversation owns an agent operation", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* state.service.execute("agent-owned", create, actor);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE fork_library_operations SET subject=${"workload:owning-thread"} WHERE id=${"agent-owned"}`;
        for (const action of ["resume", "cancel"] as const) {
          const error = yield* state.service
            .controlClient("agent-owned", action, actor.sessionId)
            .pipe(Effect.flip);
          expect(error.message).toContain("agent in conversation owning-thread");
          expect(error.message).not.toContain("Sign in");
        }
      }),
    ),
  );
  it.effect("does not let an inactive workload inherit human session authorization", () =>
    run((state) =>
      Effect.gen(function* () {
        const error = yield* state.service
          .executeAgent("agent", create, {
            threadId: ThreadId.make("inactive"),
            providerInstanceId: ProviderInstanceId.make("codex"),
          })
          .pipe(Effect.flip);
        expect(error.reason).toBe("blocked");
        expect(error.message).toContain("no longer running a turn");
        expect(error.message).toContain("loom_library_operation_control");
        expect(error.message).not.toContain("Sign in");
        expect(yield* Ref.get(state.calls)).toBe(0);
      }),
    ),
  );
  it.effect("rechecks authorization when queued work starts", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.revokeAfterRead, true);
        expect(
          (yield* state.service.execute("revoked-at-start", create, actor).pipe(Effect.flip))
            .reason,
        ).toBe("blocked");
        expect(yield* Ref.get(state.calls)).toBe(0);
      }),
    ),
  );
  it.effect("recovers a durable queued operation after service reconstruction", () =>
    run((state) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const request = yield* encodeRequest(create);
        const operation = yield* encodeOperation({
          id: "restart",
          kind: "create",
          projectId: null,
          environmentId,
          state: "queued",
          phase: "Waiting to start",
          attempt: 1,
          error: null,
          result: null,
          createdAt: project.createdAt,
          updatedAt: project.createdAt,
        });
        yield* sql`INSERT INTO fork_library_operations (id,subject,session_id,request_json,payload_json,state,project_id,created_at) VALUES ('restart',${actor.subject},${actor.sessionId},${request},${operation},'queued',NULL,${project.createdAt})`;
        yield* Effect.flatMap(ProjectOperations.ProjectOperations, (restarted) =>
          Effect.gen(function* () {
            yield* Deferred.await(state.entered);
            expect((yield* restarted.execute("restart", create, actor)).state).toBe("succeeded");
            expect(yield* Ref.get(state.calls)).toBe(1);
          }),
        ).pipe(Effect.provide(ProjectOperations.layer.pipe(Layer.provide(state.external))));
      }),
    ),
  );
  it.effect("retries a launch with the same thread command, saving retention once", () =>
    run((state) =>
      Effect.gen(function* () {
        const request: LibraryOperationInput = {
          kind: "launch",
          input: {
            project,
            keepOnComputer: true,
            binding: {
              projectId: project.id,
              projectRevision: project.revision,
              environmentId,
              workingCopyId: "copy",
              resourceIds: [],
            },
            threadId: ThreadId.make("new-thread"),
            title: "Review",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            runtimeMode: "approval-required",
            interactionMode: "plan",
          },
        };
        yield* Ref.set(state.failBind, true);
        expect(
          (yield* state.service.execute("launch", request, actor).pipe(Effect.flip)).message,
        ).toContain("Reconnect");
        expect((yield* state.service.list({ projectId: project.id }))[0]?.state).toBe("failed");
        yield* Ref.set(state.failBind, false);
        expect((yield* state.service.execute("launch", request, actor)).result).toEqual({
          threadId: "new-thread",
        });
        expect(yield* Ref.get(state.dispatched)).toEqual(["launch:create", "launch:create"]);
        expect(yield* Ref.get(state.retentionSaves)).toBe(1);
        yield* state.service.execute("create-project", create, actor);
        expect(
          (yield* state.service.list({ projectId: project.id })).map((operation) => operation.id),
        ).toContain("create-project");
      }),
    ),
  );

  it.effect("starts a conversation in its own worktree, made once across retries", () =>
    run((state) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "library-launch-" }),
        );
        const worktree = path.join(root, "worktree");
        yield* fs.makeDirectory(worktree);
        yield* Ref.set(state.worktreePath, worktree);
        yield* Ref.set(state.repositoryPaths, ["/work/project"]);
        const request: LibraryOperationInput = {
          kind: "launch",
          input: {
            project,
            workspace: "worktree",
            binding: {
              projectId: project.id,
              projectRevision: project.revision,
              environmentId,
              workingCopyId: "copy",
              resourceIds: [],
            },
            threadId: ThreadId.make("worktree-thread"),
            title: "Review",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            runtimeMode: "approval-required",
            interactionMode: "plan",
          },
        };
        yield* Ref.set(state.failBind, true);
        yield* state.service.execute("worktree-launch", request, actor).pipe(Effect.flip);
        yield* Ref.set(state.failBind, false);
        expect((yield* state.service.execute("worktree-launch", request, actor)).result).toEqual({
          threadId: "worktree-thread",
        });
        const made = yield* Ref.get(state.worktreesMade);
        expect(made).toEqual([
          {
            cwd: "/work/project",
            refName: "main",
            newRefName: expect.stringMatching(/^t3\/[0-9a-f]{8}$/),
            baseRefName: "main",
            path: null,
          },
        ]);
        const workspace = { branch: made[0]!.newRefName, worktreePath: worktree };
        expect(yield* Ref.get(state.createdIn)).toEqual([workspace, workspace]);
        expect(yield* Ref.get(state.boundIn)).toEqual([worktree, worktree]);
        expect(yield* fs.exists(`${worktree}.t3-setup-pending`)).toBe(true);
      }),
    ),
  );

  it.effect("refuses a worktree start for more than one repository before changing anything", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.repositoryPaths, ["/work/project/app", "/work/project/site"]);
        const request: LibraryOperationInput = {
          kind: "launch",
          input: {
            project,
            workspace: "worktree",
            binding: {
              projectId: project.id,
              projectRevision: project.revision,
              environmentId,
              workingCopyId: "copy",
              resourceIds: [],
            },
            threadId: ThreadId.make("several-repositories"),
            title: "Review",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            runtimeMode: "approval-required",
            interactionMode: "plan",
          },
        };
        const failure = yield* state.service
          .execute("several-repositories", request, actor)
          .pipe(Effect.flip);
        expect(failure.reason).toBe("blocked");
        expect(failure.message).toContain("one repository");
        expect(yield* Ref.get(state.worktreesMade)).toEqual([]);
        expect(yield* Ref.get(state.dispatched)).toEqual([]);
      }),
    ),
  );

  it.effect("stops a retry whose conversation was deleted since the first try", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.threadDeleted, true);
        const request: LibraryOperationInput = {
          kind: "launch",
          input: {
            project,
            binding: {
              projectId: project.id,
              projectRevision: 1,
              environmentId,
              workingCopyId: "copy",
              resourceIds: [],
            },
            threadId: ThreadId.make("deleted-launch"),
            title: "Review",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            runtimeMode: "approval-required",
            interactionMode: "plan",
          },
        };
        expect(
          (yield* state.service.execute("deleted-launch", request, actor).pipe(Effect.flip))
            .message,
        ).toContain("Start over");
        expect((yield* state.service.list({ projectId: project.id }))[0]?.state).toBe(
          "needs-input",
        );
      }),
    ),
  );

  it.effect("rechecks launch authorization before creating the conversation", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.revokeAtResolve, true);
        const request: LibraryOperationInput = {
          kind: "launch",
          input: {
            project,
            binding: {
              projectId: project.id,
              projectRevision: 1,
              environmentId,
              workingCopyId: "copy",
              resourceIds: [],
            },
            threadId: ThreadId.make("revoked-launch"),
            title: "Review",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            runtimeMode: "approval-required",
            interactionMode: "plan",
          },
        };
        expect(
          (yield* state.service.execute("revoked-launch", request, actor).pipe(Effect.flip)).reason,
        ).toBe("blocked");
        expect(yield* Ref.get(state.dispatched)).toEqual([]);
        expect((yield* state.service.list({}))[0]?.state).toBe("needs-input");
      }),
    ),
  );
  it.effect("requires current authorization and the original subject for operation control", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.failure, true);
        yield* state.service.execute("control", create, actor).pipe(Effect.flip);
        yield* Ref.set(state.active, []);
        expect((yield* state.service.cancel("control", actor).pipe(Effect.flip)).reason).toBe(
          "blocked",
        );
        expect(
          (yield* state.service
            .controlClient("control", "resume", actor.sessionId)
            .pipe(Effect.flip)).reason,
        ).toBe("blocked");
        const stranger = {
          ...session(),
          subject: "stranger",
          sessionId: AuthSessionId.make("stranger"),
        };
        yield* Ref.set(state.active, [stranger]);
        expect(
          (yield* state.service
            .controlClient("control", "cancel", stranger.sessionId)
            .pipe(Effect.flip)).reason,
        ).toBe("blocked");
        yield* Ref.set(state.active, [session()]);
        expect(
          (yield* state.service.controlClient("control", "cancel", actor.sessionId)).state,
        ).toBe("cancelled");
      }),
    ),
  );
});
