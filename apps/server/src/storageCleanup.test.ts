// fork: mini-native-retention
import * as Option from "effect/Option";
import * as GitWorkflow from "./git/GitWorkflowService.ts";
import * as ProjectService from "./project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "./project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "./project/WorktreeSetupTracker.ts";
import { restoreWorktree } from "./workspace/restoreWorktree.ts";
import { restoreScratchCheckout } from "./workspace/ScratchCheckout.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import { SCAN_CACHE_FILE_NAME } from "./usage/usageScanCache.ts";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/sql/SqlClient";
import {
  DEFAULT_SERVER_SETTINGS,
  StorageCleanupReport,
  type WorktreeKeepWhen,
  type StorageCleanupSettings,
} from "@t3tools/contracts";
import * as ServerConfig from "./config.ts";
import * as StorageCleanup from "./storageCleanup.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as GitManager from "./git/GitManager.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Settings from "./serverSettings.ts";
import * as ProcessRunner from "./processRunner.ts";
import {
  markManagedProjectCheckout,
  restoreManagedProjectCheckout,
  readManagedProjectCheckout,
  setManagedProjectRetention,
} from "./workspace/ManagedProjectCheckout.ts";
import { buildRepositoryIdentity } from "./project/RepositoryIdentityResolver.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionManager from "./orchestration-v2/ProviderSessionManager.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import { CodexProviderCapabilitiesV2 } from "./orchestration-v2/Adapters/CodexAdapterV2.ts";
import { ServerActivation } from "./serverActivation.ts";
import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  storageCleanupActivityAt,
  storageCleanupPullRequestMerged,
  storageCleanupThreadIdle,
} from "./storageCleanup.ts";

const NOW_MS = Date.parse("2026-06-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const decodeCleanupReport = Schema.decodeSync(StorageCleanupReport);

function at(offsetMs: number): DateTime.Utc {
  return DateTime.makeUnsafe(NOW_MS + offsetMs);
}

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: ThreadId.make("thread-1"),
      parentThreadId: null,
      relationshipToParent: null,
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "idle",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: at(-30 * DAY_MS),
    updatedAt: at(-10 * DAY_MS),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

describe("V2 storage cleanup eligibility", () => {
  const candidate = () => shell({ branch: "feature", worktreePath: "/worktrees/feature" });

  it("allows an idle worktree and rejects the project checkout", () => {
    expect(storageCleanupThreadIdle(candidate(), NOW_MS)).toBe(true);
    expect(storageCleanupThreadIdle(shell(), NOW_MS)).toBe(false);
  });

  it.each(["running", "starting", "preparing", "waiting", "queued"] as const)(
    "retains a worktree while its thread is %s",
    (status) => {
      expect(storageCleanupThreadIdle(candidateWithStatus(status), NOW_MS)).toBe(false);
    },
  );

  it.each(["idle", "completed", "interrupted", "failed", "cancelled", "rolled_back"] as const)(
    "allows cleanup once its thread is %s",
    (status) => {
      expect(storageCleanupThreadIdle(candidateWithStatus(status), NOW_MS)).toBe(true);
    },
  );

  it.each(["completed", "interrupted", "cancelled", "rolled_back"] as const)(
    "retains %s while background work is pending",
    (status) => {
      expect(
        storageCleanupThreadIdle(
          {
            ...candidateWithStatus(status),
            pendingBackgroundTasks: [{ taskId: "task-1", kind: "command" }],
          },
          NOW_MS,
        ),
      ).toBe(false);
    },
  );

  it.each(["completed", "interrupted", "cancelled", "rolled_back"] as const)(
    "retains %s while a runtime request is pending",
    (status) => {
      expect(
        storageCleanupThreadIdle(
          {
            ...candidateWithStatus(status),
            pendingRuntimeRequest: {
              id: RuntimeRequestId.make("request-1"),
              kind: "command",
              createdAt: at(0),
            },
          },
          NOW_MS,
        ),
      ).toBe(false);
    },
  );

  it("retains an active run even if the shell status is idle", () => {
    expect(
      storageCleanupThreadIdle({ ...candidate(), activeRunId: RunId.make("run") }, NOW_MS),
    ).toBe(false);
  });

  it("retains a queued prompt before the new run has been projected", () => {
    expect(
      storageCleanupThreadIdle({ ...candidate(), latestUserMessageAt: at(-1_000) }, NOW_MS),
    ).toBe(false);
  });

  it("uses V2 run activity instead of metadata refreshes for retention", () => {
    const thread = candidate();
    const runTime = at(-3 * DAY_MS);
    expect(
      storageCleanupActivityAt({ ...thread, latestRunCompletedAt: runTime, updatedAt: at(0) }),
    ).toBe(DateTime.toEpochMillis(runTime));
  });

  function candidateWithStatus(status: OrchestrationV2ThreadShell["status"]) {
    return { ...candidate(), status };
  }
});

describe("merged pull request cleanup", () => {
  const HEAD_SHA = "a".repeat(40);
  const integrated = {
    branch: "feature",
    defaultBranch: "main",
    headSha: HEAD_SHA,
    integrated: true,
  };
  const squashed = { ...integrated, integrated: false };
  const pullRequest = (
    overrides: Partial<NonNullable<Parameters<typeof storageCleanupPullRequestMerged>[0]>> = {},
  ) => ({
    state: "merged" as const,
    headRef: "feature",
    baseRef: "main",
    headSha: HEAD_SHA,
    ...overrides,
  });

  it("removes a worktree whose head reached the default branch through a merged pull request", () => {
    expect(storageCleanupPullRequestMerged(pullRequest({ headSha: null }), integrated)).toBe(true);
  });

  it("removes a squash-merged worktree when the pull request names its exact head", () => {
    expect(storageCleanupPullRequestMerged(pullRequest(), squashed)).toBe(true);
  });

  it.each([
    ["has a later commit than the merged head", { headSha: "c".repeat(40) }],
    ["was merged into a release branch", { baseRef: "release" }],
    ["was merged into its stack parent", { baseRef: "stack-parent" }],
    ["was merged without a reported head commit", { headSha: null }],
    ["belongs to a different branch", { headRef: "other" }],
    ["is still open", { state: "open" }],
    ["was closed without merging", { state: "closed" }],
  ] as const)("keeps a squash worktree whose pull request %s", (_name, overrides) => {
    expect(storageCleanupPullRequestMerged(pullRequest(overrides), squashed)).toBe(false);
  });

  it("keeps a worktree with no pull request, or one that is not merged", () => {
    expect(storageCleanupPullRequestMerged(null, squashed)).toBe(false);
    expect(storageCleanupPullRequestMerged(null, integrated)).toBe(false);
    expect(storageCleanupPullRequestMerged(pullRequest({ state: "open" }), integrated)).toBe(false);
  });
});

const cleanupFixture = (
  storageCleanup: StorageCleanupSettings = {
    ...DEFAULT_SERVER_SETTINGS.storageCleanup,
    worktreeAfterDays: 8,
    worktreeOnDelete: true,
  },
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const git = yield* GitVcsDriver.GitVcsDriver;
    const runner = yield* ProcessRunner.make();
    const repoParent = yield* fs.makeTempDirectoryScoped({ prefix: "cleanup-repo-" });
    const repo = `${repoParent}/repo`;
    yield* fs.makeDirectory(repo);
    const command = (cwd: string, args: string[]) =>
      git.execute({ operation: "cleanup-test", cwd, args });
    yield* command(repo, ["init", "-b", "main"]);
    yield* command(repo, ["config", "user.email", "cleanup@example.test"]);
    yield* command(repo, ["config", "user.name", "Cleanup test"]);
    yield* fs.writeFileString(`${repo}/tracked.txt`, "original\n");
    yield* fs.writeFileString(`${repo}/.gitignore`, ".env\ndist/\nnode_modules/\n");
    yield* command(repo, ["add", "."]);
    yield* command(repo, ["commit", "-m", "initial"]);
    yield* fs.makeDirectory(config.worktreesDir, { recursive: true });
    const worktree = `${config.worktreesDir}/feature`;
    yield* command(repo, ["worktree", "add", "-b", "feature", worktree]);
    // worktreeOnDelete lets domain events request sweeps once a test calls activate.
    let settings: import("@t3tools/contracts").ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      storageCleanup,
    };
    let threads = [shell({ branch: "feature", worktreePath: worktree })];
    let projectRoots = [
      {
        id: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: repo,
        createdAt: DateTime.formatIso(at(-30 * DAY_MS)),
      },
    ];
    let pendingEffects = false;
    let editBeforeRemoval = false;
    let openSessionCwd: string | null = null;
    let sessionLive = true;
    let processCwd: string | null = null;
    let processInspectionFails = false;
    let fullStatusCalls = 0;
    let snapshotReads = 0;
    let onPublicationFetch: Effect.Effect<void, PlatformError.PlatformError> | undefined;
    let terminalListener:
      | Parameters<TerminalManager.TerminalManager["Service"]["subscribeMetadata"]>[0]
      | undefined;
    const activated = yield* Deferred.make<void>();
    const domainSubscribed = yield* Deferred.make<void>();
    const publishedEvents = yield* PubSub.unbounded<{
      event: OrchestrationV2DomainEvent;
      consumed: Deferred.Deferred<void>;
    }>();
    // Fork tests publish one event at a time through `publishThreadEvent`; upstream
    // tests replace this stream with a scripted one through `activate`.
    let events: Stream.Stream<OrchestrationV2DomainEvent> = Stream.unwrap(
      PubSub.subscribe(publishedEvents).pipe(
        Effect.tap(() => Deferred.succeed(domainSubscribed, undefined)),
        Effect.map((subscription) =>
          Stream.fromSubscription(subscription).pipe(
            Stream.flatMap(({ event, consumed }) =>
              Stream.succeed(event).pipe(
                // Signal only after the service's event handler has processed this item.
                Stream.concat(
                  Stream.fromEffect(Deferred.succeed(consumed, undefined)).pipe(Stream.drain),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    const context = yield* Layer.build(StorageCleanup.layer).pipe(
      Effect.provideService(GitVcsDriver.GitVcsDriver, {
        ...git,
        execute: (input) =>
          Effect.gen(function* () {
            if (editBeforeRemoval && input.args.includes("remove"))
              yield* fs.writeFileString(`${worktree}/tracked.txt`, "late edit\n");
            if (onPublicationFetch !== undefined && input.args[0] === "fetch") {
              const change = onPublicationFetch;
              onPublicationFetch = undefined;
              yield* change;
            }
            return yield* git.execute(input);
          }),
        statusDetailsLocal: (...args) => {
          fullStatusCalls++;
          return git.statusDetailsLocal(...args);
        },
      }),
      Effect.provideService(ProcessRunner.ProcessRunner, {
        run: (input) =>
          input.command === "/usr/sbin/lsof"
            ? Effect.sync(() => ({
                stdout: processCwd === null ? "" : `p42\nn${processCwd}\n`,
                stderr: "",
                code: processInspectionFails ? 1 : 0,
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                stdoutInvalidUtf8: false,
                stderrInvalidUtf8: false,
              }))
            : runner.run(input),
      }),
      Effect.provideService(Settings.ServerSettingsService, {
        getSettings: Effect.sync(() => settings),
        subscribeChanges: Effect.succeed(Stream.empty),
      } as unknown as Settings.ServerSettingsService["Service"]),
      Effect.provideService(ProjectStore.ProjectStoreV2, {
        listShells: () => Effect.sync(() => projectRoots),
      } as unknown as ProjectStore.ProjectStoreV2["Service"]),
      Effect.provideService(ProjectionStore.ProjectionStoreV2, {
        getShellSnapshot: (input?: { location?: string }) =>
          Effect.sync(() => {
            snapshotReads++;
            return { threads: input?.location === "archive" ? [] : threads };
          }),
        getThreadWorktreePaths: () =>
          Effect.sync(() =>
            threads.flatMap((thread) =>
              thread.worktreePath === null
                ? []
                : [{ threadId: thread.id, worktreePath: thread.worktreePath }],
            ),
          ),
        getThreadShell: (threadId: ThreadId) =>
          Effect.sync(() => threads.find((thread) => thread.id === threadId) ?? null),
      } as unknown as ProjectionStore.ProjectionStoreV2["Service"]),
      Effect.provideService(ProviderSessionManager.ProviderSessionManagerV2, {
        isLive: () => Effect.sync(() => sessionLive),
      } as unknown as ProviderSessionManager.ProviderSessionManagerV2["Service"]),
      Effect.provideService(Orchestrator.OrchestratorV2, {
        streamDomainEvents: Stream.suspend(() => events),
      } as unknown as Orchestrator.OrchestratorV2["Service"]),
      Effect.provideService(SqlClient.SqlClient, ((strings: TemplateStringsArray) =>
        Effect.sync(() =>
          pendingEffects && strings.join("").includes("effect_outbox")
            ? [{ id: 1 }]
            : openSessionCwd !== null && strings.join("").includes("projection_provider_sessions")
              ? [
                  {
                    payload_json: JSON.stringify({
                      id: "session-1",
                      driver: "codex",
                      providerInstanceId: "codex",
                      status: "ready",
                      cwd: openSessionCwd,
                      model: null,
                      capabilities: CodexProviderCapabilitiesV2,
                      createdAt: "2026-06-01T12:00:00.000Z",
                      updatedAt: "2026-06-01T12:00:00.000Z",
                      lastError: null,
                    }),
                  },
                ]
              : [],
        )) as unknown as SqlClient.SqlClient),
      Effect.provideService(GitManager.GitManager, {
        invalidateStatus: () => Effect.void,
      } as unknown as GitManager.GitManager["Service"]),
      Effect.provideService(TerminalManager.TerminalManager, {
        subscribeMetadata: (
          listener: Parameters<TerminalManager.TerminalManager["Service"]["subscribeMetadata"]>[0],
        ) =>
          Effect.sync(() => {
            terminalListener = listener;
            return () => {
              terminalListener = undefined;
            };
          }),
      } as unknown as TerminalManager.TerminalManager["Service"]),
      Effect.provideService(ServerActivation, Deferred.await(activated)),
    );
    const service = Context.get(context, StorageCleanup.StorageCleanup);
    return {
      service,
      repo,
      /** Starts the hourly sweep and the `publishThreadEvent` subscription, then drains. */
      activateEvents: Effect.gen(function* () {
        yield* Deferred.succeed(activated, undefined);
        yield* Deferred.await(domainSubscribed);
        yield* service.drain;
      }),
      publishThreadEvent: (
        type: "thread.settled" | "thread.unpinned",
        thread: OrchestrationV2ThreadShell,
      ) =>
        Effect.gen(function* () {
          yield* Deferred.await(domainSubscribed);
          const consumed = yield* Deferred.make<void>();
          yield* PubSub.publish(publishedEvents, {
            event: {
              id: EventId.make(`cleanup:${type}:${thread.id}`),
              threadId: thread.id,
              occurredAt: at(0),
              type,
              payload: { ...thread, lastVisitedAt: thread.lastVisitedAt ?? null },
            },
            consumed,
          });
          yield* Deferred.await(consumed);
          yield* service.drain;
        }),
      noteTerminal: (event: Parameters<NonNullable<typeof terminalListener>>[0]) =>
        terminalListener!(event),
      keepProviderSession: () => {
        openSessionCwd = worktree;
      },
      editBeforeRemoval: () => {
        editBeforeRemoval = true;
      },
      fs,
      worktree,
      config,
      command,
      enableFiles: () => {
        settings = {
          ...settings,
          storageCleanup: {
            ...settings.storageCleanup,
            browserArtifactsAfterDays: 8,
            logsAfterDays: 8,
          },
        };
      },
      settle: (shared = false) => {
        settings = {
          ...settings,
          storageCleanup: {
            ...settings.storageCleanup,
            worktreeAfterDays: null,
            worktreeOnSettle: true,
          },
        };
        threads = [
          shell({
            branch: "feature",
            worktreePath: worktree,
            settledOverride: "settled",
            settledAt: at(0),
          }),
        ];
        if (shared) threads.push({ ...threads[0]!, id: ThreadId.make("thread-2") });
      },
      publish: () =>
        Effect.gen(function* () {
          const remote = yield* fs.makeTempDirectoryScoped();
          yield* command(remote, ["init", "--bare"]);
          yield* command(repo, ["remote", "add", "origin", remote]);
          yield* command(worktree, ["push", "-u", "origin", "feature"]);
          return remote;
        }),
      setSettings: (next: Partial<typeof settings>) => {
        settings = { ...settings, ...next };
      },
      setPolicy: (worktreeKeepWhen: WorktreeKeepWhen) => {
        settings = {
          ...settings,
          storageCleanup: { ...settings.storageCleanup, worktreeKeepWhen },
        };
      },
      disable: () => {
        settings = {
          ...settings,
          storageCleanup: {
            ...settings.storageCleanup,
            worktreeAfterDays: null,
            worktreeOnDelete: false,
          },
        };
      },
      setThreads: (next: typeof threads) => {
        threads = next;
      },
      setProjectRoot: (workspaceRoot: string) => {
        projectRoots = [{ ...projectRoots[0]!, workspaceRoot }];
      },
      setScratchRetention: (scratchAfterDays: number | null) => {
        settings = {
          ...settings,
          storageCleanup: { ...settings.storageCleanup, scratchAfterDays },
        };
      },
      setPendingEffects: (pending: boolean) => {
        pendingEffects = pending;
      },
      setSessionLive: (live: boolean) => {
        sessionLive = live;
      },
      setOpenSessionCwd: (cwd: string | null) => {
        openSessionCwd = cwd;
      },
      setProcessCwd: (cwd: string) => {
        processCwd = cwd;
      },
      failProcessInspection: () => {
        processInspectionFails = true;
      },
      setProjectPolicy: (projectAfterDays: number | null, projectOnSettle = false) => {
        settings = {
          ...settings,
          storageCleanup: {
            ...settings.storageCleanup,
            worktreeAfterDays: null,
            projectAfterDays,
            projectOnSettle,
          },
        };
      },
      onPublicationFetch: (change: Effect.Effect<void, PlatformError.PlatformError>) => {
        onPublicationFetch = change;
      },
      fullStatusCalls: () => fullStatusCalls,
      snapshotReads: () => snapshotReads,
      /** Starts the hourly sweep and the subscription to `domainEvents`, which wait until now. */
      activate: (domainEvents: Stream.Stream<OrchestrationV2DomainEvent>) => {
        events = domainEvents;
        return Deferred.succeed(activated, undefined);
      },
    };
  });
/** The fixture, with the size walk of its worktree held until `resume` succeeds. */
const pausedMeasurementFixture = (storageCleanup?: StorageCleanupSettings) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const measuring = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    let measuredPath: string | undefined;
    const fixture = yield* cleanupFixture(storageCleanup).pipe(
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        readDirectory: (directory, options) =>
          Effect.gen(function* () {
            if (directory === measuredPath) {
              yield* Deferred.succeed(measuring, undefined);
              yield* Deferred.await(resume);
            }
            return yield* fs.readDirectory(directory, options);
          }),
      }),
    );
    measuredPath = yield* fs.realPath(fixture.worktree);
    return { ...fixture, measuring, resume };
  });
const sessionUpdated = (
  index: number,
  status: OrchestrationV2ProviderSession["status"],
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event-${index}`),
  type: "provider-session.updated",
  threadId: ThreadId.make("thread-1"),
  occurredAt: at(0),
  payload: {
    id: ProviderSessionId.make(`session-${index}`),
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    status,
    cwd: "/elsewhere",
    model: null,
    capabilities: CodexProviderCapabilitiesV2,
    createdAt: at(0),
    updatedAt: at(0),
    lastError: null,
  },
});
// fork: project-lifecycle. Project and Scratch passes read a fixed number of snapshots per
// sweep, so count sweeps against the reads of one more manual sweep.
const sweepsSoFar = (fixture: {
  readonly service: StorageCleanup.StorageCleanup["Service"];
  readonly snapshotReads: () => number;
}) =>
  Effect.gen(function* () {
    const reads = fixture.snapshotReads();
    yield* fixture.service.runNow;
    return reads / (fixture.snapshotReads() - reads);
  });
const cleanupTestLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "storage-cleanup-" })),
  Layer.provideMerge(NodeServices.layer),
);
const runCleanupTest = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner
    | ServerConfig.ServerConfig
    | GitVcsDriver.GitVcsDriver
    | Path.Path
    | Scope.Scope
  >,
) => effect.pipe(Effect.provide(cleanupTestLayer), Effect.scoped);

describe("storage cleanup reports and local file policies", () => {
  it.live(
    "waits for worktree settle-hook cleanup requests instead of reclaiming on thread.settled",
    () =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* cleanupFixture();
          yield* f.publish();
          f.disable();
          yield* f.activateEvents;
          f.settle();
          yield* f.publishThreadEvent(
            "thread.settled",
            shell({
              branch: "feature",
              worktreePath: f.worktree,
              settledOverride: "settled",
              settledAt: at(0),
            }),
          );
          expect(yield* f.fs.exists(f.worktree)).toBe(true);
          // ThreadSettlementService sends this request only after the settle hook completes.
          yield* f.service.requestSweep;
          yield* f.service.drain;
          expect(yield* f.fs.exists(f.worktree)).toBe(false);
        }),
      ),
  );
  it.live(
    "releases, restores and prepares the same checkout, including retry after failed setup",
    () =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* cleanupFixture();
          fixture.settle();
          yield* fixture.publish();
          expect((yield* fixture.service.runNow).counts.removed).toBe(1);
          let setupCalls = 0;
          let creationCalls = 0;
          const restorationLayer = Layer.mergeAll(
            WorktreeSetupTracker.layer,
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getCheckpointContext: () =>
                Effect.die("Existing branches do not need checkpoint recovery"),
            }),
            Layer.mock(ProjectService.ProjectService)({
              getById: () => Effect.succeed(Option.some({ workspaceRoot: fixture.repo } as never)),
            }),
            Layer.mock(GitWorkflow.GitWorkflowService)({
              hasCommit: () => Effect.succeed(true),
              pruneWorktrees: ({ cwd }) =>
                fixture.command(cwd, ["worktree", "prune"]).pipe(Effect.asVoid),
              createWorktree: ({ cwd, refName, path }) =>
                Effect.gen(function* () {
                  creationCalls++;
                  yield* fixture.command(cwd, ["worktree", "add", path!, refName]);
                  return {} as never;
                }),
            }),
            Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
              runForThread: () =>
                Effect.gen(function* () {
                  setupCalls++;
                  expect(yield* fixture.fs.readFileString(`${fixture.worktree}/tracked.txt`)).toBe(
                    "original\n",
                  );
                  return {
                    status: "started" as const,
                    scriptId: "setup",
                    scriptName: "Setup",
                    scriptCommand: "fixture setup",
                    terminalId: "setup-terminal",
                    cwd: fixture.worktree,
                    async: true,
                    completion: Effect.gen(function* () {
                      if (setupCalls > 1) {
                        yield* fixture.fs.makeDirectory(`${fixture.worktree}/node_modules`);
                        yield* fixture.fs.writeFileString(
                          `${fixture.worktree}/node_modules/ready`,
                          "prepared",
                        );
                      }
                      return { exitCode: setupCalls === 1 ? 1 : 0, durationMs: 1 };
                    }).pipe(Effect.orDie),
                  };
                }).pipe(Effect.orDie),
            }),
          );
          const restore = restoreWorktree({
            threadId: ThreadId.make("thread-1"),
            projectId: ProjectId.make("project-1"),
            worktreePath: fixture.worktree,
            branch: "feature",
          });
          yield* restore.pipe(Effect.provide(restorationLayer), Effect.flip);
          expect(yield* fixture.fs.exists(`${fixture.worktree}.t3-setup-pending`)).toBe(true);
          expect((yield* fixture.service.runNow).entries[0]?.reason).toBe(
            "Workspace preparation is pending",
          );
          // A fresh tracker models another host process. The marker, not memory,
          // makes the retry run setup on the checkout the failed attempt retained.
          yield* restore.pipe(Effect.provide(restorationLayer));
          expect(yield* fixture.fs.readFileString(`${fixture.worktree}/node_modules/ready`)).toBe(
            "prepared",
          );
          expect(yield* fixture.fs.exists(`${fixture.worktree}.t3-setup-pending`)).toBe(false);
          yield* restore.pipe(Effect.provide(restorationLayer));
          expect(setupCalls).toBe(2);
          expect(creationCalls).toBe(1);
        }),
      ),
  );
  it.live("releases a published shared worktree only after every holder settles", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.settle(true);
        yield* fixture.publish();
        fixture.setThreads([
          shell({ branch: "feature", worktreePath: fixture.worktree, settledOverride: "settled" }),
          shell({
            id: ThreadId.make("thread-2"),
            branch: "feature",
            worktreePath: fixture.worktree,
          }),
        ]);
        expect((yield* fixture.service.runNow).entries[0]?.reason).toBe("Shared by 2 threads");
        fixture.settle(true);
        const report = yield* fixture.service.runNow;
        expect(report.entries[0]).toMatchObject({
          outcome: "removed",
          reason: "All threads settled; branch is published",
        });
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(false);
        expect(
          (yield* fixture.command(fixture.repo, ["rev-parse", "feature"])).stdout.trim(),
        ).not.toBe("");
      }),
    ),
  );
  it.live("keeps a settled worktree with an open terminal until that terminal closes", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.settle();
        yield* fixture.publish();
        yield* fixture.noteTerminal({
          type: "upsert",
          terminal: {
            threadId: "thread-1",
            terminalId: "terminal-1",
            cwd: fixture.worktree,
            worktreePath: fixture.worktree,
            status: "running",
            pid: 123,
            exitCode: null,
            exitSignal: null,
            hasRunningSubprocess: true,
            label: "Development server",
            updatedAt: DateTime.formatIso(at(0)),
          },
        });
        expect((yield* fixture.service.runNow).entries[0]?.reason).toBe("Open terminal");
        yield* fixture.noteTerminal({
          type: "remove",
          threadId: "thread-1",
          terminalId: "terminal-1",
        });
        expect((yield* fixture.service.runNow).entries[0]?.outcome).toBe("removed");
      }),
    ),
  );
  it.live("keeps a settled worktree while its provider session is resident", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.settle();
        yield* fixture.publish();
        fixture.keepProviderSession();
        expect((yield* fixture.service.runNow).entries[0]?.reason).toBe(
          "Provider session is still open",
        );
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(true);
      }),
    ),
  );
  it.live("keeps a settled checkout when its upstream cannot be refreshed", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.settle();
        yield* fixture.publish();
        yield* fixture.command(fixture.repo, [
          "remote",
          "set-url",
          "origin",
          `${fixture.repo}/unavailable-remote`,
        ]);
        expect((yield* fixture.service.runNow).entries[0]?.outcome).toBe("failed");
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(true);
      }),
    ),
  );
  it.live("keeps settled local branches and unpublished commits", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.settle();
        expect((yield* fixture.service.runNow).entries[0]?.reason).toBe(
          "Branch has no published upstream",
        );
        yield* fixture.publish();
        yield* fixture.fs.writeFileString(`${fixture.worktree}/tracked.txt`, "unique work\n");
        yield* fixture.command(fixture.worktree, ["commit", "-am", "unpublished"]);
        expect((yield* fixture.service.runNow).entries[0]?.reason).toBe(
          "Branch has unpublished commits",
        );
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(true);
      }),
    ),
  );
  it.live("settlement protects ignored data even with a permissive local-file policy", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.settle();
        fixture.setPolicy("tracked-changes");
        yield* fixture.publish();
        yield* fixture.fs.writeFileString(`${fixture.worktree}/.env`, "private configuration\n");
        expect((yield* fixture.service.runNow).entries[0]?.reason).toBe("Has ignored files (.env)");
        expect(yield* fixture.fs.readFileString(`${fixture.worktree}/.env`)).toBe(
          "private configuration\n",
        );
      }),
    ),
  );
  it.live("retains a worktree when shared holders resume during measurement", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        let measuredPath: string | undefined;
        const fixture = yield* cleanupFixture().pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            readDirectory: (directory) =>
              Effect.gen(function* () {
                if (directory === measuredPath)
                  fixture.setThreads([
                    shell({
                      branch: "feature",
                      worktreePath: fixture.worktree,
                      settledOverride: "settled",
                    }),
                    shell({
                      id: ThreadId.make("thread-2"),
                      branch: "feature",
                      worktreePath: fixture.worktree,
                    }),
                  ]);
                return yield* fs.readDirectory(directory);
              }),
          }),
        );
        fixture.settle(true);
        yield* fixture.publish();
        measuredPath = yield* fs.realPath(fixture.worktree);
        expect((yield* fixture.service.runNow).entries[0]?.reason).toBe(
          "Thread activity or shared worktree changed since check",
        );
        expect(yield* fs.exists(fixture.worktree)).toBe(true);
      }),
    ),
  );
  it.live("measures nested regular files without following symlinks", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, fs, worktree, setPolicy } = yield* cleanupFixture();
        setPolicy("tracked-changes");
        const sizes = yield* Effect.forEach(yield* fs.readDirectory(worktree), (name) =>
          fs.stat(`${worktree}/${name}`).pipe(Effect.map((stat) => Number(stat.size))),
        );
        const outside = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFileString(`${outside}/external`, "must not count");
        yield* fs.makeDirectory(`${worktree}/node_modules/nested`, { recursive: true });
        yield* fs.writeFileString(`${worktree}/node_modules/nested/file`, "count me");
        yield* fs.symlink(outside, `${worktree}/node_modules/directory-link`);
        yield* fs.symlink(`${outside}/external`, `${worktree}/node_modules/file-link`);
        yield* fs.symlink(`${outside}/missing`, `${worktree}/node_modules/dangling-link`);
        const report = yield* service.runNow;
        const bytes = sizes.reduce((sum, size) => sum + size, 8);
        expect(report.entries[0]).toMatchObject({ outcome: "removed", bytes, files: null });
        expect(report.bytesFreed).toBe(bytes);
        expect(yield* fs.readFileString(`${outside}/external`)).toBe("must not count");
      }),
    ),
  );
  it.live("still removes a worktree when measuring its size fails", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { service, worktree } = yield* cleanupFixture().pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            readDirectory: (directory) => fs.readDirectory(`${directory}/missing-directory`),
          }),
        );
        const report = yield* service.runNow;
        expect(report.entries[0]).toMatchObject({ outcome: "removed", bytes: null, files: null });
        expect(report.bytesFreed).toBe(0);
        expect(yield* fs.exists(worktree)).toBe(false);
      }),
    ),
  );
  it.live.each([
    [
      "its thread starts",
      (worktree: string) => [
        shell({ branch: "feature", worktreePath: worktree, status: "running" }),
      ],
    ],
    [
      "another thread starts using it",
      (worktree: string) => [
        shell({ branch: "feature", worktreePath: worktree }),
        shell({ id: ThreadId.make("thread-2"), branch: "feature", worktreePath: worktree }),
      ],
    ],
  ] as const)("keeps a worktree when %s during size measurement", ([, threadsWhileMeasuring]) =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* pausedMeasurementFixture();
        const { fs, worktree } = fixture;
        fixture.setPolicy("tracked-changes");
        yield* fs.writeFileString(`${worktree}/notes.txt`, "untracked\n");
        const cleanup = yield* fixture.service.runNow.pipe(Effect.forkChild);
        yield* Deferred.await(fixture.measuring);
        fixture.setThreads(threadsWhileMeasuring(worktree));
        yield* Deferred.succeed(fixture.resume, undefined);
        const report = yield* Fiber.join(cleanup);
        expect(report.entries[0]).toMatchObject({
          outcome: "kept",
          reason: "Thread activity or shared worktree changed since check",
          bytes: null,
        });
        expect(report.bytesFreed).toBe(0);
        expect(yield* fs.exists(worktree)).toBe(true);
        expect(yield* fs.readFileString(`${worktree}/notes.txt`)).toBe("untracked\n");
      }),
    ),
  );
  it.live("reads the thread snapshot once per sweep, not per worktree", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, snapshotReads } = yield* cleanupFixture();
        expect((yield* service.runNow).entries[0]).toMatchObject({ outcome: "removed" });
        const withWorktree = snapshotReads();
        // fork: project-lifecycle. Compare with a sweep that has no worktree left to check.
        yield* service.runNow;
        expect(snapshotReads() - withWorktree).toBe(withWorktree);
      }),
    ),
  );
  it.live.each([
    ["running", "ready", 1],
    ["stopped", "error", 2],
  ] as const)(
    "session updates to %s or %s during a sweep make %i sweep(s) in total",
    ([first, second, sweeps]) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* pausedMeasurementFixture();
          const handled = yield* Deferred.make<void>();
          // 20 updates arrive while the first automatic sweep measures the worktree.
          yield* fixture.activate(
            Stream.fromEffect(Deferred.await(fixture.measuring)).pipe(
              Stream.flatMap(() => Stream.range(0, 19)),
              Stream.map((index) => sessionUpdated(index, index % 2 === 0 ? first : second)),
              Stream.concat(
                Stream.fromEffect(Deferred.succeed(handled, undefined)).pipe(Stream.drain),
              ),
            ),
          );
          yield* Deferred.await(handled);
          yield* Deferred.succeed(fixture.resume, undefined);
          yield* fixture.service.drain;
          expect(yield* sweepsSoFar(fixture)).toBe(sweeps);
        }),
      ),
  );
  it.live("does not measure a worktree kept for an open provider session", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const walked: Array<string> = [];
        const fixture = yield* cleanupFixture().pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            readDirectory: (directory, options) => {
              walked.push(directory);
              return fs.readDirectory(directory, options);
            },
          }),
        );
        const root = yield* fs.realPath(fixture.worktree);
        fixture.setOpenSessionCwd(fixture.worktree);
        const kept = yield* fixture.service.runNow;
        expect(kept.entries[0]).toMatchObject({
          outcome: "kept",
          reason: "Provider session is still open",
          bytes: null,
        });
        expect(walked.filter((directory) => directory.startsWith(root))).toEqual([]);
        // The stored session stays ready after its runtime was released.
        fixture.setSessionLive(false);
        const removed = yield* fixture.service.runNow;
        expect(removed.entries[0]).toMatchObject({ outcome: "removed" });
        expect(removed.entries[0]?.bytes).toBeGreaterThan(0);
        expect(walked).toContain(root);
      }),
    ),
  );
  it.live("compares the checked-out branch without a full status", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, fs, worktree, command, setThreads, fullStatusCalls } =
          yield* cleanupFixture();
        const changed = { outcome: "kept", reason: "Repository or branch changed" };
        yield* command(worktree, ["checkout", "--detach"]);
        expect((yield* service.runNow).entries[0]).toMatchObject(changed);
        // A branch that has no commit yet is still a different branch.
        yield* command(worktree, ["switch", "--orphan", "other"]);
        expect((yield* service.runNow).entries[0]).toMatchObject(changed);
        // Status output reserves a leading "(" for a detached HEAD.
        yield* command(worktree, ["switch", "-c", "(feature)", "feature"]);
        setThreads([shell({ branch: "(feature)", worktreePath: worktree })]);
        expect((yield* service.runNow).entries[0]).toMatchObject(changed);
        setThreads([shell({ branch: "feature", worktreePath: worktree })]);
        // Tags named after the branch or HEAD make Git's short names ambiguous.
        yield* command(worktree, ["tag", "feature", "feature"]);
        // Newer Git refuses to create a tag named HEAD, but still reads one.
        yield* command(worktree, ["update-ref", "refs/tags/HEAD", "refs/heads/feature"]);
        yield* command(worktree, ["switch", "feature"]);
        const index = (yield* command(worktree, ["rev-parse", "--git-path", "index"])).stdout;
        yield* fs.writeFileString(`${index.trim()}.lock`, "");
        const locked = (yield* service.runNow).entries[0];
        expect(locked).toMatchObject({ outcome: "failed" });
        expect(locked?.reason).toContain("Git index is locked");
        yield* fs.remove(`${index.trim()}.lock`);
        const gitFile = yield* fs.readFileString(`${worktree}/.git`);
        yield* fs.writeFileString(`${worktree}/.git`, "gitdir: /missing-git-directory\n");
        expect((yield* service.runNow).entries[0]).toMatchObject(changed);
        yield* fs.writeFileString(`${worktree}/.git`, gitFile);
        expect((yield* service.runNow).entries[0]).toMatchObject({ outcome: "removed" });
        expect(fullStatusCalls()).toBe(0);
      }),
    ),
  );
  it("decodes reports from servers without size fields", () => {
    const report = decodeCleanupReport({
      trigger: "manual",
      startedAt: "2026-06-10T12:00:00.000Z",
      finishedAt: "2026-06-10T12:00:01.000Z",
      entries: [
        {
          kind: "worktree",
          outcome: "removed",
          reason: "Removed",
          path: null,
          threadId: null,
          threadTitle: null,
        },
      ],
      counts: { removed: 1, kept: 0, failed: 0 },
      omittedCount: 0,
    });
    expect(report.bytesFreed).toBe(0);
    expect(report.entries[0]).toMatchObject({ bytes: null, files: null });
  });
  it.live.each([
    ["any-local-files", ".env", "kept"],
    ["uncommitted-changes", ".env", "removed"],
    ["tracked-changes", ".env", "removed"],
    ["any-local-files", "notes.txt", "kept"],
    ["uncommitted-changes", "notes.txt", "kept"],
    ["tracked-changes", "notes.txt", "removed"],
    ["any-local-files", "tracked.txt", "kept"],
    ["uncommitted-changes", "tracked.txt", "kept"],
    ["tracked-changes", "tracked.txt", "kept"],
  ] as const)("applies %j", ([policy, file, outcome]) =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, fs, worktree, setPolicy } = yield* cleanupFixture();
        setPolicy(policy);
        expect(yield* service.latestReport).toBeNull();
        yield* fs.writeFileString(`${worktree}/${file}`, "local data\n");
        const sizes = yield* Effect.forEach(yield* fs.readDirectory(worktree), (name) =>
          fs.stat(`${worktree}/${name}`).pipe(Effect.map((stat) => Number(stat.size))),
        );
        const bytes = sizes.reduce((sum, size) => sum + size, 0);
        const report = yield* service.runNow;
        yield* service.drain;
        expect(report.trigger).toBe("manual");
        expect(report.entries.filter((entry) => entry.kind === "worktree")).toMatchObject([
          {
            outcome,
            path: worktree,
            threadId: "thread-1",
            threadTitle: "Thread",
            bytes: outcome === "removed" ? bytes : null,
            files: null,
          },
        ]);
        expect(report.bytesFreed).toBe(outcome === "removed" ? bytes : 0);
        expect(yield* fs.exists(worktree)).toBe(outcome === "kept");
        expect(yield* service.latestReport).toEqual(report);
        if (outcome === "kept")
          expect(report.entries[0]?.reason).toContain(
            file === ".env" ? "ignored files (.env)" : "uncommitted changes (1 file)",
          );
      }),
    ),
  );
  it.live("preserves tracked edits written after the final status check", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.setPolicy("tracked-changes");
        fixture.editBeforeRemoval();
        yield* fixture.fs.writeFileString(`${fixture.worktree}/notes.txt`, "untracked\n");
        const report = yield* fixture.service.runNow;
        expect(report.entries[0]).toMatchObject({ outcome: "failed", bytes: null, files: null });
        expect(report.bytesFreed).toBe(0);
        expect(report.entries[0]?.reason).toContain("contains modified or untracked files");
        expect(yield* fixture.fs.readFileString(`${fixture.worktree}/tracked.txt`)).toBe(
          "late edit\n",
        );
        expect(yield* fixture.fs.exists(`${fixture.worktree}/notes.txt`)).toBe(false);
      }),
    ),
  );
  it.live("streams the current report and subsequent runs", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service } = yield* cleanupFixture();
        const reports = yield* service.reports.pipe(
          Stream.take(2),
          Stream.tap((report) => (report === null ? service.runNow : Effect.void)),
          Stream.runCollect,
        );
        expect(reports[0]).toBeNull();
        expect(reports[1]).toEqual(yield* service.latestReport);
        expect(reports[1]?.counts).toEqual({ removed: 1, kept: 0, failed: 0 });
      }),
    ),
  );
  it.live("caps entries while preserving totals and prioritizing removals", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, fs, worktree, setThreads } = yield* cleanupFixture();
        const threads = [];
        for (let i = 0; i < 205; i++) {
          const worktreePath = `${worktree}-${i}`;
          yield* fs.makeDirectory(worktreePath);
          threads.push(
            shell({
              id: ThreadId.make(`thread-${i + 2}`),
              branch: "feature",
              worktreePath,
              status: "running",
            }),
          );
        }
        threads.push(shell({ branch: "feature", worktreePath: worktree }));
        setThreads(threads);
        const report = yield* service.runNow;
        expect(report.entries).toHaveLength(200);
        expect(report.omittedCount).toBe(6);
        expect(report.counts).toEqual({ removed: 1, kept: 205, failed: 0 });
        expect(report.entries[0]?.outcome).toBe("removed");
        expect(report.entries[0]?.bytes).toBeGreaterThan(0);
        expect(report.bytesFreed).toBe(report.entries[0]?.bytes);
      }),
    ),
  );
  it.live("keeps staged edits in tracked-only mode", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, fs, worktree, setPolicy, command } = yield* cleanupFixture();
        setPolicy("tracked-changes");
        yield* fs.writeFileString(`${worktree}/tracked.txt`, "staged\n");
        yield* command(worktree, ["add", "tracked.txt"]);
        expect((yield* service.runNow).entries[0]).toMatchObject({
          outcome: "kept",
          reason: "Has uncommitted changes (1 file)",
        });
        expect(yield* fs.exists(worktree)).toBe(true);
      }),
    ),
  );
  it.live(
    "reports shared and running worktrees but omits disabled rules and missing directories",
    () =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* cleanupFixture();
          const { service, fs, worktree, setThreads } = fixture;
          setThreads([shell({ branch: "feature", worktreePath: worktree, status: "running" })]);
          expect((yield* service.runNow).entries[0]?.reason).toContain("Thread is running");
          setThreads([
            shell({ branch: "feature", worktreePath: worktree }),
            shell({ id: ThreadId.make("thread-2"), branch: "feature", worktreePath: worktree }),
          ]);
          expect((yield* service.runNow).entries[0]?.reason).toBe("Shared by 2 threads");
          fixture.disable();
          expect((yield* service.runNow).entries).toEqual([]);
          yield* fs.remove(worktree, { recursive: true });
          expect(
            (yield* service.runNow).entries.filter((entry) => entry.kind === "worktree"),
          ).toEqual([]);
        }),
      ),
  );
  it.live("serializes concurrent requests and returns each run's report", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service } = yield* cleanupFixture();
        const reports = yield* Effect.all([service.runNow, service.runNow], {
          concurrency: "unbounded",
        });
        yield* service.drain;
        expect(
          reports.flatMap((report) => report.entries).filter((entry) => entry.kind === "worktree"),
        ).toMatchObject([{ outcome: "removed" }]);
        expect(yield* service.latestReport).toEqual(reports[1]);
      }),
    ),
  );
  it.live.each(["parent", "root"] as const)(
    "permits a symlinked %s only when it is a parent of the cleanup directory",
    (linked) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const config = yield* ServerConfig.ServerConfig;
          const temporary = yield* fs.makeTempDirectoryScoped();
          const root = yield* fs.realPath(temporary);
          const parent = `${root}/data`;
          const artifacts = `${parent}/browser-artifacts`;
          yield* fs.makeDirectory(artifacts, { recursive: true });
          const link = `${root}/linked`;
          yield* fs.symlink(linked === "parent" ? parent : artifacts, link);
          const browserArtifactsDir = linked === "parent" ? `${link}/browser-artifacts` : link;
          const fixture = yield* cleanupFixture().pipe(
            Effect.provideService(ServerConfig.ServerConfig, { ...config, browserArtifactsDir }),
          );
          fixture.disable();
          fixture.enableFiles();
          const file = `${artifacts}/old.png`;
          yield* fs.writeFileString(file, "capture");
          yield* fs.utimes(file, 1, 1);
          const report = yield* fixture.service.runNow;
          expect(report.entries.find((entry) => entry.kind === "browser-artifacts")?.outcome).toBe(
            linked === "parent" ? "removed" : "kept",
          );
          expect(yield* fs.exists(file)).toBe(linked === "root");
        }),
      ),
  );
  it.live("aggregates expired artifacts and rotated logs while retaining current logs", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, fs, config, enableFiles, disable } = yield* cleanupFixture();
        disable();
        enableFiles();
        yield* fs.makeDirectory(config.browserArtifactsDir, { recursive: true });
        yield* fs.makeDirectory(config.logsDir, { recursive: true });
        for (const name of ["one.png", "two.webm"]) {
          const file = config.browserArtifactsDir + "/" + name;
          yield* fs.writeFileString(file, "capture");
          yield* fs.utimes(file, 1, 1);
        }
        for (const name of ["server.log.1", "server.log.2", "server.log"]) {
          const file = config.logsDir + "/" + name;
          yield* fs.writeFileString(file, "log");
          yield* fs.utimes(file, 1, 1);
        }
        const report = yield* service.runNow;
        expect(report.entries.filter((entry) => entry.kind !== "worktree")).toMatchObject([
          {
            kind: "browser-artifacts",
            outcome: "removed",
            reason: "Removed 2 browser artifacts",
            bytes: 14,
            files: 2,
          },
          {
            kind: "logs",
            outcome: "removed",
            reason: "Removed 2 rotated logs",
            bytes: 6,
            files: 2,
          },
        ]);
        expect(report.bytesFreed).toBe(20);
        expect(yield* fs.readDirectory(config.browserArtifactsDir)).toEqual([]);
        expect(yield* fs.exists(config.logsDir + "/server.log")).toBe(true);
        expect(yield* fs.exists(config.logsDir + "/server.log.1")).toBe(false);
        expect(yield* fs.exists(config.logsDir + "/server.log.2")).toBe(false);
      }),
    ),
  );
  it.live("reports git failures without aborting the remaining categories", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, worktree, command, enableFiles } = yield* cleanupFixture();
        enableFiles();
        yield* command(worktree, ["worktree", "lock", worktree]);
        const report = yield* service.runNow;
        expect(report.entries[0]).toMatchObject({ outcome: "failed" });
        expect(report.entries[0]?.reason).toContain("git worktree remove: fatal:");
        expect(report.entries.map((entry) => entry.kind)).toEqual([
          "worktree",
          "browser-artifacts",
          "logs",
        ]);
      }),
    ),
  );
});

describe("native Scratch and pin retention", () => {
  it.live("keeps a pinned worktree and pending checkpoint effects", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* cleanupFixture();
        f.setThreads([shell({ branch: "feature", worktreePath: f.worktree, pinnedAt: at(0) })]);
        expect((yield* f.service.runNow).entries[0]?.reason).toBe("Thread is pinned");
        f.setThreads([shell({ branch: "feature", worktreePath: f.worktree })]);
        f.setPendingEffects(true);
        expect((yield* f.service.runNow).entries[0]?.reason).toBe(
          "Thread effects are still pending",
        );
        expect(yield* f.fs.exists(f.worktree)).toBe(true);
      }),
    ),
  );

  it.live("rechecks pins when a thread is pinned during measurement", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        let pinDuringWalk: (() => void) | undefined;
        let cwd: string | undefined;
        const f = yield* cleanupFixture().pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            readDirectory: (directory, options) => {
              if (directory === cwd) pinDuringWalk?.();
              return fs.readDirectory(directory, options);
            },
          }),
        );
        cwd = yield* fs.realPath(f.worktree);
        pinDuringWalk = () =>
          f.setThreads([shell({ branch: "feature", worktreePath: f.worktree, pinnedAt: at(0) })]);
        expect((yield* f.service.runNow).entries[0]?.reason).toBe("Thread is pinned");
        expect(yield* fs.exists(f.worktree)).toBe(true);
      }),
    ),
  );

  const scratchFixture = Effect.gen(function* () {
    const f = yield* cleanupFixture();
    const config = yield* ServerConfig.ServerConfig;
    const root = `${config.baseDir}/scratch`;
    const cwd = `${root}/owned-thread`;
    yield* f.fs.makeDirectory(cwd, { recursive: true });
    f.setProjectRoot(root);
    f.setThreads([shell({ worktreePath: cwd })]);
    f.setScratchRetention(8);
    return {
      ...f,
      root,
      cwd,
      input: {
        scratchRoot: root,
        worktreePath: cwd,
        projectId: ProjectId.make("project-1"),
        threadId: ThreadId.make("thread-1"),
      },
    };
  });

  it.live("archives and restores a clean local Scratch repository and checkpoint refs", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* scratchFixture;
        yield* f.command(f.cwd, ["init", "-b", "main"]);
        yield* f.fs.writeFileString(`${f.cwd}/proof`, "preserved");
        yield* f.command(f.cwd, ["add", "."]);
        yield* f.command(f.cwd, [
          "-c",
          "user.name=Scratch test",
          "-c",
          "user.email=scratch@example.test",
          "commit",
          "-m",
          "local work",
        ]);
        yield* f.command(f.cwd, [
          "update-ref",
          "refs/t3/orchestration-v2/checkpoints/test/ordinal/1",
          "HEAD",
        ]);
        const report = yield* f.service.runNow;
        expect(report.entries.find((entry) => entry.kind === "scratch")).toMatchObject({
          outcome: "removed",
        });
        expect(yield* f.fs.exists(f.cwd)).toBe(false);
        expect(yield* restoreScratchCheckout(f.input)).toBe(true);
        expect(yield* f.fs.readFileString(`${f.cwd}/proof`)).toBe("preserved");
        expect(
          (yield* f.command(f.cwd, [
            "rev-parse",
            "refs/t3/orchestration-v2/checkpoints/test/ordinal/1",
          ])).stdout,
        ).toBe((yield* f.command(f.cwd, ["rev-parse", "HEAD"])).stdout);
      }),
    ),
  );

  it.live("retains pinned, live, pending, non-Git and shared Scratch data", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* scratchFixture;
        const reasons = [
          [shell({ worktreePath: f.cwd, pinnedAt: at(0) }), "Thread is pinned"],
          [
            shell({ worktreePath: f.cwd, status: "running" }),
            "Thread is running or has pending work",
          ],
          [
            shell({ worktreePath: f.cwd, latestRunCompletedAt: yield* DateTime.now }),
            "Scratch retention has not elapsed",
          ],
        ] as const;
        for (const [thread, reason] of reasons) {
          f.setThreads([thread]);
          expect(
            (yield* f.service.runNow).entries.find((entry) => entry.kind === "scratch")?.reason,
          ).toBe(reason);
        }
        f.setThreads([shell({ worktreePath: f.cwd })]);
        f.setPendingEffects(true);
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "scratch")?.reason,
        ).toBe("Thread effects are still pending");
        f.setPendingEffects(false);
        yield* f.fs.writeFileString(`${f.cwd}/notes`, "user data");
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "scratch")?.reason,
        ).toBe("Non-Git Scratch data is retained");
        f.setThreads([
          shell({ worktreePath: f.cwd }),
          shell({ id: ThreadId.make("other"), worktreePath: f.cwd }),
        ]);
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "scratch")?.reason,
        ).toBe("Shared by 2 threads");
        expect(yield* f.fs.readFileString(`${f.cwd}/notes`)).toBe("user data");
      }),
    ),
  );
});

it.live(
  "Scratch cleanup protects uncommitted and ignored user data while releasing reproducible dependencies",
  () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* cleanupFixture();
        const config = yield* ServerConfig.ServerConfig;
        const root = `${config.baseDir}/scratch`;
        const cwd = `${root}/clean-repo`;
        yield* f.fs.makeDirectory(cwd, { recursive: true });
        f.setProjectRoot(root);
        f.setThreads([shell({ worktreePath: cwd })]);
        f.setScratchRetention(8);
        yield* f.command(cwd, ["init", "-b", "main"]);
        yield* f.fs.writeFileString(`${cwd}/.gitignore`, ".env\nnode_modules/\n");
        yield* f.fs.writeFileString(`${cwd}/proof`, "original");
        yield* f.command(cwd, ["add", "."]);
        yield* f.command(cwd, [
          "-c",
          "user.name=Scratch test",
          "-c",
          "user.email=scratch@example.test",
          "commit",
          "-m",
          "initial",
        ]);
        yield* f.fs.writeFileString(`${cwd}/proof`, "dirty");
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "scratch")?.reason,
        ).toContain("uncommitted changes");
        yield* f.command(cwd, ["checkout", "--", "proof"]);
        yield* f.fs.writeFileString(`${cwd}/.env`, "private data");
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "scratch")?.reason,
        ).toContain("ignored files");
        yield* f.fs.remove(`${cwd}/.env`);
        yield* f.fs.makeDirectory(`${cwd}/node_modules`);
        yield* f.fs.writeFileString(`${cwd}/node_modules/reproducible`, "dependency");
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "scratch")?.outcome,
        ).toBe("removed");
      }),
    ),
);

it.live("retains a managed worktree containing a same-device bind mount", () =>
  runCleanupTest(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      let mounted = "/unused";
      const f = yield* cleanupFixture().pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFileString: (file, encoding) =>
            file === "/proc/self/mountinfo"
              ? Effect.succeed(`24 1 0:1 / ${mounted} rw - ext4 /dev/test rw\n`)
              : fs.readFileString(file, encoding),
        }),
        Effect.provideService(HostProcess.Platform, "linux"),
      );
      mounted = `${yield* fs.realPath(f.worktree)}/node_modules`;
      yield* fs.makeDirectory(`${f.worktree}/node_modules`);
      yield* fs.writeFileString(`${f.worktree}/node_modules/foreign-data`, "protected");
      f.setPolicy("tracked-changes");
      const result = yield* f.service.runNow;
      expect(result.entries[0]).toMatchObject({ outcome: "failed" });
      expect(result.entries[0]?.reason).toContain("mounted filesystem");
      expect(yield* fs.readFileString(`${f.worktree}/node_modules/foreign-data`)).toBe("protected");
    }),
  ),
);

describe("settled worktree retention", () => {
  it.effect.each([
    "immediate",
    "settle-script",
    "expired",
    "boundary",
    "wait",
    "recent-update",
    "active",
    "dirty",
    "project-off",
    "project-custom",
    "inactive-settling",
  ] as const)("applies retention and safety checks (%s)", (scenario) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW_MS);
      const fixture = yield* cleanupFixture();
      const days = ["wait", "boundary", "expired", "recent-update"].includes(scenario) ? 8 : 0;
      const rules = {
        ...DEFAULT_SERVER_SETTINGS.storageCleanup,
        worktreeSettledAfterDays:
          scenario === "project-custom" || scenario === "inactive-settling" ? null : days,
        // Another rule must not bypass the settle-script grace either.
        worktreeAfterDays: scenario === "inactive-settling" ? 1 : null,
      };
      fixture.setSettings({
        storageCleanup: rules,
        projectSettingsOverrides: {
          [ProjectId.make("project-1")]:
            scenario === "project-off"
              ? { worktreeCleanup: { mode: "off" } }
              : scenario === "project-custom"
                ? {
                    worktreeCleanup: {
                      mode: "custom",
                      rules: { ...rules, worktreeSettledAfterDays: 0 },
                    },
                  }
                : {},
        },
      });
      const thread = shell({
        branch: "feature",
        worktreePath: fixture.worktree,
        settledAt:
          scenario === "active"
            ? null
            : at(
                scenario === "expired" ||
                  scenario === "recent-update" ||
                  scenario === "inactive-settling"
                  ? -20 * DAY_MS
                  : scenario === "boundary"
                    ? -8 * DAY_MS
                    : scenario === "wait"
                      ? -8 * DAY_MS + 1
                      : scenario === "settle-script"
                        ? 0
                        : -60_000,
              ),
        updatedAt: at(
          scenario === "recent-update" ||
            scenario === "settle-script" ||
            scenario === "inactive-settling"
            ? 0
            : -10 * DAY_MS,
        ),
      });
      fixture.setThreads([thread]);
      if (scenario === "dirty")
        yield* fixture.fs.writeFileString(`${fixture.worktree}/tracked.txt`, "edit\n");
      const report = yield* fixture.service.runNow;
      const removed = ["immediate", "expired", "boundary", "project-custom"].includes(scenario);
      expect(yield* fixture.fs.exists(fixture.worktree)).toBe(!removed);
      expect(report.counts.removed).toBe(removed ? 1 : 0);
      if (scenario !== "project-off") {
        const reason =
          scenario === "active"
            ? "Not settled"
            : scenario === "wait"
              ? "Settled for 7 of 8 days"
              : ["settle-script", "recent-update", "inactive-settling"].includes(scenario)
                ? "Settled moments ago"
                : scenario === "dirty"
                  ? "Has uncommitted changes (1 file)"
                  : `Settled for ${scenario === "expired" ? 20 : scenario === "boundary" ? 8 : 0} days`;
        expect(report.entries[0]).toMatchObject({ outcome: removed ? "removed" : "kept", reason });
      }
      expect(thread.branch).toBe("feature");
      expect(
        (yield* fixture.command(fixture.repo, ["rev-parse", "--verify", "refs/heads/feature"]))
          .exitCode,
      ).toBe(0);
    }).pipe(Effect.provide(cleanupTestLayer), Effect.scoped),
  );
});

describe("settled worktree rechecks", () => {
  it.live.each([{ settledAt: null }, { settledAt: at(DAY_MS) }])(
    "keeps a checkout changed during measurement (%j)",
    (change) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* pausedMeasurementFixture();
          const thread = shell({
            branch: "feature",
            worktreePath: fixture.worktree,
            settledAt: at(0),
          });
          fixture.setSettings({
            storageCleanup: {
              ...DEFAULT_SERVER_SETTINGS.storageCleanup,
              worktreeSettledAfterDays: 0,
            },
          });
          fixture.setThreads([thread]);
          const run = yield* fixture.service.runNow.pipe(Effect.forkChild);
          yield* Deferred.await(fixture.measuring);
          fixture.setThreads([{ ...thread, ...change }]);
          yield* Deferred.succeed(fixture.resume, undefined);
          const report = yield* Fiber.join(run);
          expect(report.entries[0]?.reason).toBe(
            "Thread activity or shared worktree changed since check",
          );
          expect(yield* fixture.fs.exists(fixture.worktree)).toBe(true);
        }),
      ),
  );
});

it.live("keeps saved usage data when removing a settled checkout", () =>
  runCleanupTest(
    Effect.gen(function* () {
      const fixture = yield* cleanupFixture();
      fixture.setSettings({
        storageCleanup: { ...DEFAULT_SERVER_SETTINGS.storageCleanup, worktreeSettledAfterDays: 0 },
      });
      fixture.setThreads([
        shell({ branch: "feature", worktreePath: fixture.worktree, settledAt: at(0) }),
      ]);
      yield* fixture.fs.makeDirectory(fixture.config.stateDir, { recursive: true });
      const cachePath = `${fixture.config.stateDir}/${SCAN_CACHE_FILE_NAME}`;
      const savedUsage = JSON.stringify({ tokens: 12345, cost: 1.25 });
      yield* fixture.fs.writeFileString(cachePath, savedUsage);
      expect((yield* fixture.service.runNow).counts.removed).toBe(1);
      expect(yield* fixture.fs.readFileString(cachePath)).toBe(savedUsage);
    }),
  ),
);

// fork: project-lifecycle
const primaryFixture = Effect.gen(function* () {
  // This fixture mocks lsof, so explicitly use its matching host path on every runner.
  // Dedicated Linux filesystem guards keep their separate Linux fixture override.
  const f = yield* cleanupFixture().pipe(Effect.provideService(HostProcess.Platform, "darwin"));
  const remote = yield* f.publish();
  yield* f.command(f.repo, ["worktree", "remove", f.worktree]);
  yield* f.command(f.repo, ["push", "-u", "origin", "main"]);
  const cwd = yield* f.fs.realPath(f.repo);
  f.setProjectRoot(cwd);
  f.setThreads([shell()]);
  f.setProjectPolicy(8);
  const mark = markManagedProjectCheckout(
    cwd,
    buildRepositoryIdentity({
      rootPath: cwd,
      remoteName: "origin",
      remoteUrl: remote,
      originUrl: remote,
    }),
  );
  return { ...f, cwd, mark };
});
describe("primary project storage cleanup", () => {
  it.live.each(["busy", "unverifiable"] as const)(
    "keeps a managed primary checkout when process inspection is %s",
    (inspection) =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* primaryFixture;
          yield* f.mark;
          if (inspection === "busy") f.setProcessCwd(f.cwd);
          else f.failProcessInspection();
          const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
          expect(entry?.outcome).toBe("kept");
          expect(entry?.reason).toBe(
            inspection === "busy"
              ? "A process is using the project folder"
              : "Process working directories could not be verified",
          );
          expect(yield* f.fs.exists(f.cwd)).toBe(true);
        }),
      ),
  );
  it.live(
    "automatically releases after the final conversation emits thread.settled with global policy off",
    () =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* primaryFixture;
          yield* f.mark;
          f.setProjectPolicy(null);
          yield* setManagedProjectRetention(
            f.cwd,
            "release-on-settle",
            ProjectId.make("project-1"),
          );
          const conversations = [
            shell(),
            shell({ id: ThreadId.make("thread-2") }),
            shell({ id: ThreadId.make("thread-3") }),
          ];
          f.setThreads(conversations);
          yield* f.activateEvents;
          expect(yield* f.fs.exists(f.cwd)).toBe(true);
          for (const index of [0, 1, 2]) {
            const settled = shell({
              ...conversations[index]!,
              settledOverride: "settled",
              settledAt: at(0),
            });
            conversations[index] = settled;
            f.setThreads([...conversations]);
            yield* f.publishThreadEvent("thread.settled", settled);
            expect(yield* f.fs.exists(f.cwd)).toBe(index !== 2);
          }
          const report = yield* f.service.latestReport;
          expect(report?.trigger).toBe("automatic");
          expect(report?.entries.find((entry) => entry.kind === "project")?.outcome).toBe(
            "removed",
          );
        }),
      ),
  );
  it.live.each(["release-on-settle", "inherit"] as const)(
    "automatically rechecks %s cleanup when a protected conversation is unpinned",
    (retention) =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* primaryFixture;
          yield* f.mark;
          f.setProjectPolicy(retention === "inherit" ? 8 : null);
          yield* setManagedProjectRetention(f.cwd, retention, ProjectId.make("project-1"));
          f.setThreads([shell({ settledOverride: "settled", settledAt: at(0), pinnedAt: at(0) })]);
          yield* f.activateEvents;
          expect(yield* f.fs.exists(f.cwd)).toBe(true);
          const unpinned = shell({ settledOverride: "settled", settledAt: at(0), pinnedAt: null });
          f.setThreads([unpinned]);
          yield* f.publishThreadEvent("thread.unpinned", unpinned);
          expect(yield* f.fs.exists(f.cwd)).toBe(false);
          expect((yield* f.service.latestReport)?.trigger).toBe("automatic");
        }),
      ),
  );
  it.live(
    "project-specific settlement releases with environment cleanup off and survives restoration",
    () =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* primaryFixture;
          yield* f.mark;
          f.setProjectPolicy(null);
          f.setThreads([shell({ settledOverride: "settled" })]);
          yield* setManagedProjectRetention(
            f.cwd,
            "release-on-settle",
            ProjectId.make("project-1"),
          );
          const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
          expect(entry?.outcome, entry?.reason).toBe("removed");
          expect(yield* f.fs.exists(f.cwd)).toBe(false);
          expect(yield* restoreManagedProjectCheckout(f.cwd)).toBe(true);
          expect((yield* readManagedProjectCheckout(f.cwd))?.retention).toBe("release-on-settle");
          expect(yield* f.fs.readFileString(`${f.cwd}/tracked.txt`)).toBe("original\n");
        }),
      ),
  );
  it.live(
    "explicit settlement policy releases after terminal close, including after restoration",
    () =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* primaryFixture;
          yield* f.mark;
          f.setProjectPolicy(null);
          f.setThreads([shell({ settledOverride: "settled" })]);
          yield* setManagedProjectRetention(
            f.cwd,
            "release-on-settle",
            ProjectId.make("project-1"),
          );
          const openTerminal = () =>
            f.noteTerminal({
              type: "upsert",
              terminal: {
                threadId: "thread-1",
                terminalId: "primary-terminal",
                cwd: f.cwd,
                worktreePath: null,
                status: "running",
                pid: 123,
                exitCode: null,
                exitSignal: null,
                hasRunningSubprocess: true,
                label: "Development server",
                updatedAt: DateTime.formatIso(at(0)),
              },
            });
          const closeTerminal = () =>
            f.noteTerminal({
              type: "remove",
              threadId: "thread-1",
              terminalId: "primary-terminal",
            });
          yield* openTerminal();
          expect(
            (yield* f.service.runNow).entries.find((entry) => entry.kind === "project")?.reason,
          ).toBe("Open terminal");
          yield* closeTerminal();
          yield* f.service.drain;
          expect(yield* f.fs.exists(f.cwd)).toBe(false);
          // A sweep while absent must retain the policy used by terminal-close events.
          yield* f.service.runNow;
          expect(yield* restoreManagedProjectCheckout(f.cwd)).toBe(true);
          yield* openTerminal();
          yield* closeTerminal();
          yield* f.service.drain;
          const afterRestore = yield* f.service.latestReport;
          expect(afterRestore?.entries.find((entry) => entry.kind === "project")?.reason).toBe(
            "Workspace preparation is pending",
          );
          expect(yield* f.fs.exists(f.cwd)).toBe(true);
          // Restoration retains this marker until setup completes successfully.
          expect(yield* f.fs.exists(`${f.cwd}.t3-setup-pending`)).toBe(true);
          yield* f.fs.remove(`${f.cwd}.t3-setup-pending`);
          yield* openTerminal();
          yield* closeTerminal();
          yield* f.service.drain;
          const afterSetup = yield* f.service.latestReport;
          expect(
            yield* f.fs.exists(f.cwd),
            afterSetup?.entries.find((entry) => entry.kind === "project")?.reason,
          ).toBe(false);
        }),
      ),
  );
  it.live.each(["age", "settlement"] as const)(
    "project-specific keep overrides environment %s cleanup",
    (policy) =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* primaryFixture;
          yield* f.mark;
          f.setProjectPolicy(policy === "age" ? 8 : null, policy === "settlement");
          f.setThreads([shell({ settledOverride: "settled" })]);
          yield* setManagedProjectRetention(f.cwd, "keep", ProjectId.make("project-1"));
          const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
          expect(entry?.outcome, entry?.reason).toBe("kept");
          expect(entry?.reason).toMatch(/kept on this computer/i);
          expect(yield* f.fs.exists(f.cwd)).toBe(true);
        }),
      ),
  );
  it.live("project-specific inherit preserves disabled environment cleanup", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* primaryFixture;
        yield* f.mark;
        f.setProjectPolicy(null);
        f.setThreads([shell({ settledOverride: "settled" })]);
        expect(
          (yield* f.service.runNow).entries.some(
            (entry) => entry.kind === "project" && entry.outcome === "removed",
          ),
        ).toBe(false);
        expect(yield* f.fs.exists(f.cwd)).toBe(true);
      }),
    ),
  );
  it.live("project-specific cleanup rejects a receipt bound to another project", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* primaryFixture;
        yield* f.mark;
        yield* setManagedProjectRetention(
          f.cwd,
          "release-on-settle",
          ProjectId.make("another-project"),
        );
        f.setThreads([shell({ settledOverride: "settled" })]);
        const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
        expect(entry?.outcome, entry?.reason).toBe("kept");
        expect(entry?.reason).toMatch(/another project/i);
        expect(yield* f.fs.exists(f.cwd)).toBe(true);
      }),
    ),
  );
  it.live(
    "project-specific cleanup rechecks a keep policy written during publication verification",
    () =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* primaryFixture;
          yield* f.mark;
          f.setProjectPolicy(null);
          f.setThreads([shell({ settledOverride: "settled" })]);
          yield* setManagedProjectRetention(
            f.cwd,
            "release-on-settle",
            ProjectId.make("project-1"),
          );
          f.onPublicationFetch(
            Effect.gen(function* () {
              const receiptPath = `${f.cwd}.t3-project-owned.json`;
              const receipt = JSON.parse(yield* f.fs.readFileString(receiptPath));
              yield* f.fs.writeFileString(
                receiptPath,
                JSON.stringify({ ...receipt, retention: "keep" }),
              );
            }),
          );
          const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
          expect(entry?.outcome, entry?.reason).toBe("kept");
          expect(entry?.reason).toMatch(/policy changed/i);
          expect(yield* f.fs.exists(f.cwd)).toBe(true);
        }),
      ),
  );
  it.live("keeps unowned project roots, then releases and restores a published managed clone", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* primaryFixture;
        expect((yield* f.service.runNow).entries.some((entry) => entry.kind === "project")).toBe(
          false,
        );
        expect(yield* f.fs.exists(f.cwd)).toBe(true);
        yield* f.mark;
        const report = yield* f.service.runNow;
        const entry = report.entries.find((entry) => entry.kind === "project");
        expect(entry?.outcome, entry?.reason).toBe("removed");
        expect(yield* f.fs.exists(f.cwd)).toBe(false);
        expect(yield* restoreManagedProjectCheckout(f.cwd)).toBe(true);
        expect(yield* f.fs.readFileString(`${f.cwd}/tracked.txt`)).toBe("original\n");
      }),
    ),
  );
  it.live.each([
    "pinned",
    "running",
    "pending-effect",
    "provider",
    "untracked",
    "ignored",
    "unpublished",
    "linked-worktree",
    "submodule",
    "stale-publication",
  ] as const)("keeps a managed primary checkout with %s protection", (protection) =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* primaryFixture;
        yield* f.mark;
        switch (protection) {
          case "pinned":
            f.setThreads([shell({ pinnedAt: at(-1) })]);
            break;
          case "running":
            f.setThreads([shell({ status: "running" })]);
            break;
          case "pending-effect":
            f.setPendingEffects(true);
            break;
          case "provider":
            f.setOpenSessionCwd(f.cwd);
            break;
          case "untracked":
            yield* f.fs.writeFileString(`${f.cwd}/notes.txt`, "keep");
            break;
          case "ignored":
            yield* f.fs.writeFileString(`${f.cwd}/.env`, "private fixture");
            break;
          case "unpublished":
            yield* f.command(f.repo, ["commit", "--allow-empty", "-m", "local only"]);
            break;
          case "linked-worktree":
            yield* f.command(f.repo, ["worktree", "add", "-b", "linked", f.worktree]);
            break;
          case "submodule": {
            const head = (yield* f.command(f.repo, ["rev-parse", "HEAD"])).stdout.trim();
            yield* f.command(f.repo, [
              "update-index",
              "--add",
              "--cacheinfo",
              `160000,${head},nested`,
            ]);
            yield* f.command(f.repo, ["commit", "-m", "submodule"]);
            yield* f.command(f.repo, ["push", "origin", "main"]);
            break;
          }
          case "stale-publication": {
            yield* f.command(f.repo, ["commit", "--allow-empty", "-m", "local only"]);
            const head = (yield* f.command(f.repo, ["rev-parse", "HEAD"])).stdout.trim();
            yield* f.command(f.repo, ["update-ref", "refs/t3/publication/9/heads/old", head]);
            break;
          }
        }
        const report = yield* f.service.runNow;
        const entry = report.entries.find((entry) => entry.kind === "project");
        expect(entry?.outcome, entry?.reason).toBe("kept");
        expect(yield* f.fs.exists(f.cwd)).toBe(true);
      }),
    ),
  );
  it.live("releases a published revision when its remote branch has advanced", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* primaryFixture;
        yield* f.mark;
        yield* f.command(f.repo, ["branch", "-D", "feature"]);
        yield* f.command(f.repo, ["push", "origin", "--delete", "feature"]);
        yield* f.command(f.repo, ["commit", "--allow-empty", "-m", "remote advanced"]);
        yield* f.command(f.repo, ["push", "origin", "main"]);
        yield* f.command(f.repo, ["reset", "--hard", "HEAD~1"]);
        const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
        expect(entry?.outcome, entry?.reason).toBe("removed");
      }),
    ),
  );
  it.live("requires every conversation to settle when retention is disabled", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* primaryFixture;
        yield* f.mark;
        f.setProjectPolicy(null, true);
        f.setThreads([
          shell({ settledOverride: "settled" }),
          shell({ id: ThreadId.make("active-thread") }),
        ]);
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "project")?.outcome,
        ).toBe("kept");
        f.setThreads([shell({ settledOverride: "settled" })]);
        const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
        expect(entry?.outcome, entry?.reason).toBe("removed");
      }),
    ),
  );
});

it.live.each(["thread.settled", "stopped", "ready"] as const)(
  "leaves settled cleanup to the regular sweeps after %s",
  (trigger) =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* pausedMeasurementFixture({
          ...DEFAULT_SERVER_SETTINGS.storageCleanup,
          worktreeSettledAfterDays: 0,
        });
        fixture.setSettings({
          storageCleanup: {
            ...DEFAULT_SERVER_SETTINGS.storageCleanup,
            worktreeSettledAfterDays: 0,
          },
        });
        const thread = shell({
          branch: "feature",
          worktreePath: fixture.worktree,
          settledAt: at(0),
        });
        fixture.setThreads([thread]);
        const handled = yield* Deferred.make<void>();
        yield* fixture.activate(
          Stream.fromEffect(Deferred.await(fixture.measuring)).pipe(
            Stream.flatMap(() => Stream.range(0, 19)),
            Stream.map((index): OrchestrationV2DomainEvent =>
              trigger === "thread.settled"
                ? {
                    id: EventId.make(`settled-${index}`),
                    type: "thread.settled",
                    threadId: thread.id,
                    occurredAt: at(0),
                    payload: { ...thread, lastVisitedAt: null },
                  }
                : sessionUpdated(index, trigger),
            ),
            Stream.concat(
              Stream.fromEffect(Deferred.succeed(handled, undefined)).pipe(Stream.drain),
            ),
          ),
        );
        yield* Deferred.await(handled);
        yield* Deferred.succeed(fixture.resume, undefined);
        yield* fixture.service.drain;
        // fork: project-lifecycle. A stopped session can release a checkout under any
        // enabled cleanup policy, so updates during a sweep queue one follow-up sweep.
        expect(yield* sweepsSoFar(fixture)).toBe(trigger === "stopped" ? 2 : 1);
      }),
    ),
);
