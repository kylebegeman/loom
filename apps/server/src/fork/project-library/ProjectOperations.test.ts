import { ProjectWorkflows } from "./ProjectWorkflows.ts";
import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { identitySessionPrefix } from "../../auth/identityPolicy.ts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ThreadId,
  ProviderInstanceId,
  AuthSessionId,
  authScopeResponse,
  ProjectId,
  AuthSettingsWriteScope,
  AuthTerminalOperateScope,
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentId,
  mcpClientScopes,
  type AuthClientSession,
  type OrchestrationV2ThreadShell,
  type VcsCreateWorktreeInput,
  type VcsStatusLocalResult,
} from "@t3tools/contracts";
import {
  LibraryError,
  LibraryOperation,
  LibraryOperationInput,
  PROJECT_WORKFLOW_WS_METHODS as W,
  type LibraryProject,
  type LibraryFolderInspection,
  type LibraryCreateProjectRequest,
  type LibraryUpdateProjectRequest,
  type LibraryRecoveryGrant,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { OrchestratorDispatchError } from "../../orchestration-v2/Orchestrator.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import { LibraryPublisher } from "./LibraryPublisher.ts";
import { LibraryManagement } from "./LibraryManagement.ts";
import { LibraryWorkspaceStore } from "./LibraryWorkspaceStore.ts";
import { LibraryWorkspace } from "./LibraryWorkspace.ts";
import * as ProjectOperations from "./ProjectOperations.ts";
import { makeProjectWorkflowRpcHandlers } from "./workflow-rpc.ts";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import * as ServerConfig from "../../config.ts";
import * as SetupMarker from "../../workspace/setupMarker.ts";
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
  ...authScopeResponse(scopes),
  client: { deviceType: "desktop" },
  issuedAt: DateTime.makeUnsafe(0),
  expiresAt: DateTime.makeUnsafe(9999999999999),
  lastConnectedAt: null,
  connected: true,
  current: true,
});
const fixture = Effect.gen(function* () {
  const active = yield* Ref.make<readonly AuthClientSession[]>([session()]);
  const renewals = yield* Ref.make<ReadonlyMap<string, readonly AuthSessionId[]>>(new Map());
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
  const placedBorrowed = yield* Ref.make(false);
  const releaseCancel = yield* Ref.make<"none" | "cleared" | "set-aside">("none");
  const cancelGate = yield* Ref.make<{
    readonly entered: Deferred.Deferred<string>;
    readonly open: Deferred.Deferred<void>;
  } | null>(null);
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
  const creators = yield* Ref.make<readonly unknown[]>([]);
  const boundIn = yield* Ref.make<readonly (string | undefined)[]>([]);
  const boundCopies = yield* Ref.make<readonly string[]>([]);
  const conversations = yield* Ref.make<
    ReadonlyMap<string, { worktreePath: string | null; branch: string | null; ran: boolean }>
  >(new Map());
  const reservations = yield* Ref.make<readonly string[]>([]);
  const reservedState = yield* Ref.make<"preparing" | "ready">("preparing");
  const fillGate = yield* Ref.make<Deferred.Deferred<void> | null>(null);
  const fillFailure = yield* Ref.make<LibraryError | null>(null);
  const fills = yield* Ref.make(0);
  const moves = yield* Ref.make<readonly { worktreePath: string; moved: boolean }[]>([]);
  const changes = yield* Queue.unbounded<void>();
  const whileMakingWorktree = yield* Ref.make<Effect.Effect<void>>(Effect.void);
  const reservedCopy = (requestId: string) => ({
    ...copyFor(project),
    id: `reserved:${requestId}`,
    environmentId,
  });
  const catalog = yield* Ref.make<readonly LibraryProject[]>([]);
  const inspected = yield* Ref.make<LibraryFolderInspection>({
    rootPath: "/work/project",
    exists: true,
    repositories: [
      {
        path: "/work/project",
        relativePath: ".",
        remoteUrl: "https://github.com/acme/app.git",
        branch: "release/temporary",
        head: "abc",
      },
    ],
  });
  const published = yield* Ref.make(0);
  const publishFailure = yield* Ref.make(false);
  const registrations = yield* Ref.make<readonly unknown[]>([]);
  const creationInputs = yield* Ref.make<readonly LibraryCreateProjectRequest[]>([]);
  const updateInputs = yield* Ref.make<readonly LibraryUpdateProjectRequest[]>([]);
  const external = Layer.mergeAll(
    Layer.mock(LibraryPublisher)({
      enabled: true,
      project: (id) =>
        Ref.get(catalog).pipe(
          Effect.flatMap((projects) => {
            const found = projects.find((project) => project.id === id);
            return found
              ? Effect.succeed(found)
              : Effect.fail(new LibraryError({ reason: "not-found" }));
          }),
        ),
      projects: () => Ref.get(catalog),
      info: Effect.succeed({ authorityId: "authority", authorityEpoch: 1 } as never),
      registerCopy: (input) =>
        Effect.gen(function* () {
          yield* Ref.update(registrations, (requests) => [...requests, input]);
          if (yield* Ref.get(publishFailure)) return yield* new LibraryError({ reason: "io" });
          yield* Ref.update(published, (count) => count + 1);
          yield* Ref.update(catalog, (projects) =>
            projects.some((entry) => entry.id === project.id) ? projects : [...projects, project],
          );
          yield* Ref.update(inspected, (inspection) => ({
            ...inspection,
            registrations: [
              {
                workingCopyId: input.copy.id,
                projectId: project.id,
                projectTitle: project.title,
                ownership: input.copy.ownership,
              },
            ],
          }));
          return input.copy;
        }),
    }),
    Layer.mock(ProjectWorkflows)({
      changed: Queue.offer(changes, undefined).pipe(Effect.asVoid),
      changes: Stream.empty,
    }),
    Layer.mock(LibraryManagement)({
      status: Effect.die("Unused management status"),
      execute: (request) =>
        Effect.gen(function* () {
          if (request.kind === "create")
            yield* Ref.update(creationInputs, (inputs) => [...inputs, request.input]);
          yield* Ref.update(calls, (count) => count + 1);
          yield* Deferred.succeed(entered, undefined);
          if (yield* Ref.get(pause)) yield* Deferred.await(release);
          if (yield* Ref.get(defect)) return yield* Effect.die(new Error("private backend detail"));
          if (yield* Ref.get(failure))
            return yield* new LibraryError({ reason: "revision-conflict" });
          if (request.kind === "update") {
            yield* Ref.update(updateInputs, (inputs) => [...inputs, request.input]);
            const current =
              (yield* Ref.get(catalog)).find((entry) => entry.id === request.input.projectId) ??
              project;
            const updated = {
              ...current,
              revision: current.revision + 1,
              resources: current.resources.map((resource) => ({
                ...resource,
                remoteUrl:
                  request.input.resourceUpdates?.find((change) => change.id === resource.id)
                    ?.remoteUrl ?? resource.remoteUrl,
              })),
            };
            yield* Ref.set(catalog, [updated]);
            return updated;
          }
          return project;
        }),
    }),
    Layer.mock(LibraryWorkspaceStore)({
      receipts: Effect.succeed([]),
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
      inspectFolder: () => Ref.get(inspected),
      cancelRelease: (input) =>
        Effect.gen(function* () {
          const gate = yield* Ref.get(cancelGate);
          if (gate !== null) {
            yield* Deferred.succeed(gate.entered, input.requestId);
            yield* Deferred.await(gate.open);
          }
          return yield* Ref.get(releaseCancel);
        }),
      setCopyRetention: (input) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(placedBorrowed)) && !input.keepOnComputer)
            return yield* new LibraryError({ reason: "not-managed" });
          yield* Ref.update(retentionSaves, (count) => count + 1);
          return { ...copyFor(project), environmentId, keepOnComputer: input.keepOnComputer };
        }),
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
      reserveCopy: (input) =>
        Ref.update(reservations, (ids) => [...ids, input.requestId]).pipe(
          Effect.andThen(Ref.get(reservedState)),
          Effect.map((state) => ({ ...reservedCopy(input.requestId), state })),
        ),
      fillCopy: (input) =>
        Effect.gen(function* () {
          yield* Ref.update(fills, (count) => count + 1);
          const gate = yield* Ref.get(fillGate);
          if (gate !== null) yield* Deferred.await(gate);
          const failure = yield* Ref.get(fillFailure);
          if (failure !== null) return yield* failure;
          return { ...copyFor(project), id: input.workingCopyId, environmentId };
        }),
      moveThread: (input) =>
        input.move.pipe(
          Effect.tap((moved) =>
            Ref.update(moves, (list) => [...list, { worktreePath: input.worktreePath, moved }]),
          ),
        ),
      bindThread: (input) =>
        Ref.update(boundIn, (paths) => [...paths, input.worktreePath]).pipe(
          Effect.andThen(Ref.update(boundCopies, (ids) => [...ids, input.binding.workingCopyId])),
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
      prepareCopy: (input, authorize) =>
        Effect.forEach(input.repositoryAccess ?? [], (entry) =>
          entry.access.kind === "vault-github"
            ? authorize
              ? authorize(entry.access).pipe(
                  Effect.mapError((cause) => new LibraryError({ reason: "blocked", cause })),
                )
              : Effect.fail(new LibraryError({ reason: "blocked" }))
            : Effect.void,
        ).pipe(
          Effect.andThen(Ref.get(prepareFailure)),
          Effect.flatMap((error) =>
            error ? Effect.fail(error) : Effect.succeed({ ...copyFor(project), environmentId }),
          ),
        ),
      restoreCopy: (input) =>
        Ref.set(observedToken, input.grant.accessToken).pipe(
          Effect.andThen(Ref.get(prepareFailure)),
          Effect.flatMap((error) =>
            error ? Effect.fail(error) : Effect.succeed({ ...copyFor(project), environmentId }),
          ),
        ),
      release: () =>
        Effect.fail(new LibraryError({ reason: "blocked", detail: "The reviewed files changed." })),
    }),
    Layer.mock(ThreadManagementService)({
      // Only what the launch reads: each conversation it created, its folder and whether it ran.
      getThreadShell: (threadId) =>
        Effect.gen(function* () {
          const thread = (yield* Ref.get(conversations)).get(threadId);
          if (thread === undefined) return null;
          return {
            worktreePath: thread.worktreePath,
            branch: thread.branch,
            latestRunId: thread.ran ? "run" : null,
            deletedAt: (yield* Ref.get(threadDeleted))
              ? DateTime.makeUnsafe("2026-10-25T00:00:00Z")
              : null,
          } as OrchestrationV2ThreadShell;
        }),
      dispatch: (command) =>
        Effect.gen(function* () {
          yield* Ref.update(dispatched, (ids) => [...ids, command.commandId]);
          if (command.type === "thread.create") {
            yield* Ref.update(createdIn, (list) => [
              ...list,
              { branch: command.branch, worktreePath: command.worktreePath },
            ]);
            yield* Ref.update(creators, (list) => [
              ...list,
              {
                createdBy: command.createdBy,
                creationSource: command.creationSource,
                linkOrigin: command.linkOrigin,
                delegatedFrom: command.delegatedFrom,
              },
            ]);
            // A repeated create does nothing, as the orchestrator's command receipt makes it.
            yield* Ref.update(conversations, (map) =>
              map.has(command.threadId)
                ? map
                : new Map(map).set(command.threadId, {
                    worktreePath: command.worktreePath,
                    branch: command.branch,
                    ran: false,
                  }),
            );
          }
          if (command.type === "thread.metadata.update") {
            const thread = (yield* Ref.get(conversations)).get(command.threadId)!;
            if (
              (command.expectedEmpty === true && thread.ran) ||
              (command.expectedWorktreePath !== undefined &&
                command.expectedWorktreePath !== thread.worktreePath)
            )
              return yield* new OrchestratorDispatchError({
                commandId: command.commandId,
                commandType: command.type,
              });
            yield* Ref.update(conversations, (map) =>
              new Map(map).set(command.threadId, {
                ...thread,
                worktreePath: command.worktreePath ?? thread.worktreePath,
                branch: command.branch ?? thread.branch,
              }),
            );
          }
          return { sequence: 1, storedEvents: [] };
        }),
    }),
    Layer.mock(GitWorkflowService)({
      hasCommit: () => Effect.succeed(false),
      localStatus: () => Effect.succeed({ refName: "main" } as VcsStatusLocalResult),
      createWorktree: (input) =>
        Ref.update(worktreesMade, (made) => [...made, input]).pipe(
          Effect.andThen(Effect.flatten(Ref.get(whileMakingWorktree))),
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
      renewalsOf: (sessionId) =>
        Ref.get(renewals).pipe(
          Effect.map((links) => new Set([sessionId, ...(links.get(sessionId) ?? [])])),
        ),
    }),
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(environmentId) }),
  );
  return {
    catalog,
    inspected,
    published,
    creationInputs,
    updateInputs,
    publishFailure,
    registrations,
    changes,
    whileMakingWorktree,
    boundCopies,
    conversations,
    reservations,
    reservedState,
    fillGate,
    fillFailure,
    fills,
    moves,
    repositoryPaths,
    worktreePath,
    worktreesMade,
    createdIn,
    creators,
    boundIn,
    retentionSaves,
    placedBorrowed,
    releaseCancel,
    cancelGate,
    dispatched,
    failBind,
    threadDeleted,
    revokeAtResolve,
    active,
    renewals,
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
type State = Effect.Success<typeof fixture> & {
  service: ProjectOperations.ProjectOperations["Service"];
};
const run = <A, E, R>(
  use: (state: State) => Effect.Effect<A, E, R>,
  environment: NodeJS.ProcessEnv = {},
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ProjectLibraryMigrations);
    const state = yield* fixture;
    return yield* Effect.flatMap(ProjectOperations.ProjectOperations, (service) =>
      use({ ...state, service }),
    ).pipe(Effect.provide(ProjectOperations.layer.pipe(Layer.provide(state.external))));
  }).pipe(
    Effect.provide(
      layerMemory.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-project-operations-" }),
        ),
        Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      ),
    ),
    Effect.provideService(HostProcess.Environment, environment),
    Effect.scoped,
  );

const localProject = {
  id: ProjectId.make("local-folder"),
  title: "Local folder",
  workspaceRoot: "/work/project",
};

it.effect(
  "shares a created local folder with one durable import and reports a recoverable failure",
  () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.publishFailure, true);
        const pending = yield* state.service.shareCreated(localProject, {
          kind: "client",
          sessionId: actor.sessionId,
        });
        expect(pending.state).toBe("pending");
        expect(pending.operationId).toBeTruthy();
        expect(yield* state.service.list({ includeFolderImports: true })).toHaveLength(1);
        expect(yield* state.service.list({ includeProjectUpdates: true })).toEqual([]);
        yield* Ref.set(state.publishFailure, false);
        const shared = yield* state.service.shareCreated(localProject, {
          kind: "client",
          sessionId: actor.sessionId,
        });
        expect(shared).toMatchObject({
          state: "shared",
          projectId: project.id,
          operationId: pending.operationId,
        });
        expect(yield* Ref.get(state.calls)).toBe(1);
        expect(yield* state.service.list({ includeFolderImports: true })).toHaveLength(1);
        yield* Ref.set(state.active, []);
        const denied = yield* state.service.shareCreated(localProject, {
          kind: "client",
          sessionId: actor.sessionId,
        });
        expect(denied.state).toBe("pending");
        expect(yield* Ref.get(state.published)).toBe(1);
      }),
    ),
);

it.effect(
  "records a newly published repository URL without changing its branch pin or other resources",
  () =>
    run((state) =>
      Effect.gen(function* () {
        const local = {
          ...project,
          brief: "Keep this brief",
          resources: [
            { ...resource, relativePath: ".", remoteUrl: null },
            {
              id: "docs",
              title: "Docs",
              kind: "link" as const,
              url: "https://example.com",
              relativePath: "docs",
              remoteUrl: null,
              defaultBranch: null,
            },
          ],
        };
        yield* Ref.set(state.catalog, [local]);
        const result = yield* state.service.executeClient(
          "published-origin",
          {
            kind: "import",
            input: {
              requestId: "published-origin",
              projectId: project.id,
              rootPath: "/work/project",
              repositoryUpdate: {
                resourceId: resource.id,
                remoteUrl: "https://github.com/acme/app.git",
              },
            },
          },
          actor.sessionId,
        );
        expect(result.result).toMatchObject({
          brief: local.brief,
          resources: [
            { ...local.resources[0], remoteUrl: "https://github.com/acme/app.git" },
            local.resources[1],
          ],
        });
        expect(yield* Ref.get(state.updateInputs)).toEqual([
          {
            requestId: "published-origin:repository-url:import",
            projectId: project.id,
            expectedRevision: 1,
            resourceUpdates: [{ id: resource.id, remoteUrl: "https://github.com/acme/app.git" }],
          },
        ]);
        yield* state.service.executeClient(
          "published-origin",
          {
            kind: "import",
            input: {
              requestId: "published-origin",
              projectId: project.id,
              rootPath: "/work/project",
              repositoryUpdate: {
                resourceId: resource.id,
                remoteUrl: "https://github.com/acme/app.git",
              },
            },
          },
          actor.sessionId,
        );
        expect(yield* Ref.get(state.updateInputs)).toHaveLength(1);
        for (const [id, savedRemote, observedRemote] of [
          [
            "saved-remote-changed",
            "https://github.com/acme/another.git",
            "https://github.com/acme/app.git",
          ],
          ["checkout-remote-changed", null, "https://github.com/acme/another.git"],
        ] as const) {
          yield* Ref.set(state.catalog, [
            { ...local, resources: [{ ...local.resources[0]!, remoteUrl: savedRemote }] },
          ]);
          yield* Ref.update(state.inspected, (inspection) => ({
            ...inspection,
            repositories: inspection.repositories.map((repository) => ({
              ...repository,
              remoteUrl: observedRemote,
            })),
          }));
          const denied = yield* state.service
            .executeClient(
              id,
              {
                kind: "import",
                input: {
                  requestId: id,
                  projectId: project.id,
                  rootPath: "/work/project",
                  repositoryUpdate: {
                    resourceId: resource.id,
                    remoteUrl: "https://github.com/acme/app.git",
                  },
                },
              },
              actor.sessionId,
            )
            .pipe(Effect.flip);
          expect(denied.reason).toBe("blocked");
        }
        expect(yield* Ref.get(state.updateInputs)).toHaveLength(1);
      }),
    ),
);

// Each save announces a change, so the operation is read again only after one.
const settled = (state: State, id: string) =>
  Effect.gen(function* () {
    for (;;) {
      const operation = (yield* state.service.list({})).find((entry) => entry.id === id);
      if (operation !== undefined && operation.state !== "queued" && operation.state !== "running")
        return operation;
      yield* Queue.take(state.changes);
    }
  });
const filesLaunch = (
  threadId: string,
  workspace?: "worktree",
): LibraryOperationInput & { kind: "launch" } => ({
  kind: "launch",
  input: {
    project,
    keepOnComputer: true,
    ...(workspace === undefined ? {} : { workspace }),
    binding: {
      projectId: project.id,
      projectRevision: project.revision,
      environmentId,
      workingCopyId: `${threadId}-files`,
      resourceIds: [],
    },
    files: {
      requestId: `${threadId}-files`,
      project,
      rootPath: "/work/new-copy",
      strategy: "clone",
      resourceIds: [],
    },
    threadId: ThreadId.make(threadId),
    title: "Review",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    runtimeMode: "approval-required",
    interactionMode: "plan",
  },
});
const holdFiles = (state: State) =>
  Deferred.make<void>().pipe(Effect.tap((gate) => Ref.set(state.fillGate, gate)));
const worktreeFolder = (state: State) =>
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
    return worktree;
  });

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
  it.effect("deduplicates accepted operations and rejects changed inputs from any subject", () =>
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
        const other = { sessionId: "other", subject: "other-owner" };
        expect(
          (yield* state.service.execute("operation", create, other).pipe(Effect.flip)).accessRepair
            ?.kind,
        ).toBe("ownership");
        expect(
          (yield* state.service
            .execute(
              "operation",
              { kind: "create", input: { ...create.input, title: "Changed" } },
              other,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("request-conflict");
        expect(yield* Ref.get(state.calls)).toBe(1);
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
  it.effect("accepts the renewal a connection moved to after its opening session expired", () =>
    run((state) =>
      Effect.gen(function* () {
        const renewal = { ...session(), sessionId: AuthSessionId.make("renewal") };
        const expired = { ...session([]), expiresAt: DateTime.makeUnsafe(0) };
        yield* Ref.set(state.active, [expired, renewal]);
        yield* Ref.set(state.renewals, new Map([[actor.sessionId, [renewal.sessionId]]]));
        expect((yield* state.service.execute("renewed", create, actor)).state).toBe("succeeded");
        expect(
          (yield* state.service.executeClient("client-renewed", create, actor.sessionId)).state,
        ).toBe("succeeded");
        yield* Ref.set(state.active, [expired]);
        expect(
          (yield* state.service.executeClient("expired", create, actor.sessionId).pipe(Effect.flip))
            .reason,
        ).toBe("blocked");
        expect(
          (yield* state.service
            .executeClient("expired-repair", create, actor.sessionId)
            .pipe(Effect.flip)).accessRepair?.kind,
        ).toBe("sign-in");
        yield* Ref.set(state.active, [{ ...renewal, subject: "stranger" }]);
        expect(
          (yield* state.service.execute("stranger", create, actor).pipe(Effect.flip)).reason,
        ).toBe("blocked");
      }),
    ),
  );
  it.effect("rejects connected Identity sessions from an earlier host policy", () => {
    const environment = {
      LOOM_IDENTITY_ISSUER: "https://identity.test",
      LOOM_IDENTITY_AUDIENCE: "host",
      LOOM_IDENTITY_ALLOWED_SUBJECTS: "owner",
    };
    return run(
      (state) =>
        Effect.gen(function* () {
          const stale = {
            ...session(),
            subject: `${identitySessionPrefix({ ...environment, LOOM_IDENTITY_REQUIRE_PASSKEY: "true" })}b3duZXI`,
          };
          yield* Ref.set(state.active, [stale]);
          expect(
            (yield* state.service
              .executeClient("stale-policy", create, actor.sessionId)
              .pipe(Effect.flip)).reason,
          ).toBe("blocked");
          expect(yield* Ref.get(state.calls)).toBe(0);
        }),
      environment,
    );
  });

  it.effect(
    "keeps operation ownership across policy changes and upgrades a proven legacy owner",
    () => {
      const environment = {
        LOOM_IDENTITY_ISSUER: "https://identity.test",
        LOOM_IDENTITY_AUDIENCE: "host",
        LOOM_IDENTITY_ALLOWED_SUBJECTS: "owner,other",
      };
      const subjectFor = (env: NodeJS.ProcessEnv, account = "owner") =>
        `${identitySessionPrefix(env)}${Buffer.from(account).toString("base64url")}`;
      return run(
        (state) =>
          Effect.gen(function* () {
            const original = { ...session(), subject: subjectFor(environment) };
            yield* Ref.set(state.active, [original]);
            yield* Ref.set(state.failure, true);
            yield* state.service
              .executeClient("stable-owner", create, actor.sessionId)
              .pipe(Effect.flip);
            const sql = yield* SqlClient.SqlClient;
            yield* sql`UPDATE fork_library_operations SET subject=${original.subject} WHERE id='stable-owner'`;
            yield* state.service
              .executeClient("stable-owner", create, actor.sessionId)
              .pipe(Effect.flip);
            yield* sql`UPDATE fork_library_operations SET subject=${original.subject} WHERE id='stable-owner'`;
            yield* Effect.gen(function* () {
              yield* ProjectOperations.ProjectOperations;
              const [migrated] = yield* sql<{
                subject: string;
              }>`SELECT subject FROM fork_library_operations WHERE id='stable-owner'`;
              expect(migrated?.subject).toMatch(/^identity-principal:v1:/);
            }).pipe(
              Effect.provide(
                Layer.fresh(ProjectOperations.layer.pipe(Layer.provide(state.external))),
              ),
            );
            const nextEnvironment = {
              ...environment,
              LOOM_IDENTITY_REQUIRE_PASSKEY: "true",
              LOOM_IDENTITY_RESOURCE: "new-resource",
            };
            yield* Ref.set(state.active, [{ ...session(), subject: subjectFor(nextEnvironment) }]);
            yield* Ref.set(state.failure, false);
            yield* Effect.gen(function* () {
              const restarted = yield* ProjectOperations.ProjectOperations;
              const calls = yield* Ref.get(state.calls);
              expect(
                (yield* restarted.outcomeClient(
                  { requestId: create.input.requestId, kind: "create" },
                  actor.sessionId,
                ))?.state,
              ).toBe("failed");
              expect(yield* Ref.get(state.calls)).toBe(calls);
              expect(
                (yield* restarted.controlClient("stable-owner", "resume", actor.sessionId)).state,
              ).toBe("queued");
              expect(
                (yield* restarted.executeClient("stable-owner", create, actor.sessionId)).state,
              ).toBe("succeeded");
              yield* Ref.set(state.active, [
                { ...session(), subject: subjectFor(nextEnvironment, "other") },
              ]);
              expect(
                (yield* restarted
                  .controlClient("stable-owner", "cancel", actor.sessionId)
                  .pipe(Effect.flip)).reason,
              ).toBe("blocked");
              expect(
                (yield* restarted
                  .executeClient("stable-owner", create, actor.sessionId)
                  .pipe(Effect.flip)).accessRepair?.kind,
              ).toBe("ownership");
              yield* sql`UPDATE fork_library_operations SET subject=${original.subject} WHERE id='stable-owner'`;
              yield* Ref.set(state.active, [
                { ...session(), subject: subjectFor(nextEnvironment) },
              ]);
              expect(
                (yield* restarted
                  .controlClient("stable-owner", "cancel", actor.sessionId)
                  .pipe(Effect.flip)).reason,
              ).toBe("blocked");
            }).pipe(
              Effect.provide(
                Layer.fresh(ProjectOperations.layer.pipe(Layer.provide(state.external))),
              ),
              Effect.provideService(HostProcess.Environment, nextEnvironment),
            );
          }),
        environment,
      );
    },
  );

  it.effect(
    "keeps exact update receipts across reopen without replay and excludes them from legacy lists",
    () =>
      run((state) =>
        Effect.gen(function* () {
          yield* Ref.set(state.active, [session([AuthSettingsWriteScope])]);
          const request: LibraryOperationInput = {
            kind: "update",
            input: {
              requestId: "u".repeat(200),
              projectId: project.id,
              expectedRevision: project.revision,
              title: "Updated project",
            },
          };
          const query = { requestId: request.input.requestId, kind: request.kind };
          const id = yield* state.service.operationId(query.requestId, query.kind);
          expect(yield* state.service.outcomeClient(query, actor.sessionId)).toBeNull();
          const accepted = yield* state.service.executeClient(id, request, actor.sessionId);
          expect(accepted).toMatchObject({
            kind: "update",
            projectId: project.id,
            state: "succeeded",
            result: { id: project.id, revision: project.revision + 1 },
          });
          expect(yield* state.service.list({})).toEqual([]);
          expect(yield* state.service.list({ includeFolderImports: true })).toEqual([]);
          expect(yield* state.service.list({ includeProjectUpdates: false })).toEqual([]);
          expect(
            yield* state.service.list({ projectId: project.id, includeProjectUpdates: true }),
          ).toEqual([accepted]);
          expect(
            yield* state.service.list({ includeProjectUpdates: true, includeFolderImports: true }),
          ).toEqual([accepted]);
          yield* Ref.set(state.catalog, [{ ...project, revision: 7, title: "Changed elsewhere" }]);
          yield* Effect.gen(function* () {
            const reopened = yield* ProjectOperations.ProjectOperations;
            expect(yield* reopened.outcomeClient(query, actor.sessionId)).toEqual(accepted);
            expect(yield* reopened.executeClient(id, request, actor.sessionId)).toEqual(accepted);
            expect(
              (yield* reopened
                .executeClient(
                  id,
                  {
                    kind: "update",
                    input: { ...request.input, title: "Different update" },
                  },
                  actor.sessionId,
                )
                .pipe(Effect.flip)).reason,
            ).toBe("request-conflict");
            yield* Ref.set(state.active, [{ ...session(), subject: "another-account" }]);
            expect(yield* reopened.outcomeClient(query, actor.sessionId)).toBeNull();
            expect(
              (yield* reopened.executeClient(id, request, actor.sessionId).pipe(Effect.flip))
                .accessRepair?.kind,
            ).toBe("ownership");
          }).pipe(
            Effect.provide(
              Layer.fresh(ProjectOperations.layer.pipe(Layer.provide(state.external))),
            ),
          );
          expect(yield* Ref.get(state.updateInputs)).toEqual([request.input]);
          expect(yield* Ref.get(state.calls)).toBe(1);
        }),
      ),
  );

  it.effect(
    "reads an exact accepted outcome without replay, including hashed IDs beyond the history window",
    () =>
      run((state) =>
        Effect.gen(function* () {
          const requestId = "a".repeat(200);
          const query = { requestId, kind: "create" as const };
          const caller = {
            ...actor,
            method: "browser-session-cookie" as const,
            scopes: [AuthOrchestrationReadScope],
          };
          const handlers = yield* makeProjectWorkflowRpcHandlers(
            makeForkRpcAuth(caller),
            caller,
          ).pipe(
            Effect.provide(state.external),
            Effect.provideService(ProjectOperations.ProjectOperations, state.service),
          );
          expect(yield* handlers[W.operationOutcome](query)).toBeNull();
          expect(yield* Ref.get(state.calls)).toBe(0);
          const id = yield* state.service.operationId(requestId, "create");
          const accepted = yield* state.service.executeClient(
            id,
            { kind: "create", input: { requestId, title: "Project" } },
            actor.sessionId,
          );
          const sql = yield* SqlClient.SqlClient;
          const [row] = yield* sql`SELECT * FROM fork_library_operations WHERE id=${id}`;
          for (let index = 0; index < 101; index++) {
            const otherId = `later-${index}`;
            yield* sql`INSERT INTO fork_library_operations (id,subject,session_id,request_json,payload_json,state,project_id,created_at) SELECT ${otherId},subject,session_id,request_json,payload_json,state,project_id,'2027-01-01' FROM fork_library_operations WHERE id=${id}`;
            yield* sql`UPDATE fork_library_operations SET request_json=${yield* encodeRequest({ kind: "create", input: { requestId: otherId, title: "Other" } })},payload_json=${yield* encodeOperation({ ...accepted, id: otherId })} WHERE id=${otherId}`;
          }
          expect((yield* state.service.list({})).some((entry) => entry.id === id)).toBe(false);
          expect(yield* handlers[W.operationOutcome](query)).toEqual(accepted);
          expect(
            yield* state.service.outcomeClient({ ...query, kind: "prepare" }, actor.sessionId),
          ).toBeNull();
          for (const status of [
            "queued",
            "running",
            "needs-input",
            "failed",
            "cancelled",
          ] as const) {
            const operation = { ...accepted, state: status };
            yield* sql`UPDATE fork_library_operations SET state=${status},payload_json=${yield* encodeOperation(operation)} WHERE id=${id}`;
            expect(yield* state.service.outcomeClient(query, actor.sessionId)).toEqual(operation);
          }
          const custom = { ...query, requestId: "custom-workflow-request" };
          const customResult = yield* state.service.executeClient(
            "custom-workflow-id",
            { kind: "create", input: { requestId: custom.requestId, title: "Project" } },
            actor.sessionId,
          );
          expect(yield* state.service.outcomeClient(custom, actor.sessionId)).toEqual(customResult);
          expect(yield* Ref.get(state.calls)).toBe(2);
          const [unchanged] = yield* sql`SELECT * FROM fork_library_operations WHERE id=${id}`;
          expect(unchanged).toEqual({
            ...row,
            state: "cancelled",
            payload_json: yield* encodeOperation({ ...accepted, state: "cancelled" }),
          });
          yield* Ref.set(state.active, [{ ...session(), subject: "other-person" }]);
          expect(yield* state.service.outcomeClient(query, actor.sessionId)).toBeNull();
          yield* Ref.set(state.active, []);
          expect(
            (yield* state.service.outcomeClient(query, actor.sessionId).pipe(Effect.flip)).reason,
          ).toBe("blocked");
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
  it.effect("refuses revoked or under-scoped sessions, and outside agents below Full access", () =>
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
        const outsideAgent = { subject: "mcp-client", sessionId: AuthSessionId.make("outside") };
        const prepare: LibraryOperationInput = {
          kind: "prepare",
          input: { requestId: "outside", project, rootPath: "/test/outside", strategy: "clone" },
        };
        yield* Ref.set(state.active, [{ ...session(mcpClientScopes("auto")), ...outsideAgent }]);
        expect(
          (yield* state.service.execute("outside", prepare, outsideAgent).pipe(Effect.flip))
            .message,
        ).toContain("needs Full access");
        yield* Ref.set(state.active, [
          { ...session(mcpClientScopes("full-access")), ...outsideAgent },
        ]);
        expect((yield* state.service.execute("outside", prepare, outsideAgent)).state).toBe(
          "succeeded",
        );
        const unmatched: LibraryOperationInput = {
          kind: "import",
          input: { requestId: "outside-import", rootPath: "/work/project" },
        };
        expect(
          (yield* state.service
            .execute("outside-import", unmatched, outsideAgent)
            .pipe(Effect.flip)).message,
        ).toContain("outside agents cannot create shared projects");
        expect(yield* Ref.get(state.creationInputs)).toEqual([]);
        yield* Ref.update(state.active, (sessions) => [...sessions, session()]);
        expect((yield* state.service.execute("outside-import", unmatched, actor)).state).toBe(
          "succeeded",
        );
        expect(yield* Ref.get(state.creationInputs)).toHaveLength(1);
      }),
    ),
  );
  it.effect(
    "preserves file review blockers, keeps files set aside resumable and cancels without holding up other work",
    () =>
      run((state) =>
        Effect.gen(function* () {
          const request: LibraryOperationInput = {
            kind: "release",
            input: { requestId: "release", workingCopyId: "copy", reviewToken: "old-review" },
          };
          const error = yield* state.service.execute("release", request, actor).pipe(Effect.flip);
          expect(error.reason).toBe("blocked");
          expect(error.message).toBe("The reviewed files changed.");
          yield* Ref.set(state.releaseCancel, "set-aside");
          expect(
            (yield* state.service.cancel("release", actor).pipe(Effect.flip)).message,
          ).toContain("Resume this operation to finish removing them");
          yield* Ref.set(state.releaseCancel, "cleared");
          const gate = {
            entered: yield* Deferred.make<string>(),
            open: yield* Deferred.make<void>(),
          };
          yield* Ref.set(state.cancelGate, gate);
          const cancelling = yield* state.service.cancel("release", actor).pipe(Effect.forkChild);
          yield* Deferred.await(gate.entered);
          expect((yield* state.service.execute("meanwhile", create, actor)).state).toBe(
            "succeeded",
          );
          yield* Deferred.succeed(gate.open, undefined);
          expect((yield* Fiber.join(cancelling)).state).toBe("cancelled");
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
          yield* Ref.set(state.prepareFailure, new LibraryError({ reason: "blocked" }));
          expect(
            (yield* state.service.execute("restore", request, actor).pipe(Effect.flip)).reason,
          ).toBe("blocked");
          const expectedContext = {
            requestId: "restore",
            project,
            rootPath: "/test/restore",
            sourceCopy: grant.sourceCopy,
            destinationEnvironmentId: grant.destinationEnvironmentId,
            libraryEnvironmentId: grant.libraryEnvironmentId,
          };
          const failed = (yield* state.service.list({}))[0]!;
          expect(failed).toMatchObject({ state: "needs-input", restoreRequest: expectedContext });
          expect(
            yield* state.service.outcomeClient(
              { requestId: "restore", kind: "restore" },
              actor.sessionId,
            ),
          ).toMatchObject({ restoreRequest: expectedContext });
          expect(yield* Ref.get(state.observedToken)).toBe(grant.accessToken);
          const sql = yield* SqlClient.SqlClient;
          const rows = yield* sql<{
            request_json: string;
            payload_json: string;
          }>`SELECT request_json,payload_json FROM fork_library_operations WHERE id='restore'`;
          expect(rows[0]?.request_json).not.toContain(grant.accessToken);
          expect(rows[0]?.payload_json).not.toContain(grant.accessToken);
          const legacy = yield* encodeOperation({ ...failed, restoreRequest: undefined });
          yield* sql`UPDATE fork_library_operations SET payload_json=${legacy} WHERE id='restore'`;
          expect((yield* state.service.list({}))[0]).toMatchObject({
            restoreRequest: expectedContext,
          });
          expect(
            yield* state.service.outcomeClient(
              { requestId: "restore", kind: "restore" },
              actor.sessionId,
            ),
          ).toMatchObject({ restoreRequest: expectedContext });
          yield* Ref.set(state.prepareFailure, null);
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
  it.effect("requires fresh human credential-use permission for a pinned repository route", () =>
    run((state) =>
      Effect.gen(function* () {
        const request: LibraryOperationInput = {
          kind: "prepare",
          input: {
            requestId: "vault-files",
            project,
            strategy: "clone",
            repositoryAccess: [
              {
                resourceId: resource.id,
                access: {
                  kind: "vault-github",
                  id: "1".repeat(32),
                  expectedVersion: 1,
                  repository: "acme/app",
                },
              },
            ],
          },
        };
        expect(
          (yield* state.service
            .executeClient("vault-files", request, actor.sessionId)
            .pipe(Effect.flip)).reason,
        ).toBe("blocked");
        yield* Ref.set(state.active, [session([...session().scopes, AuthAccessWriteScope])]);
        expect(
          (yield* state.service.executeClient("vault-files", request, actor.sessionId)).state,
        ).toBe("succeeded");
      }),
    ),
  );
  it.effect("lets a signed-in person take over an operation an agent started", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.failure, true);
        const sql = yield* SqlClient.SqlClient;
        const owners = {
          "agent-owned": "workload:owning-thread",
          "outside-owned": "mcp-client",
          "outside-retried": "mcp-client",
        };
        for (const [id, owner] of Object.entries(owners)) {
          yield* state.service.execute(id, create, actor).pipe(Effect.flip);
          yield* sql`UPDATE fork_library_operations SET subject=${owner} WHERE id=${id}`;
        }
        const otherAgent = { subject: "workload:other-thread", sessionId: "workload:other" };
        const outsideAgent = { subject: "mcp-client", sessionId: "outside" };
        for (const agent of [otherAgent, outsideAgent])
          expect(
            (yield* state.service.cancel("agent-owned", agent).pipe(Effect.flip)).message,
          ).toContain("from that conversation with loom_library_operation_control");
        yield* Ref.set(state.active, [session([AuthTerminalOperateScope])]);
        expect(
          (yield* state.service
            .controlClient("agent-owned", "cancel", actor.sessionId)
            .pipe(Effect.flip)).message,
        ).toContain("access level");
        yield* Ref.set(state.active, [session()]);
        yield* Ref.set(state.failure, false);
        yield* state.service.controlClient("agent-owned", "resume", actor.sessionId);
        expect((yield* state.service.execute("agent-owned", create, actor)).state).toBe(
          "succeeded",
        );
        const owningAgent = { subject: "workload:owning-thread", sessionId: "workload:owning" };
        expect(
          (yield* state.service.cancel("agent-owned", owningAgent).pipe(Effect.flip)).message,
        ).toContain("another signed-in session");
        expect(
          (yield* state.service.controlClient("outside-owned", "cancel", actor.sessionId)).state,
        ).toBe("cancelled");
        yield* state.service.controlClient("outside-retried", "resume", actor.sessionId);
        expect((yield* state.service.execute("outside-retried", create, actor)).state).toBe(
          "succeeded",
        );
        yield* Ref.set(state.active, [
          session(),
          {
            ...session(mcpClientScopes("full-access")),
            sessionId: AuthSessionId.make(outsideAgent.sessionId),
            subject: outsideAgent.subject,
          },
        ]);
        expect((yield* state.service.execute("outside-retried", create, outsideAgent)).state).toBe(
          "succeeded",
        );
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
  it.effect("lets Resume finish a removal an earlier build's cancel left set aside", () =>
    run((state) =>
      Effect.gen(function* () {
        const request = yield* encodeRequest({
          kind: "release",
          input: { requestId: "stranded", workingCopyId: "copy", reviewToken: "old-review" },
        });
        const operation = yield* encodeOperation({
          id: "stranded",
          kind: "release",
          projectId: null,
          environmentId,
          state: "cancelled",
          phase: "Cancelled; completed steps were kept",
          attempt: 1,
          error: null,
          result: null,
          createdAt: project.createdAt,
          updatedAt: project.createdAt,
        });
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO fork_library_operations (id,subject,session_id,request_json,payload_json,state,project_id,created_at) VALUES ('stranded',${actor.subject},${actor.sessionId},${request},${operation},'cancelled',NULL,${project.createdAt})`;
        yield* Ref.set(state.releaseCancel, "set-aside");
        const gate = {
          entered: yield* Deferred.make<string>(),
          open: yield* Deferred.make<void>(),
        };
        yield* Ref.set(state.cancelGate, gate);
        yield* Effect.flatMap(ProjectOperations.ProjectOperations, (restarted) =>
          Effect.gen(function* () {
            expect(yield* Deferred.await(gate.entered)).toBe("stranded");
            // Waits behind the startup check, which holds the operation while it looks.
            const resuming = yield* restarted.resume("stranded", actor).pipe(Effect.forkChild);
            yield* Deferred.succeed(gate.open, undefined);
            expect((yield* Fiber.join(resuming)).state).toBe("queued");
          }),
        ).pipe(Effect.provide(ProjectOperations.layer.pipe(Layer.provide(state.external))));
      }),
    ),
  );
  it.effect("refuses credential literals before storing a durable project request", () =>
    run((state) =>
      Effect.gen(function* () {
        const profile = {
          scripts: [
            {
              id: "setup",
              name: "Setup",
              command: "API_KEY=synthetic-secret setup",
              icon: "play" as const,
              runOnWorktreeCreate: false,
            },
          ],
        };
        const requests: readonly LibraryOperationInput[] = [
          { kind: "create", input: { requestId: "unsafe-create", title: "Project", profile } },
          {
            kind: "update",
            input: {
              requestId: "unsafe-update",
              projectId: project.id,
              expectedRevision: 1,
              profile,
            },
          },
          {
            kind: "prepare",
            input: {
              requestId: "unsafe-prepare",
              project: { ...project, profile },
              strategy: "clone",
            },
          },
          {
            kind: "prepare",
            input: {
              requestId: "unsafe-remote",
              project: {
                ...project,
                resources: [
                  {
                    ...resource,
                    remoteUrl: "https://user:synthetic-secret@github.com/acme/app.git",
                  },
                ],
              },
              strategy: "clone",
            },
          },
          {
            kind: "update",
            input: {
              requestId: "unsafe-url-edit",
              projectId: project.id,
              expectedRevision: 1,
              resourceUpdates: [
                {
                  id: resource.id,
                  remoteUrl: "https://user:synthetic-secret@github.com/acme/app.git",
                },
              ],
            },
          },
          {
            kind: "import",
            input: {
              requestId: "unsafe-url-import",
              rootPath: "/work/project",
              repositoryUpdate: {
                resourceId: resource.id,
                remoteUrl: "https://user:synthetic-secret@github.com/acme/app.git",
              },
            },
          },
        ];
        for (const [index, request] of requests.entries()) {
          const failure = yield* state.service
            .run(`unsafe:${index}`, request, actor)
            .pipe(Effect.flip);
          expect(failure.reason).toBe("invalid");
        }
        const sql = yield* SqlClient.SqlClient;
        expect(yield* sql`SELECT request_json FROM fork_library_operations`).toEqual([]);
        expect(yield* Ref.get(state.calls)).toBe(0);
        yield* Ref.set(state.catalog, [{ ...project, profile }]);
        expect(
          (yield* state.service.execute(
            "unchanged-legacy",
            {
              kind: "update",
              input: {
                requestId: "unchanged-legacy",
                projectId: project.id,
                expectedRevision: 1,
                profile,
                title: "Renamed",
              },
            },
            actor,
          )).state,
        ).toBe("succeeded");
      }),
    ),
  );

  it.effect(
    "refuses inconsistent launch snapshots before reserving or applying project setup",
    () =>
      run((state) =>
        Effect.gen(function* () {
          const input = {
            project,
            binding: {
              projectId: project.id,
              projectRevision: project.revision,
              environmentId,
              workingCopyId: "launch-files",
              resourceIds: [],
            },
            threadId: ThreadId.make("inconsistent-launch"),
            title: "Review",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            runtimeMode: "approval-required" as const,
            interactionMode: "plan" as const,
            files: { requestId: "launch-files", project, strategy: "clone" as const },
          };
          const variants = [
            { ...input, binding: { ...input.binding, projectRevision: 2 } },
            { ...input, files: { ...input.files, project: { ...project, revision: 2 } } },
            {
              ...input,
              files: {
                ...input.files,
                project: {
                  ...project,
                  profile: {
                    scripts: [
                      {
                        id: "setup",
                        name: "Setup",
                        command: "changed-setup",
                        icon: "play" as const,
                        runOnWorktreeCreate: true,
                      },
                    ],
                  },
                },
              },
            },
          ];
          for (const [index, variant] of variants.entries()) {
            const failure = yield* state.service
              .execute(`inconsistent-launch:${index}`, { kind: "launch", input: variant }, actor)
              .pipe(Effect.flip);
            expect(failure.reason).toBe("invalid");
          }
          expect(yield* Ref.get(state.reservations)).toEqual([]);
          expect(yield* Ref.get(state.dispatched)).toEqual([]);
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
        expect(yield* SetupMarker.exists(worktree)).toBe(true);
        expect(yield* fs.exists(`${worktree}.t3-setup-pending`)).toBe(false);
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
  it.effect(
    "keeps a delegated launch nested under its parent, also when a person finishes it",
    () =>
      run((state) =>
        Effect.gen(function* () {
          const outsideAgent = { subject: "mcp-client", sessionId: AuthSessionId.make("outside") };
          yield* Ref.set(state.active, [
            { ...session(mcpClientScopes("full-access")), ...outsideAgent },
          ]);
          const origin = {
            linkOrigin: { sessionId: "link", label: "Laptop", access: "full-access" as const },
            delegatedFrom: {
              environmentId: EnvironmentId.make("laptop"),
              threadId: ThreadId.make("parent"),
              title: "Parent",
            },
          };
          const launch = (threadId: string): LibraryOperationInput => ({
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
              threadId: ThreadId.make(threadId),
              title: "Review",
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
              runtimeMode: "approval-required",
              interactionMode: "plan",
            },
          });
          yield* state.service.execute("delegated", launch("delegated"), outsideAgent, origin);
          // The agent's access ends before its conversation exists; a person resumes without it.
          yield* Ref.set(state.revokeAtResolve, true);
          yield* state.service
            .execute("finished", launch("finished"), outsideAgent, origin)
            .pipe(Effect.flip);
          yield* Ref.set(state.revokeAtResolve, false);
          yield* Ref.set(state.active, [session()]);
          yield* state.service.execute("finished", launch("finished"), actor);
          expect(yield* Ref.get(state.creators)).toEqual([
            { createdBy: "agent", creationSource: "mcp", ...origin },
            { createdBy: "user", creationSource: "web", ...origin },
          ]);
        }),
      ),
  );
  it.effect("opens a launch's conversation in its reserved files before they download", () =>
    run((state) =>
      Effect.gen(function* () {
        const gate = yield* holdFiles(state);
        const request = filesLaunch("files-thread");
        const opened = yield* state.service.execute("files-launch", request, actor);
        expect(opened).toMatchObject({ state: "running", result: { threadId: "files-thread" } });
        expect(yield* Ref.get(state.conversations)).toEqual(
          new Map([["files-thread", { worktreePath: "/work/project", branch: null, ran: false }]]),
        );
        expect(yield* Ref.get(state.boundCopies)).toEqual(["reserved:files-thread-files"]);
        expect(yield* Ref.get(state.retentionSaves)).toBe(0);

        const retried = yield* state.service.execute("files-launch", request, actor);
        expect(retried.result).toEqual({ threadId: "files-thread" });
        expect(yield* Ref.get(state.dispatched)).toEqual(["files-launch:create"]);
        expect(yield* Ref.get(state.reservations)).toEqual(["files-thread-files"]);

        yield* Deferred.succeed(gate, undefined);
        expect((yield* settled(state, "files-launch")).state).toBe("succeeded");
        expect(yield* Ref.get(state.fills)).toBe(1);
        expect(yield* Ref.get(state.retentionSaves)).toBe(1);
      }),
    ),
  );

  it.effect("finishes a launch whose files the computer placed in a borrowed checkout", () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.placedBorrowed, true);
        const request = filesLaunch("borrowed-thread");
        const launched = yield* state.service.execute(
          "files-borrowed",
          { ...request, input: { ...request.input, keepOnComputer: false } },
          actor,
        );
        expect(launched.result).toEqual({ threadId: "borrowed-thread" });
        expect(yield* settled(state, "files-borrowed")).toMatchObject({
          state: "succeeded",
          error: null,
        });
        expect(yield* Ref.get(state.retentionSaves)).toBe(0);
      }),
    ),
  );

  it.effect("keeps the conversation when its files fail to download and finishes on resume", () =>
    run((state) =>
      Effect.gen(function* () {
        const gate = yield* holdFiles(state);
        yield* Ref.set(
          state.fillFailure,
          new LibraryError({ reason: "io", detail: "The download stopped." }),
        );
        const request = filesLaunch("unfilled-thread");
        expect((yield* state.service.execute("files-unfilled", request, actor)).result).toEqual({
          threadId: "unfilled-thread",
        });
        yield* Deferred.succeed(gate, undefined);
        expect(yield* settled(state, "files-unfilled")).toMatchObject({
          state: "failed",
          result: { threadId: "unfilled-thread" },
        });
        expect([...(yield* Ref.get(state.conversations)).keys()]).toEqual(["unfilled-thread"]);
        expect(yield* Ref.get(state.retentionSaves)).toBe(0);

        yield* Ref.set(state.failBind, true);
        const resumed = yield* state.service.resume("files-unfilled", actor);
        expect(resumed).toMatchObject({ state: "queued", result: { threadId: "unfilled-thread" } });
        expect(yield* settled(state, "files-unfilled")).toMatchObject({
          state: "failed",
          result: { threadId: "unfilled-thread" },
        });
        yield* Ref.set(state.failBind, false);
        yield* Ref.set(state.fillFailure, null);
        yield* state.service.resume("files-unfilled", actor);
        expect((yield* settled(state, "files-unfilled")).state).toBe("succeeded");
        expect([...(yield* Ref.get(state.conversations)).keys()]).toEqual(["unfilled-thread"]);
        expect(yield* Ref.get(state.fills)).toBe(2);
        expect(yield* Ref.get(state.retentionSaves)).toBe(1);
      }),
    ),
  );

  it.effect("moves a conversation into its worktree once the files it is made from arrive", () =>
    run((state) =>
      Effect.gen(function* () {
        const worktree = yield* worktreeFolder(state);
        const gate = yield* holdFiles(state);
        yield* state.service.execute("files-worktree", filesLaunch("moved", "worktree"), actor);
        expect(yield* Ref.get(state.worktreesMade)).toEqual([]);
        expect((yield* Ref.get(state.conversations)).get("moved")?.worktreePath).toBe(
          "/work/project",
        );

        yield* Deferred.succeed(gate, undefined);
        expect((yield* settled(state, "files-worktree")).state).toBe("succeeded");
        const made = yield* Ref.get(state.worktreesMade);
        expect(made).toHaveLength(1);
        expect((yield* Ref.get(state.conversations)).get("moved")).toEqual({
          worktreePath: worktree,
          branch: made[0]!.newRefName,
          ran: false,
        });
        expect(yield* Ref.get(state.moves)).toEqual([{ worktreePath: worktree, moved: true }]);
      }),
    ),
  );

  it.effect.each([
    { name: "before its files arrive", whileMakingWorktree: false },
    { name: "while its worktree is made", whileMakingWorktree: true },
  ])("keeps a conversation whose first message went ahead $name in its folder", (example) =>
    run((state) =>
      Effect.gen(function* () {
        yield* worktreeFolder(state);
        const gate = yield* holdFiles(state);
        yield* state.service.execute("files-ran", filesLaunch("ran", "worktree"), actor);
        const message = Ref.update(state.conversations, (map) =>
          new Map(map).set("ran", { ...map.get("ran")!, ran: true }),
        );
        if (example.whileMakingWorktree) yield* Ref.set(state.whileMakingWorktree, message);
        else yield* message;

        yield* Deferred.succeed(gate, undefined);
        expect((yield* settled(state, "files-ran")).state).toBe("succeeded");
        expect((yield* Ref.get(state.conversations)).get("ran")?.worktreePath).toBe(
          "/work/project",
        );
        expect(yield* Ref.get(state.moves)).toEqual(
          example.whileMakingWorktree ? [{ worktreePath: expect.any(String), moved: false }] : [],
        );
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

it.effect(
  "imports an existing folder once and resumes registration without creating a second project",
  () =>
    run((state) =>
      Effect.gen(function* () {
        const input = {
          kind: "import",
          input: { requestId: "folder-import", rootPath: "/work/project", title: "Project" },
        } as const;
        yield* Ref.set(state.prepareFailure, new LibraryError({ reason: "io" }));
        expect(
          (yield* Effect.flip(state.service.execute("folder-import", input, actor))).reason,
        ).toBe("io");
        expect(yield* Ref.get(state.calls)).toBe(1);
        expect((yield* Ref.get(state.creationInputs))[0]?.resources?.[0]?.defaultBranch).toBeNull();
        yield* Ref.set(state.prepareFailure, null);
        const imported = yield* state.service.execute("folder-import", input, actor);
        expect(imported.result).toEqual(project);
        expect(yield* state.service.list({ projectId: project.id })).toEqual([]);
        expect(
          (yield* state.service.list({ projectId: project.id, includeFolderImports: true })).map(
            (operation) => operation.id,
          ),
        ).toEqual(["folder-import"]);
        expect(yield* Ref.get(state.calls)).toBe(1);
        expect(yield* Ref.get(state.published)).toBe(1);
        expect(yield* state.service.execute("folder-import", input, actor)).toEqual(imported);
        expect(yield* Ref.get(state.published)).toBe(1);
        yield* Ref.set(state.publishFailure, true);
        const retry = {
          kind: "import",
          input: {
            requestId: "lost-registration",
            rootPath: "/work/project",
            projectId: project.id,
          },
        } as const;
        yield* Ref.set(state.catalog, [project]);
        expect(
          (yield* Effect.flip(state.service.execute("lost-registration", retry, actor))).reason,
        ).toBe("io");
        yield* Ref.set(state.publishFailure, false);
        yield* state.service.execute("lost-registration", retry, actor);
        const requests = yield* Ref.get(state.registrations);
        expect(requests[1]).toEqual(requests[2]);
      }),
    ),
);

it.effect(
  "reuses exact shared repository matches and refuses ambiguous or unauthorized imports",
  () =>
    run((state) =>
      Effect.gen(function* () {
        const matching = {
          ...project,
          resources: [
            { ...resource, relativePath: ".", remoteUrl: "https://github.com/acme/app.git" },
          ],
        };
        yield* Ref.set(state.catalog, [matching, { ...matching, id: "another" }]);
        const input = {
          kind: "import",
          input: { requestId: "matching-import", rootPath: "/work/project" },
        } as const;
        expect(
          (yield* Effect.flip(state.service.execute("matching-import", input, actor))).reason,
        ).toBe("blocked");
        expect(yield* Ref.get(state.calls)).toBe(0);
        yield* Ref.set(state.catalog, [matching]);
        const imported = yield* state.service.execute("matching-import", input, actor);
        expect(imported.result).toEqual(matching);
        expect(yield* Ref.get(state.calls)).toBe(0);
        yield* Ref.set(state.active, [session([AuthTerminalOperateScope])]);
        expect(
          (yield* Effect.flip(
            state.service.execute(
              "not-authorized",
              { ...input, input: { ...input.input, requestId: "not-authorized" } },
              actor,
            ),
          )).reason,
        ).toBe("blocked");
      }),
    ),
);

it.effect(
  "serializes concurrent imports of one folder before creating shared project records",
  () =>
    run((state) =>
      Effect.gen(function* () {
        yield* Ref.update(state.inspected, (inspection) => ({ ...inspection, repositories: [] }));
        const imported = yield* Effect.forEach(
          ["first", "second"],
          (id) =>
            state.service.execute(
              id,
              { kind: "import", input: { requestId: id, rootPath: "/work/project" } },
              actor,
            ),
          { concurrency: "unbounded" },
        );
        expect(imported.map((operation) => operation.result)).toEqual([project, project]);
        expect(yield* Ref.get(state.calls)).toBe(1);
      }),
    ),
);
