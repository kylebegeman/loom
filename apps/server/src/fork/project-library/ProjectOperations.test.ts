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
} from "@t3tools/contracts";
import {
  LibraryError,
  LibraryOperation,
  LibraryOperationInput,
  type LibraryProject,
  type LibraryWorkingCopy,
  type LibraryRecoveryGrant,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import { LibraryService } from "./LibraryService.ts";
import { LibraryWorkspaceStore } from "./LibraryWorkspaceStore.ts";
import { LibraryWorkspace } from "./LibraryWorkspace.ts";
import { LibraryPublisher } from "./LibraryPublisher.ts";
import { LibraryHistorySource } from "./LibraryHistorySource.ts";
import * as ProjectOperations from "./ProjectOperations.ts";
import { archiveFor, copyFor, resource } from "./Library.testkit.ts";

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
  const defect = yield* Ref.make(false);
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const pause = yield* Ref.make(false);
  const revokeAfterRead = yield* Ref.make(false);
  const dispatched = yield* Ref.make<string[]>([]);
  const snapshots = yield* Ref.make(0);
  const retentionSaves = yield* Ref.make(0);
  const publishedRetentions = yield* Ref.make<readonly LibraryWorkingCopy[]>([]);
  const failPublish = yield* Ref.make(false);
  const revokeAtAttachments = yield* Ref.make(false);
  const ingests = yield* Ref.make(0);
  const observedToken = yield* Ref.make<string | null>(null);
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
        Effect.succeed({
          binding: input.binding,
          localProjectId: ProjectId.make("local"),
          cwd: "/work/project",
          repositoryPaths: [],
        }),
      bindThread: (input) =>
        Effect.succeed({
          binding: input.binding,
          localProjectId: ProjectId.make("local"),
          cwd: "/work/project",
          repositoryPaths: [],
        }),
      prepareCopy: () => Effect.succeed({ ...copyFor(project), environmentId }),
      restoreCopy: (input) =>
        Ref.set(observedToken, input.grant.accessToken).pipe(
          Effect.as({ ...copyFor(project), environmentId }),
        ),
      release: () =>
        Effect.fail(new LibraryError({ reason: "blocked", detail: "The reviewed files changed." })),
    }),
    Layer.mock(LibraryPublisher)({
      enabled: true,
      registerCopy: (input) =>
        Ref.update(publishedRetentions, (copies) => [...copies, input.copy]).pipe(
          Effect.as(input.copy),
        ),
      publishAttachments: () =>
        Ref.get(revokeAtAttachments).pipe(
          Effect.flatMap((revoke) => (revoke ? Ref.set(active, []) : Effect.void)),
        ),
      ingest: () =>
        Effect.gen(function* () {
          yield* Ref.update(ingests, (count) => count + 1);
          if (yield* Ref.get(failPublish))
            return yield* new LibraryError({ reason: "blocked", detail: "Reconnect the Library." });
          return {
            sourceEnvironmentId: environmentId,
            journalId: "launch",
            lastSequence: 1,
            applied: 1,
          };
        }),
    }),
    Layer.mock(LibraryHistorySource)({
      snapshotThread: () =>
        Ref.update(snapshots, (count) => count + 1).pipe(Effect.andThen(archiveFor(project))),
    }),
    Layer.mock(ThreadManagementService)({
      getThreadShell: () => Effect.succeed(null),
      dispatch: (command) =>
        Ref.update(dispatched, (ids) => [...ids, command.commandId]).pipe(
          Effect.as({ sequence: 1, storedEvents: [] }),
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
    retentionSaves,
    publishedRetentions,
    dispatched,
    snapshots,
    failPublish,
    revokeAtAttachments,
    ingests,
    active,
    calls,
    failure,
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
  it.effect(
    "retains project links and retries launch publication with the same thread command and archive",
    () =>
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
          yield* Ref.set(state.failPublish, true);
          expect(
            (yield* state.service.execute("launch", request, actor).pipe(Effect.flip)).message,
          ).toContain("Reconnect");
          expect((yield* state.service.list({ projectId: project.id }))[0]?.state).toBe(
            "needs-input",
          );
          yield* Ref.set(state.failPublish, false);
          expect((yield* state.service.execute("launch", request, actor)).result).toEqual({
            threadId: "new-thread",
          });
          expect(yield* Ref.get(state.dispatched)).toEqual(["launch:create", "launch:create"]);
          expect(yield* Ref.get(state.snapshots)).toBe(1);
          expect(yield* Ref.get(state.retentionSaves)).toBe(1);
          const retentions = yield* Ref.get(state.publishedRetentions);
          expect(retentions).toHaveLength(2);
          expect(retentions[1]).toEqual(retentions[0]);
          yield* state.service.execute("create-project", create, actor);
          expect(
            (yield* state.service.list({ projectId: project.id })).map((operation) => operation.id),
          ).toContain("create-project");
        }),
      ),
  );

  it.effect("rechecks launch authorization after attachments before publishing history", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.revokeAtAttachments, true);
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
        expect(yield* Ref.get(state.ingests)).toBe(0);
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
