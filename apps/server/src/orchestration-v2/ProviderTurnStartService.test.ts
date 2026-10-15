// fork: mini-native-retention
import { expect, it, vi } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";
import {
  GitCommandError,
  CheckpointScopeId,
  CheckpointId,
  CheckpointRef,
  MessageId,
  NodeId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSetupError,
  RunAttemptId,
  RunId,
  ThreadId,
  ProjectId,
  type OrchestrationV2ThreadProjection,
  OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  markManagedProjectCheckout,
  readManagedProjectCheckout,
  archiveManagedProjectCheckout,
  releaseManagedProjectCheckout,
} from "../workspace/ManagedProjectCheckout.ts";
import { buildRepositoryIdentity } from "../project/RepositoryIdentityResolver.ts";
import { archiveScratchCheckout } from "../workspace/ScratchCheckout.ts";
import * as ProviderTurnStartTestkit from "./ProviderTurnStartService.testkit.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderAuthService from "../provider/ProviderAuthService.ts";
import * as ContextHandoffService from "./ContextHandoffService.ts";
import * as EventSink from "./EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as ProviderTurnStart from "./ProviderTurnStartService.ts";
import * as RunExecutionService from "./RunExecutionService.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";

const isDomainEvent = Schema.is(OrchestrationV2DomainEvent);

it.each(["projection", "checkout", "setup"] as const)(
  "does not start the provider when %s preparation fails",
  async (failurePoint) => {
    const threadId = ThreadId.make("thread_provider_turn_start_projection_failure");
    const runId = RunId.make("run_provider_turn_start_projection_failure");
    const attemptId = RunAttemptId.make("attempt_provider_turn_start_projection_failure");
    const rootNodeId = NodeId.make("node_provider_turn_start_projection_failure");
    const providerThreadId = ProviderThreadId.make(
      "provider_thread_provider_turn_start_projection_failure",
    );
    const providerSessionId = ProviderSessionId.make(
      "provider_session_provider_turn_start_projection_failure",
    );
    const messageId = MessageId.make("message_provider_turn_start_projection_failure");
    const checkpointScopeId = CheckpointScopeId.make(
      "checkpoint_scope_provider_turn_start_projection_failure",
    );
    const projection = {
      thread: {
        id: threadId,
        projectId: ProjectId.make("project_provider_turn_start_projection_failure"),
        branch: "feature/restore",
        worktreePath: "/tmp/missing-provider-turn-start-worktree",
      },
      runs: [
        {
          id: runId,
          status: "starting",
          rootNodeId,
          activeAttemptId: attemptId,
          providerThreadId,
          userMessageId: messageId,
          ordinal: 2,
        },
      ],
      nodes: [{ id: rootNodeId, checkpointScopeId }],
      attempts: [{ id: attemptId }],
      providerThreads: [{ id: providerThreadId, providerSessionId }],
      messages: [{ id: messageId, text: "Continue", attachments: [] }],
      checkpointScopes: [{ id: checkpointScopeId }],
      contextHandoffs: [],
      contextTransfers: [],
      turnItems: [],
    } as unknown as OrchestrationV2ThreadProjection;
    let projectionReadCount = 0;
    const writeIfRunCurrent = vi.fn(() =>
      Effect.succeed({ committed: true, storedEvents: [] } as never),
    );
    const startRootRun = vi.fn(() => Effect.void);
    const pruneWorktrees = vi.fn(() => Effect.void);
    const createWorktree = vi.fn(() =>
      failurePoint === "checkout"
        ? Effect.fail(
            new GitCommandError({
              operation: "test.createWorktree",
              command: "git worktree add",
              cwd: "/tmp/provider-turn-start-project",
              detail: "branch unavailable",
            }),
          )
        : Effect.succeed({} as never),
    );
    const openSession = vi.fn(() =>
      Effect.die("The provider must not open before workspace preparation succeeds."),
    );
    const layer = ProviderTurnStart.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ProviderTurnStartTestkit.layer,
          Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
            runForThread: () =>
              Effect.succeed(
                failurePoint === "setup"
                  ? {
                      status: "started",
                      scriptId: "setup",
                      scriptName: "Setup",
                      scriptCommand: "setup",
                      terminalId: "setup-terminal",
                      cwd: "/tmp/missing-provider-turn-start-worktree",
                      async: true,
                      completion: Effect.succeed({ exitCode: 1, durationMs: 1 }),
                    }
                  : { status: "no-script" },
              ),
          }),
          Layer.mock(ContextHandoffService.ContextHandoffServiceV2)({}),
          Layer.mock(EventSink.EventSinkV2)({ writeIfRunCurrent }),
          IdAllocator.layer,
          FileSystem.layerNoop({
            exists: () => Effect.succeed(false),
            makeDirectory: () => Effect.void,
            writeFileString: () => Effect.void,
            remove: () => Effect.void,
          }),
          Layer.mock(GitWorkflow.GitWorkflowService)({
            hasCommit: () => Effect.succeed(true),
            pruneWorktrees,
            createWorktree,
          }),
          Layer.mock(ProjectService.ProjectService)({
            getById: () =>
              Effect.succeed(
                Option.some({ workspaceRoot: "/tmp/provider-turn-start-project" } as never),
              ),
          }),
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getTurnStartContext: () => {
              projectionReadCount += 1;
              return Effect.succeed({
                ...projection,
                hasConversation: projection.messages.some(
                  (m) =>
                    m.role === "user" &&
                    (m.text.trim().toLowerCase() !== "/compact" || m.attachments.length > 0),
                ),
              });
            },
            getRuntimeRecoveryProjection: () => {
              projectionReadCount += 1;
              return Effect.fail(
                new ProjectionStore.ProjectionStoreReadError({
                  threadId,
                  cause: "simulated inherited-background projection failure",
                }),
              );
            },
          }),
          Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({ open: openSession }),
          Layer.mock(ProviderAuthService.ProviderAuthService)({
            tryHandlePromptCommand: () => Effect.succeed(false),
          }),
          Layer.mock(RunExecutionService.RunExecutionServiceV2)({ startRootRun }),
          Layer.mock(RuntimePolicy.RuntimePolicyV2)({}),
        ),
      ),
    );

    await Effect.gen(function* () {
      const error = yield* (yield* ProviderTurnStart.ProviderTurnStartServiceV2)
        .start({ threadId, runId, willRetry: true })
        .pipe(Effect.flip);

      expect(error._tag).toBe("ProviderTurnStartError");
      expect(projectionReadCount).toBe(failurePoint === "projection" ? 2 : 1);
      expect(pruneWorktrees).toHaveBeenCalledWith({ cwd: "/tmp/provider-turn-start-project" });
      expect(createWorktree).toHaveBeenCalledWith({
        cwd: "/tmp/provider-turn-start-project",
        refName: "feature/restore",
        path: "/tmp/missing-provider-turn-start-worktree",
      });
      expect(writeIfRunCurrent).not.toHaveBeenCalled();
      expect(startRootRun).not.toHaveBeenCalled();
      expect(openSession).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layer), Effect.runPromise);
  },
);

function makeLocalCommandHarness(input: {
  readonly text: string;
  readonly previousNativeSession?: boolean;
  readonly previousMessages?: ReadonlyArray<string>;
  readonly logoutFailure?: string;
  readonly openFailure?: unknown;
  /** Opens the session, then fails loading its provider thread. */
  readonly ensureThreadFailure?: unknown;
  /**
   * Resumes a thread that has a native ref: resume fails, the fresh-thread
   * fallback succeeds, then reading history for its handoff fails.
   */
  readonly historyReadFailureAfterFallback?: unknown;
  readonly interruptOpen?: boolean;
  readonly interruptRunBeforeOpenFailure?: boolean;
  readonly writeFailure?: unknown;
  /** Loads the thread and starts the run, then fails every later state read. */
  readonly failReadsAfterRunning?: boolean;
  readonly restoredWorkspace?: {
    readonly cwd: string;
    readonly scratchRoot: string;
    readonly fs: FileSystem.FileSystem;
    readonly git: GitVcsDriver.GitVcsDriver["Service"];
    readonly beforeOpen: Effect.Effect<void>;
    readonly primary?: boolean;
    readonly runSetup?: ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"]["runForThread"];
  };
}) {
  const now = DateTime.makeUnsafe("2026-09-04T12:00:00Z");
  const threadId = ThreadId.make("thread-native-account-command");
  const runId = RunId.make("run-native-account-command");
  const rootNodeId = NodeId.make("root-native-account-command");
  const attemptId = RunAttemptId.make("attempt-native-account-command");
  const providerThreadId = ProviderThreadId.make("new-provider-thread");
  const providerSessionId = ProviderSessionId.make("new-provider-session");
  const oldProviderThreadId = ProviderThreadId.make("existing-native-provider-thread");
  const oldInstanceId = ProviderInstanceId.make("antigravity-personal");
  const newInstanceId = ProviderInstanceId.make("codex-personal");
  const checkpointScopeId = CheckpointScopeId.make("scope-native-account-command");
  const messageId = MessageId.make("message-native-account-command");
  const run: OrchestrationV2ThreadProjection["runs"][number] = {
    id: runId,
    threadId,
    ordinal: 2,
    providerInstanceId: newInstanceId,
    modelSelection: { instanceId: newInstanceId, model: "gpt-5.4" },
    providerThreadId,
    userMessageId: messageId,
    rootNodeId,
    activeAttemptId: attemptId,
    status: "starting",
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    checkpointId: null,
    contextHandoffId: null,
  };
  const providerThread: OrchestrationV2ThreadProjection["providerThreads"][number] = {
    id: providerThreadId,
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: newInstanceId,
    providerSessionId,
    appThreadId: threadId,
    ownerNodeId: null,
    nativeThreadRef: input.restoredWorkspace
      ? {
          driver: ProviderDriverKind.make("codex"),
          nativeId: "retained-scratch-native-thread",
          strength: "strong",
        }
      : null,
    nativeConversationHeadRef: null,
    status: "not_loaded",
    firstRunOrdinal: 2,
    lastRunOrdinal: 2,
    handoffIds: [],
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
  };
  const message: OrchestrationV2ThreadProjection["messages"][number] = {
    id: messageId,
    threadId,
    runId,
    nodeId: rootNodeId,
    role: "user",
    text: input.text,
    attachments: [],
    streaming: false,
    createdBy: "user",
    creationSource: "web",
    createdAt: now,
    updatedAt: now,
  };
  let projection: OrchestrationV2ThreadProjection = {
    thread: {
      id: threadId,
      activeProviderThreadId: providerThreadId,
      branch: null,
      worktreePath: input.restoredWorkspace?.primary
        ? null
        : (input.restoredWorkspace?.cwd ?? null),
      projectId: ProjectId.make("scratch-resume-project"),
    } as OrchestrationV2ThreadProjection["thread"],
    runs: [
      ...(input.previousNativeSession
        ? [
            {
              ...run,
              id: RunId.make("previous-native-run"),
              ordinal: 1,
              status: "completed" as const,
              providerInstanceId: oldInstanceId,
              providerThreadId: input.restoredWorkspace ? providerThreadId : oldProviderThreadId,
              checkpointId: input.restoredWorkspace
                ? CheckpointId.make("retained-scratch-checkpoint")
                : null,
            },
          ]
        : []),
      run,
    ],
    attempts: [
      {
        id: attemptId,
        runId,
        rootNodeId,
        attemptOrdinal: 1,
        providerInstanceId: newInstanceId,
        providerThreadId,
        providerTurnId: null,
        reason: "initial",
        status: "pending",
        startedAt: null,
        completedAt: null,
      },
    ],
    nodes: [
      {
        id: rootNodeId,
        threadId,
        runId,
        parentNodeId: null,
        rootNodeId,
        kind: "root_turn",
        status: "pending",
        countsForRun: true,
        providerThreadId,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: null,
        checkpointScopeId,
        startedAt: null,
        completedAt: null,
      },
    ],
    providerThreads: [
      ...(input.previousNativeSession
        ? [
            {
              ...providerThread,
              id: oldProviderThreadId,
              providerInstanceId: oldInstanceId,
              driver: ProviderDriverKind.make("antigravity"),
              lastRunOrdinal: 1,
              nativeThreadRef: {
                driver: ProviderDriverKind.make("antigravity"),
                nativeId: "existing-session",
                strength: "strong" as const,
              },
            },
          ]
        : []),
      providerThread,
    ],
    messages: [
      ...(input.previousMessages ?? []).map((text, index) => ({
        ...message,
        id: MessageId.make(`previous-message-${index}`),
        text,
      })),
      message,
    ],
    checkpointScopes: [
      {
        id: checkpointScopeId,
        threadId,
        runId,
        nodeId: rootNodeId,
        parentScopeId: null,
        providerThreadId,
        kind: "root_run",
        ordinalWithinParent: 0,
        advancesAppRunCount: true,
        cwd: "/tmp/native-account-command",
        createdAt: now,
      },
    ],
    providerSessions: input.restoredWorkspace
      ? [
          {
            id: providerSessionId,
            driver: ProviderDriverKind.make("codex"),
            providerInstanceId: newInstanceId,
            status: "stopped",
            cwd: input.restoredWorkspace.cwd,
            model: null,
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
        ]
      : [],
    providerTurns: [],
    contextHandoffs: [],
    contextTransfers: [],
    turnItems: [],
    visibleTurnItems: [],
    runtimeRequests: [],
    subagents: [],
    plans: [],
    checkpoints: input.restoredWorkspace
      ? [
          {
            id: CheckpointId.make("retained-scratch-checkpoint"),
            threadId,
            scopeId: checkpointScopeId,
            runId: RunId.make("previous-native-run"),
            nodeId: rootNodeId,
            parentCheckpointId: null,
            ordinalWithinScope: 1,
            appRunOrdinal: 1,
            ref: CheckpointRef.make("refs/t3/orchestration-v2/checkpoints/retained/ordinal/1"),
            status: "ready",
            files: [],
            capturedAt: now,
          },
        ]
      : [],
    updatedAt: now,
  };
  if ("historyReadFailureAfterFallback" in input) {
    const nativeThreadRef = {
      driver: providerThread.driver,
      nativeId: "native-resume-thread",
      strength: "strong" as const,
    };
    projection = {
      ...projection,
      providerThreads: projection.providerThreads.map((candidate) =>
        candidate.id === providerThreadId ? { ...candidate, nativeThreadRef } : candidate,
      ),
    };
  }
  const events: Array<OrchestrationV2DomainEvent> = [];
  const interruptRun = () => {
    projection = {
      ...projection,
      runs: projection.runs.map((candidate) =>
        candidate.id === runId
          ? { ...candidate, status: "interrupted", completedAt: now }
          : candidate,
      ),
    };
  };
  const ensureThread = vi.fn(() =>
    Effect.sync(() => {
      if (input.interruptRunBeforeOpenFailure === true) interruptRun();
    }).pipe(
      Effect.andThen(
        Effect.fail(
          new ProviderAdapter.ProviderAdapterEventStreamError({
            driver: providerThread.driver,
            providerSessionId,
            cause: input.ensureThreadFailure,
          }),
        ),
      ),
    ),
  );
  const resumeFallbackSession = {
    driver: providerThread.driver,
    resumeThread: () =>
      Effect.fail(
        new ProviderAdapter.ProviderAdapterEventStreamError({
          driver: providerThread.driver,
          providerSessionId,
          cause: "native thread is gone",
        }),
      ),
    ensureThread: () => Effect.succeed(providerThread),
  };
  const open = vi.fn(() =>
    input.restoredWorkspace
      ? input.restoredWorkspace.beforeOpen.pipe(
          Effect.as({
            driver: providerThread.driver,
            providerSession: projection.providerSessions[0],
            ensureThread: () => Effect.succeed(providerThread),
            resumeThread: () => Effect.succeed(providerThread),
          } as never),
        )
      : input.interruptOpen === true
        ? Effect.interrupt
        : "historyReadFailureAfterFallback" in input
          ? Effect.succeed(resumeFallbackSession as never)
          : "ensureThreadFailure" in input
            ? Effect.succeed({ driver: providerThread.driver, ensureThread } as never)
            : "openFailure" in input
              ? Effect.sync(() => {
                  if (input.interruptRunBeforeOpenFailure === true) interruptRun();
                }).pipe(
                  Effect.andThen(
                    Effect.fail(
                      new ProviderSessionManager.ProviderSessionOpenError({
                        instanceId: newInstanceId,
                        providerSessionId,
                        cause: input.openFailure,
                      }),
                    ),
                  ),
                )
              : input.failReadsAfterRunning === true
                ? Effect.succeed({
                    driver: providerThread.driver,
                    providerSession: {
                      id: providerSessionId,
                      driver: providerThread.driver,
                      providerInstanceId: newInstanceId,
                      status: "ready",
                      cwd: "/tmp/native-account-command",
                      model: null,
                      capabilities: CodexProviderCapabilitiesV2,
                      createdAt: now,
                      updatedAt: now,
                      lastError: null,
                    },
                    ensureThread: () => Effect.succeed(providerThread),
                  } as never)
                : Effect.die("A local command must not open a native session."),
  );
  const startRootRun = vi.fn<
    (input: RunExecutionService.RunExecutionServiceV2StartRootRunInput) => Effect.Effect<void>
  >(() =>
    input.failReadsAfterRunning === true || input.restoredWorkspace !== undefined
      ? Effect.void
      : Effect.die("A local command must not start a native turn."),
  );
  const failReadIfRunning = Effect.suspend(() =>
    input.failReadsAfterRunning === true &&
    projection.runs.find((candidate) => candidate.id === runId)?.status === "running"
      ? Effect.fail(
          new ProjectionStore.ProjectionStoreReadError({ threadId, cause: "database unavailable" }),
        )
      : Effect.void,
  );
  const tryHandlePromptCommand = vi.fn(() =>
    input.logoutFailure === undefined
      ? Effect.succeed(true)
      : Effect.fail(
          new ProviderSetupError({
            instanceId: oldInstanceId,
            operation: "logout",
            detail: input.logoutFailure,
          }),
        ),
  );
  const writeIfRunCurrent = vi.fn(({ events: incoming, activeAttemptId, expectedStatus }) =>
    "writeFailure" in input
      ? Effect.fail(
          new EventSink.EventSinkWriteError({
            eventCount: incoming.length,
            cause: input.writeFailure,
          }),
        )
      : Effect.sync(() => {
          const current = projection.runs.find((candidate) => candidate.id === runId);
          const committed =
            current !== undefined &&
            current.activeAttemptId === activeAttemptId &&
            current.status === expectedStatus;
          if (committed) {
            for (const event of incoming) {
              expect(isDomainEvent(event)).toBe(true);
              events.push(event);
              projection = ProjectionStore.applyToProjection(projection, event);
            }
          }
          return { committed, storedEvents: [] };
        }),
  );
  const layer = ProviderTurnStart.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ProviderTurnStartTestkit.layer,
        Layer.mock(ContextHandoffService.ContextHandoffServiceV2)({
          prepareProviderHandoff: () => Effect.die("history read must fail first"),
        }),
        Layer.mock(EventSink.EventSinkV2)({ writeIfRunCurrent }),
        IdAllocator.layer,
        input.restoredWorkspace
          ? Layer.succeed(FileSystem.FileSystem, input.restoredWorkspace.fs)
          : FileSystem.layerNoop({}),
        Layer.mock(GitVcsDriver.GitVcsDriver)(input.restoredWorkspace?.git ?? {}),
        Layer.mock(GitWorkflow.GitWorkflowService)({}),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            input.restoredWorkspace
              ? Effect.succeed(
                  Option.some({
                    workspaceRoot: input.restoredWorkspace.primary
                      ? input.restoredWorkspace.cwd
                      : input.restoredWorkspace.scratchRoot,
                  } as never),
                )
              : Effect.succeed(Option.none()),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getTurnStartContext: () =>
            Effect.succeed({
              ...projection,
              hasConversation: projection.messages.some(
                (m) =>
                  m.role === "user" &&
                  (m.text.trim().toLowerCase() !== "/compact" || m.attachments.length > 0),
              ),
            }),
          getRuntimeRecoveryProjection: () =>
            Effect.as(failReadIfRunning, {
              ...projection,
              hasConversation: projection.messages.some(
                (m) =>
                  m.role === "user" &&
                  (m.text.trim().toLowerCase() !== "/compact" || m.attachments.length > 0),
              ),
            }),
          getTurnStartHistory: () =>
            Effect.fail(
              new ProjectionStore.ProjectionStoreReadError({
                threadId,
                cause: input.historyReadFailureAfterFallback,
              }),
            ),
        }),
        Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
          runForThread:
            input.restoredWorkspace?.runSetup ?? (() => Effect.succeed({ status: "no-script" })),
        }),
        Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({ open }),
        Layer.mock(ProviderAuthService.ProviderAuthService)({ tryHandlePromptCommand }),
        Layer.mock(RunExecutionService.RunExecutionServiceV2)({ startRootRun }),
        Layer.mock(RuntimePolicy.RuntimePolicyV2)({
          resolve: () => Effect.succeed({} as never),
        }),
      ),
    ),
  );
  return {
    open,
    writeIfRunCurrent,
    startRootRun,
    tryHandlePromptCommand,
    events,
    oldInstanceId,
    newInstanceId,
    attemptId,
    projection: () => projection,
    start: Effect.gen(function* () {
      yield* (yield* ProviderTurnStart.ProviderTurnStartServiceV2).start({ threadId, runId });
    }).pipe(Effect.provide(layer)),
    startWithRetry: Effect.gen(function* () {
      yield* (yield* ProviderTurnStart.ProviderTurnStartServiceV2).start({
        threadId,
        runId,
        willRetry: true,
      });
    }).pipe(Effect.provide(layer)),
  };
}

effectIt.effect("terminalizes a starting run when its provider session cannot open", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({
      text: "Continue",
      openFailure: new Error("DESCRIPTION is not valid ACP JSON"),
    });

    yield* harness.start;

    expect(harness.open).toHaveBeenCalledOnce();
    expect(harness.startRootRun).not.toHaveBeenCalled();
    expect(harness.writeIfRunCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        activeAttemptId: harness.attemptId,
        expectedStatus: "starting",
      }),
    );
    const projection = harness.projection();
    expect(projection.runs.at(-1)).toMatchObject({ status: "failed", startedAt: null });
    expect(projection.attempts[0]).toMatchObject({ status: "failed", startedAt: null });
    expect(projection.nodes[0]).toMatchObject({ status: "failed", startedAt: null });
    expect(projection.turnItems).toMatchObject([
      {
        type: "error",
        status: "failed",
        failure: {
          class: "provider_error",
          message: "DESCRIPTION is not valid ACP JSON",
        },
      },
    ]);
  }),
);

effectIt.effect("leaves the run starting when a session-open failure will be retried", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({
      text: "Continue",
      openFailure: new Error("provider session rejected"),
    });

    const error = yield* harness.startWithRetry.pipe(Effect.flip);

    expect(error._tag).toBe("ProviderTurnStartError");
    expect(harness.writeIfRunCurrent).not.toHaveBeenCalled();
    expect(harness.projection().runs.at(-1)?.status).toBe("starting");
  }),
);

effectIt.effect("keeps a session-open failure retryable when terminal persistence fails", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({
      text: "Continue",
      openFailure: new Error("provider session rejected"),
      writeFailure: new Error("database unavailable"),
    });

    const error = yield* harness.start.pipe(Effect.flip);

    expect(error._tag).toBe("ProviderTurnStartError");
    expect(harness.writeIfRunCurrent).toHaveBeenCalledOnce();
    expect(harness.startRootRun).not.toHaveBeenCalled();
    expect(harness.projection().runs.at(-1)?.status).toBe("starting");
    expect(harness.events).toEqual([]);
  }),
);

effectIt.effect("does not terminalize a provider-session open interruption", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({ text: "Continue", interruptOpen: true });

    const exit = yield* Effect.exit(harness.start);

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
    expect(harness.writeIfRunCurrent).not.toHaveBeenCalled();
    expect(harness.startRootRun).not.toHaveBeenCalled();
    expect(harness.projection().runs.at(-1)?.status).toBe("starting");
    expect(harness.events).toEqual([]);
  }),
);

effectIt.effect("does not overwrite a run interrupted while its provider session opens", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({
      text: "Continue",
      openFailure: new Error("provider session rejected"),
      interruptRunBeforeOpenFailure: true,
    });

    yield* harness.start;

    expect(harness.writeIfRunCurrent).toHaveBeenCalledOnce();
    expect(harness.startRootRun).not.toHaveBeenCalled();
    const projection = harness.projection();
    expect(projection.runs.at(-1)?.status).toBe("interrupted");
    expect(projection.attempts[0]?.status).toBe("pending");
    expect(projection.nodes[0]?.status).toBe("pending");
    expect(projection.turnItems).toEqual([]);
    expect(harness.events).toEqual([]);
  }),
);

effectIt.effect("fails a starting run when its last start attempt cannot load the thread", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({
      text: "Continue",
      ensureThreadFailure: new Error("Pi RPC read failed: pi process exited with code 1."),
    });

    yield* harness.start;

    expect(harness.startRootRun).not.toHaveBeenCalled();
    const projection = harness.projection();
    expect(projection.runs.at(-1)).toMatchObject({ status: "failed", startedAt: null });
    expect(projection.attempts[0]).toMatchObject({ status: "failed", startedAt: null });
    expect(projection.nodes[0]).toMatchObject({ status: "failed", startedAt: null });
    expect(projection.turnItems).toMatchObject([
      {
        type: "error",
        title: "Provider turn failed to start",
        failure: {
          class: "provider_error",
          message: "Pi RPC read failed: pi process exited with code 1.",
        },
      },
    ]);
  }),
);

effectIt.effect("leaves the run starting when a thread-load failure will be retried", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({
      text: "Continue",
      ensureThreadFailure: new Error("pi process exited with code 1"),
    });

    const error = yield* harness.startWithRetry.pipe(Effect.flip);

    expect(error._tag).toBe("ProviderTurnStartError");
    expect(harness.writeIfRunCurrent).not.toHaveBeenCalled();
    expect(harness.projection().runs.at(-1)?.status).toBe("starting");
  }),
);

effectIt.effect("keeps a thread-load failure retryable when terminal persistence fails", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({
      text: "Continue",
      ensureThreadFailure: new Error("pi process exited with code 1"),
      writeFailure: new Error("database unavailable"),
    });

    const error = yield* harness.start.pipe(Effect.flip);

    expect(error._tag).toBe("ProviderTurnStartError");
    expect(harness.projection().runs.at(-1)?.status).toBe("starting");
    expect(harness.events).toEqual([]);
  }),
);

effectIt.effect(
  "keeps a store failure after the provider loaded the thread typed and retryable",
  () =>
    Effect.gen(function* () {
      const harness = makeLocalCommandHarness({
        text: "Continue",
        historyReadFailureAfterFallback: new Error("database unavailable"),
      });

      const error = yield* harness.start.pipe(Effect.flip);

      // The provider succeeded; the failing stage is the projection read, so
      // the run is not failed as a provider error on the last attempt.
      expect(error._tag).toBe("ProviderTurnStartError");
      expect((error.cause as { _tag?: string } | undefined)?._tag).toBe("ProjectionStoreReadError");
      expect(harness.writeIfRunCurrent).not.toHaveBeenCalled();
      expect(harness.projection().runs.at(-1)?.status).toBe("starting");
      expect(harness.events).toEqual([]);
    }),
);

effectIt.effect("does not mistake a failed state read for a superseded run", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({ text: "Continue", failReadsAfterRunning: true });

    yield* harness.start;

    expect(harness.projection().runs.at(-1)?.status).toBe("running");
    const controls = harness.startRootRun.mock.calls[0]?.[0];
    expect(controls).toBeDefined();
    if (controls === undefined) return;
    // "false" would skip the provider turn or the terminal write and leave the
    // run active. A read failure must reach the caller instead.
    const startCheck = yield* Effect.flip(controls.shouldStartProviderTurn!());
    const finalizeCheck = yield* Effect.flip(controls.shouldFinalizeRun!());
    expect(startCheck._tag).toBe("ProjectionStoreReadError");
    expect(finalizeCheck._tag).toBe("ProjectionStoreReadError");
  }),
);

effectIt.effect("does not overwrite a run interrupted while its thread loads", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({
      text: "Continue",
      ensureThreadFailure: new Error("pi process exited with code 1"),
      interruptRunBeforeOpenFailure: true,
    });

    yield* harness.start;

    expect(harness.projection().runs.at(-1)?.status).toBe("interrupted");
    expect(harness.projection().turnItems).toEqual([]);
    expect(harness.events).toEqual([]);
  }),
);

effectIt.effect(
  "signs out the existing native provider before opening the newly selected provider",
  () =>
    Effect.gen(function* () {
      const harness = makeLocalCommandHarness({ text: "/logout", previousNativeSession: true });

      yield* harness.start;
      yield* harness.start;

      expect(harness.tryHandlePromptCommand).toHaveBeenCalledExactlyOnceWith({
        instanceId: harness.oldInstanceId,
        text: "/logout",
        hasAttachments: false,
      });
      expect(harness.open).not.toHaveBeenCalled();
      expect(harness.startRootRun).not.toHaveBeenCalled();
      const projection = harness.projection();
      expect(projection.runs.at(-1)?.status).toBe("completed");
      expect(projection.attempts[0]?.status).toBe("completed");
      expect(projection.nodes[0]?.status).toBe("completed");
      expect(projection.turnItems).toMatchObject([
        {
          type: "command_execution",
          title: "Provider signed out",
          output: "Provider signed out",
          status: "completed",
        },
      ]);
      expect(projection.providerTurns).toEqual([]);
      expect(projection.checkpoints).toEqual([]);
    }),
);

effectIt.effect("persists a failed sign-out without starting a provider turn", () =>
  Effect.gen(function* () {
    const harness = makeLocalCommandHarness({
      text: "/logout",
      logoutFailure: "Could not stop all sessions for this provider. Try again.",
    });

    yield* harness.start;

    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.startRootRun).not.toHaveBeenCalled();
    expect(harness.projection().runs.at(-1)?.status).toBe("failed");
    expect(harness.projection().turnItems).toMatchObject([
      {
        type: "error",
        title: "Provider sign-out failed",
        failure: {
          class: "permission_error",
          message: "Could not stop all sessions for this provider. Try again.",
        },
      },
    ]);
  }),
);

for (const previousMessages of [[], ["/compact", " /COMPACT "]]) {
  effectIt.effect(
    `rejects compaction without conversation context after ${previousMessages.length} prior compactions`,
    () =>
      Effect.gen(function* () {
        const harness = makeLocalCommandHarness({ text: "/compact", previousMessages });

        yield* harness.start;

        expect(harness.open).not.toHaveBeenCalled();
        expect(harness.tryHandlePromptCommand).not.toHaveBeenCalled();
        expect(harness.startRootRun).not.toHaveBeenCalled();
        expect(harness.projection().runs.at(-1)?.status).toBe("failed");
        expect(harness.projection().turnItems).toMatchObject([
          {
            type: "error",
            failure: {
              class: "validation_error",
              message: "Start a conversation before compacting this thread.",
            },
          },
        ]);
      }),
  );
}

effectIt.effect(
  "restores released Scratch before reopening a retained native provider session",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const managed = yield* fs
        .makeTempDirectoryScoped()
        .pipe(Effect.flatMap((directory) => fs.realPath(directory)));
      const scratchRoot = `${managed}/scratch`;
      const cwd = `${scratchRoot}/resumed-thread`;
      yield* fs.makeDirectory(cwd, { recursive: true });
      const command = (args: string[]) =>
        git.execute({ operation: "scratch-provider-test", cwd, args });
      yield* command(["init", "-b", "main"]);
      yield* fs.writeFileString(`${cwd}/proof.txt`, "restored before provider");
      yield* command(["add", "."]);
      yield* command([
        "-c",
        "user.name=Scratch test",
        "-c",
        "user.email=scratch@example.test",
        "commit",
        "-m",
        "local completed work",
      ]);
      yield* command([
        "update-ref",
        "refs/t3/orchestration-v2/checkpoints/retained/ordinal/1",
        "HEAD",
      ]);
      const head = (yield* command(["rev-parse", "HEAD"])).stdout;
      yield* archiveScratchCheckout({
        scratchRoot,
        worktreePath: cwd,
        projectId: ProjectId.make("scratch-resume-project"),
        threadId: ThreadId.make("thread-native-account-command"),
      });
      yield* fs.remove(cwd, { recursive: true });
      const beforeOpen = Effect.gen(function* () {
        expect(yield* fs.readFileString(`${cwd}/proof.txt`)).toBe("restored before provider");
        expect(
          (yield* command(["rev-parse", "refs/t3/orchestration-v2/checkpoints/retained/ordinal/1"]))
            .stdout,
        ).toBe(head);
        expect(yield* fs.exists(`${cwd}.t3-setup-pending`)).toBe(false);
      }).pipe(Effect.orDie);
      const harness = makeLocalCommandHarness({
        text: "Continue the prior work",
        previousNativeSession: true,
        restoredWorkspace: { cwd, scratchRoot, fs, git, beforeOpen },
      });
      yield* harness.start;
      expect(harness.open).toHaveBeenCalledWith(
        expect.objectContaining({
          initialNativeThreadId: "retained-scratch-native-thread",
          resumeFromSession: expect.objectContaining({ status: "stopped", cwd }),
        }),
      );
      expect(harness.startRootRun).toHaveBeenCalledOnce();
    }).pipe(
      Effect.provide(
        GitVcsDriver.layer.pipe(
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "scratch-provider-" }),
          ),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
      Effect.scoped,
    ),
);

// fork: project-lifecycle
for (const primary of [false, true]) {
  effectIt.effect(
    `waits for restored ${primary ? "primary project" : "Scratch"} setup and retries after failure`,
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const git = yield* GitVcsDriver.GitVcsDriver;
        const parent = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
        const scratchRoot = `${parent}/projects`;
        const cwd = `${scratchRoot}/resumed`;
        yield* fs.makeDirectory(cwd, { recursive: true });
        const command = (args: string[]) =>
          git.execute({ operation: "managed-provider-test", cwd, args });
        yield* command(["init", "-b", "main"]);
        yield* fs.writeFileString(`${cwd}/proof.txt`, "restored before provider");
        yield* command(["add", "."]);
        yield* command([
          "-c",
          "user.name=Recovery test",
          "-c",
          "user.email=recovery@example.test",
          "commit",
          "-m",
          "initial",
        ]);
        const projectId = ProjectId.make("scratch-resume-project");
        if (primary) {
          yield* markManagedProjectCheckout(
            cwd,
            buildRepositoryIdentity({
              rootPath: cwd,
              remoteName: "origin",
              remoteUrl: "https://github.com/example/restore.git",
              originUrl: undefined,
            }),
          );
          const receipt = (yield* readManagedProjectCheckout(cwd))!;
          const recovery = yield* archiveManagedProjectCheckout(receipt, projectId);
          yield* releaseManagedProjectCheckout(receipt, projectId, recovery.archive);
        } else {
          yield* archiveScratchCheckout({
            scratchRoot,
            worktreePath: cwd,
            projectId,
            threadId: ThreadId.make("thread-native-account-command"),
          });
          yield* fs.remove(cwd, { recursive: true });
        }
        let setupCount = 0;
        const runSetup: ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"]["runForThread"] =
          (input) =>
            Effect.gen(function* () {
              expect(input.observeCompletion).toBeDefined();
              expect(yield* fs.readFileString(`${cwd}/proof.txt`)).toBe("restored before provider");
              setupCount++;
              return {
                status: "started" as const,
                async: true,
                scriptId: "setup",
                scriptName: "Setup",
                scriptCommand: "fixture setup",
                terminalId: "setup-terminal",
                cwd,
                completion: Effect.succeed({ exitCode: setupCount === 1 ? 1 : 0, durationMs: 0 }),
              };
            }).pipe(Effect.orDie);
        const beforeOpen = Effect.gen(function* () {
          expect(yield* fs.exists(`${cwd}.t3-setup-pending`)).toBe(false);
          expect(setupCount).toBe(2);
        }).pipe(Effect.orDie);
        const input = {
          text: "Continue retained work",
          previousNativeSession: true,
          restoredWorkspace: { cwd, scratchRoot, fs, git, primary, runSetup, beforeOpen },
        };
        const failed = makeLocalCommandHarness(input);
        yield* failed.start;
        expect(failed.open).not.toHaveBeenCalled();
        expect(failed.projection().runs.at(-1)?.status).toBe("failed");
        expect(yield* fs.exists(`${cwd}.t3-setup-pending`)).toBe(true);
        const retry = makeLocalCommandHarness(input);
        yield* retry.start;
        expect(retry.open).toHaveBeenCalledOnce();
        expect(retry.startRootRun).toHaveBeenCalledOnce();
      }).pipe(
        Effect.provide(
          GitVcsDriver.layer.pipe(
            Layer.provideMerge(
              ServerConfig.layerTest(process.cwd(), { prefix: "project-provider-" }),
            ),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Effect.scoped,
      ),
  );
}
