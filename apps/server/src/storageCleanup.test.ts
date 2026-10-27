// fork: mini-native-retention
import * as GitWorkflow from "./git/GitWorkflowService.ts";
import * as ProjectService from "./project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "./project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "./project/WorktreeSetupTracker.ts";
import { restoreWorktree } from "./workspace/restoreWorktree.ts";
import * as SetupMarker from "./workspace/setupMarker.ts";
import { restoreScratchCheckout } from "./workspace/ScratchCheckout.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError"; // fork: project-lifecycle
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"; // fork: project-lifecycle
import * as Stream from "effect/Stream";
import * as PubSub from "effect/PubSub"; // fork: project-lifecycle
import { SCAN_CACHE_FILE_NAME } from "./usage/usageScanCache.ts";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/sql/SqlClient";
import {
  DEFAULT_SERVER_SETTINGS,
  type WorktreeKeepWhen,
  type StorageCleanupSettings,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ServerConfig from "./config.ts";
import * as StorageCleanup from "./storageCleanup.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as GitManager from "./git/GitManager.ts";
import * as Settings from "./serverSettings.ts";
// fork: project-lifecycle
import * as ProcessRunner from "./processRunner.ts";
import {
  markManagedProjectCheckout,
  ownershipReceiptPath,
  restoreManagedProjectCheckout,
  readManagedProjectCheckout,
  setManagedProjectRetention,
} from "./workspace/ManagedProjectCheckout.ts";
import { buildRepositoryIdentity } from "./project/RepositoryIdentityResolver.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionManager from "./orchestration-v2/ProviderSessionManager.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as LibraryWorkspaceStore from "./fork/project-library/LibraryWorkspaceStore.ts";
import * as LibraryGitFetch from "./fork/project-library/LibraryGitFetch.ts"; // fork: library-launch-files
import { LibraryError } from "@t3tools/contracts/fork"; // fork: library-launch-files
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as TerminalManager from "./terminal/Manager.ts";
import { CodexProviderCapabilitiesV2 } from "./orchestration-v2/Adapters/CodexAdapterV2.ts";
import { ServerActivation } from "./serverActivation.ts";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId, // fork: project-lifecycle
  EventId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2DomainEvent,
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

const allocatedBytes = (fs: FileSystem.FileSystem, file: string) =>
  fs.stat(file).pipe(
    Effect.map((stat) =>
      Option.getOrElse(
        Option.map(stat.blocks, (blocks) => Number(blocks) * 512),
        () => Number(stat.size),
      ),
    ),
  );

const cleanupFixture = (
  storageCleanup: StorageCleanupSettings = {
    ...DEFAULT_SERVER_SETTINGS.storageCleanup,
    worktreeAfterDays: 8,
    worktreeOnDelete: true,
    // fork: retention-defaults: keep the artifact rule out of worktree reports.
    browserArtifactsAfterDays: null,
  },
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const git = yield* GitVcsDriver.GitVcsDriver;
    // fork: project-lifecycle
    const runner = yield* ProcessRunner.make();
    const repoParent = yield* fs.realPath(
      yield* fs.makeTempDirectoryScoped({ prefix: "cleanup-repo-" }),
    );
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
    let settings: import("@t3tools/contracts").ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      storageCleanup,
    };
    let threads = [shell({ branch: "feature", worktreePath: worktree })];
    let deletedThreads: OrchestrationV2ThreadShell[] = [];
    let storedWorktreePaths: string[] = [worktree];
    let projectRoots = [repo];
    // fork: project-lifecycle -- managed project and Scratch passes read full project shells.
    const projectShell = (workspaceRoot: string, index: number) => ({
      id: ProjectId.make(`project-${index + 1}`),
      title: "Project",
      workspaceRoot,
      createdAt: DateTime.formatIso(at(-30 * DAY_MS)),
    });
    let librarySql: SqlClient.SqlClient | undefined;
    let pendingEffects = false; // fork: project-lifecycle
    let editBeforeRemoval = false;
    let openSessionCwd: string | null = null;
    let sessionLive = true;
    let processCwd: string | null = null; // fork: project-lifecycle
    let processInspectionFails = false;
    let fullStatusCalls = 0;
    let snapshotReads = 0;
    // fork: project-lifecycle -- `events` below now reads published thread events
    let onPublicationFetch: Effect.Effect<void, PlatformError.PlatformError> | undefined;
    let terminalListener:
      | Parameters<TerminalManager.TerminalManager["Service"]["subscribeMetadata"]>[0]
      | undefined;
    const activated = yield* Deferred.make<void>();
    // fork: project-lifecycle
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
    const processHost: ProcessRunner.ProcessRunner["Service"] = {
      run: (input) =>
        input.command === "/usr/sbin/lsof"
          ? Effect.sync(() => ({
              stdout: processCwd === null ? "" : `p42\nn${processCwd}\n`,
              stderr: "",
              code: ChildProcessSpawner.ExitCode(processInspectionFails ? 1 : 0),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            }))
          : runner.run(input),
    };
    const context = yield* Layer.build(StorageCleanup.layer).pipe(
      Effect.provideService(GitVcsDriver.GitVcsDriver, {
        ...git,
        execute: (input) =>
          Effect.gen(function* () {
            // Before Git's own clean check: inside `git worktree remove`, or on
            // Windows the same status check the removal makes before deleting.
            if (
              editBeforeRemoval &&
              (input.args.includes("remove") || input.args.includes("--porcelain"))
            )
              yield* fs.writeFileString(`${worktree}/tracked.txt`, "late edit\n");
            // fork: project-lifecycle
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
      Effect.provideService(ProcessRunner.ProcessRunner, processHost), // fork: project-lifecycle
      Effect.provideService(Settings.ServerSettingsService, {
        getSettings: Effect.sync(() => settings),
        subscribeChanges: Effect.succeed(Stream.empty),
      } as unknown as Settings.ServerSettingsService["Service"]),
      Effect.provideService(ProjectStore.ProjectStoreV2, {
        list: () => Effect.sync(() => projectRoots.map((workspaceRoot) => ({ workspaceRoot }))),
        listShells: () => Effect.sync(() => projectRoots.map(projectShell)), // fork: project-lifecycle
      } as unknown as ProjectStore.ProjectStoreV2["Service"]),
      Effect.provideService(ProjectionStore.ProjectionStoreV2, {
        getShellSnapshot: (input?: { location?: string }) =>
          Effect.sync(() => {
            snapshotReads++;
            const visible = threads.filter((thread) => thread.deletedAt === null);
            return {
              threads:
                input?.location === "archive"
                  ? []
                  : visible.filter((thread) => thread.archivedAt === null),
              archivedThreads:
                input?.location === "active"
                  ? []
                  : visible.filter((thread) => thread.archivedAt !== null),
            };
          }),
        getThreadWorktreePaths: (input?: { includeArchived?: boolean }) =>
          Effect.sync(() =>
            threads.flatMap((thread) =>
              thread.deletedAt === null &&
              (input?.includeArchived === true || thread.archivedAt === null) &&
              thread.worktreePath !== null
                ? [{ threadId: thread.id, worktreePath: thread.worktreePath }]
                : [],
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
      Effect.provideService(SqlClient.SqlClient, ((
        strings: TemplateStringsArray,
        ...values: ReadonlyArray<string | number>
      ) =>
        librarySql !== undefined && /fork_library|orchestration_events/.test(strings.join(""))
          ? librarySql(strings, ...values)
          : Effect.sync(() =>
              // fork: project-lifecycle
              pendingEffects && strings.join("").includes("effect_outbox")
                ? [{ id: 1 }]
                : openSessionCwd !== null &&
                    strings.join("").includes("projection_provider_sessions")
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
                  : strings.join("").includes("deleted_at IS NOT NULL")
                    ? deletedThreads.map((thread) => ({
                        payload_json: JSON.stringify(thread),
                        workspaceRoot: repo,
                      }))
                    : strings.join("").includes('AS "worktreePath"')
                      ? [
                          ...threads.flatMap((thread) => thread.worktreePath ?? []),
                          ...storedWorktreePaths,
                        ].map((worktreePath) => ({ worktreePath }))
                      : [],
            )) as unknown as SqlClient.SqlClient),
      Effect.provideService(GitManager.GitManager, {
        invalidateStatus: () => Effect.void,
      } as unknown as GitManager.GitManager["Service"]),
      Effect.provideService(TerminalManager.TerminalManager, {
        // fork: project-lifecycle
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
    // fork: project-lifecycle
    const built = Context.get(context, StorageCleanup.StorageCleanup);
    // Sweeps inherit this fixture's process runner from the layer build, but manual removal runs
    // in its caller's context, as an RPC does, so it gets the same runner here.
    const service: StorageCleanup.StorageCleanup["Service"] = {
      ...built,
      removeOrphan: (target) =>
        built
          .removeOrphan(target)
          .pipe(Effect.provideService(ProcessRunner.ProcessRunner, processHost)),
    };
    return {
      service, // fork: project-lifecycle
      // fork: library-projects
      libraryStore: yield* LibraryWorkspaceStore.LibraryWorkspaceStore.pipe(
        Effect.provide(LibraryWorkspaceStore.layer),
      ),
      useLibraryHistory: (sql: SqlClient.SqlClient) => {
        librarySql = sql;
      },
      repo,
      // fork: project-lifecycle
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
      // fork: project-lifecycle
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
            worktreeOnLand: false, // fork: project-lifecycle
          },
        };
      },
      setThreads: (next: typeof threads) => {
        threads = next;
      },
      // fork: project-lifecycle
      setProjectRoot: (workspaceRoot: string) => {
        projectRoots = [workspaceRoot, ...projectRoots.slice(1)];
      },
      // fork: project-lifecycle
      setScratchRetention: (scratchAfterDays: number | null) => {
        settings = {
          ...settings,
          storageCleanup: { ...settings.storageCleanup, scratchAfterDays },
        };
      },
      // fork: project-lifecycle
      setPendingEffects: (pending: boolean) => {
        pendingEffects = pending;
      },
      setDeletedThreads: (next: OrchestrationV2ThreadShell[]) => {
        deletedThreads = next;
      },
      setStoredWorktreePaths: (paths: string[]) => {
        storedWorktreePaths = paths;
      },
      setProjectRoots: (roots: string[]) => {
        projectRoots = roots;
      },
      setSessionLive: (live: boolean) => {
        sessionLive = live;
      },
      setOpenSessionCwd: (cwd: string | null) => {
        openSessionCwd = cwd;
      },
      // fork: project-lifecycle
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
      activate: (domainEvents: Stream.Stream<OrchestrationV2DomainEvent>) => {
        events = domainEvents;
        return Deferred.succeed(activated, undefined);
      },
    };
  });
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
const cleanupTestLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "storage-cleanup-" })),
  Layer.provideMerge(NodeServices.layer),
);
const runCleanupTest = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner // fork: project-lifecycle
    | ServerConfig.ServerConfig
    | GitVcsDriver.GitVcsDriver
    | Path.Path
    | Scope.Scope
  >,
) => effect.pipe(Effect.provide(cleanupTestLayer), Effect.scoped);

const submoduleCleanupFixture = () =>
  Effect.gen(function* () {
    const fixture = yield* cleanupFixture();
    const { command, repo, worktree } = fixture;
    const submodule = `${worktree}/module`;
    const child = `${submodule}/child`;
    for (const [cwd, name] of [
      [worktree, "module"],
      [submodule, "child"],
    ] as const) {
      yield* command(cwd, ["-c", "protocol.file.allow=always", "submodule", "add", repo, name]);
      yield* command(`${cwd}/${name}`, ["config", "user.name", "Cleanup test"]);
      yield* command(`${cwd}/${name}`, ["config", "user.email", "cleanup@example.test"]);
    }
    const recordSubmodules = () =>
      Effect.gen(function* () {
        yield* command(submodule, ["commit", "-am", "record child"]);
        yield* command(submodule, ["push", "origin", "HEAD:submodule"]);
        yield* command(worktree, ["commit", "-am", "record module"]);
      });
    yield* recordSubmodules();
    return { ...fixture, submodule, child, recordSubmodules };
  });

it.live("removes clean submodules recursively, including deinitialized repositories", () =>
  runCleanupTest(
    Effect.gen(function* () {
      const { service, fs, repo, worktree, submodule, command, recordSubmodules } =
        yield* submoduleCleanupFixture();
      yield* command(submodule, [
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        repo,
        "stored",
      ]);
      yield* recordSubmodules();
      yield* command(submodule, ["submodule", "deinit", "stored"]);
      const admin = (yield* command(worktree, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
      const report = yield* service.runNow;
      expect(report.entries.find((entry) => entry.path === worktree)).toMatchObject({
        outcome: "removed",
      });
      expect(report.counts).toEqual({ removed: 1, kept: 0, failed: 0 });
      expect(yield* fs.exists(worktree)).toBe(false);
      expect(yield* fs.exists(admin)).toBe(false);
    }),
  ),
);

it.live("keeps nested submodule files protected by the current keep rule", () =>
  runCleanupTest(
    Effect.gen(function* () {
      const { service, fs, worktree, submodule, child, command, setPolicy } =
        yield* submoduleCleanupFixture();
      setPolicy("tracked-changes");
      yield* fs.writeFileString(`${child}/tracked.txt`, "local edit\n");
      expect(
        (yield* service.runNow).entries.find((entry) => entry.path === worktree),
      ).toMatchObject({ outcome: "kept" });
      expect(yield* fs.readFileString(`${child}/tracked.txt`)).toBe("local edit\n");
      yield* fs.writeFileString(`${child}/tracked.txt`, "original\n");
      setPolicy("any-local-files");
      yield* fs.writeFileString(`${child}/.env`, "local secret\n");
      expect(
        (yield* service.runNow).entries.find((entry) => entry.path === worktree),
      ).toMatchObject({ outcome: "kept" });
      expect(yield* fs.readFileString(`${child}/.env`)).toBe("local secret\n");

      yield* fs.remove(`${child}/.env`);
      yield* command(submodule, ["submodule", "deinit", "child"]);
      yield* fs.writeFileString(`${child}/.env`, "secret after deinit\n");
      const report = yield* service.runNow;
      expect({
        outcome: report.entries.find((entry) => entry.path === worktree)?.outcome,
        contents: (yield* fs.exists(`${child}/.env`))
          ? yield* fs.readFileString(`${child}/.env`)
          : null,
      }).toEqual({ outcome: "kept", contents: "secret after deinit\n" });

      yield* fs.remove(`${child}/.env`);
      setPolicy("uncommitted-changes");
      yield* fs.writeFileString(`${child}/notes.txt`, "notes after deinit\n");
      const untrackedReport = yield* service.runNow;
      expect({
        outcome: untrackedReport.entries.find((entry) => entry.path === worktree)?.outcome,
        contents: (yield* fs.exists(`${child}/notes.txt`))
          ? yield* fs.readFileString(`${child}/notes.txt`)
          : null,
      }).toEqual({ outcome: "kept", contents: "notes after deinit\n" });
    }),
  ),
);

it.live("keeps unpushed submodule history after checkout and deinitialization", () =>
  runCleanupTest(
    Effect.gen(function* () {
      const { service, fs, worktree, submodule, child, command, recordSubmodules } =
        yield* submoduleCleanupFixture();
      yield* command(child, ["checkout", "-b", "local-only"]);
      yield* fs.writeFileString(`${child}/tracked.txt`, "unpublished work\n");
      yield* command(child, ["commit", "-am", "local work"]);
      const local = (yield* command(child, ["rev-parse", "HEAD"])).stdout.trim();
      yield* recordSubmodules();
      expect(
        (yield* service.runNow).entries.find((entry) => entry.path === worktree),
      ).toMatchObject({ outcome: "kept", reason: expect.stringContaining("remote-tracking") });
      expect(yield* fs.readFileString(`${child}/tracked.txt`)).toBe("unpublished work\n");

      yield* command(child, ["checkout", "main"]);
      yield* recordSubmodules();
      expect(
        (yield* service.runNow).entries.find((entry) => entry.path === worktree),
      ).toMatchObject({ outcome: "kept", reason: expect.stringContaining("remote-tracking") });
      const childGit = (yield* command(child, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
      yield* command(submodule, ["submodule", "deinit", "child"]);
      expect(
        (yield* service.runNow).entries.find((entry) => entry.path === worktree),
      ).toMatchObject({ outcome: "kept", reason: expect.stringContaining("remote-tracking") });
      expect(
        (yield* command(worktree, [
          "--git-dir",
          childGit,
          "rev-parse",
          "refs/heads/local-only",
        ])).stdout.trim(),
      ).toBe(local);
      expect(
        (yield* command(worktree, ["--git-dir", childGit, "show", "local-only:tracked.txt"]))
          .stdout,
      ).toBe("unpublished work\n");
      yield* command(worktree, ["--git-dir", childGit, "branch", "-D", "local-only"]);
      expect(
        (yield* service.runNow).entries.find((entry) => entry.path === worktree),
      ).toMatchObject({ outcome: "kept", reason: expect.stringContaining("remote-tracking") });
      expect(
        (yield* command(worktree, ["--git-dir", childGit, "show", `${local}:tracked.txt`])).stdout,
      ).toBe("unpublished work\n");
    }),
  ),
);

it.live("keeps submodules when stored repository metadata is malformed", () =>
  runCleanupTest(
    Effect.gen(function* () {
      const { service, fs, worktree, submodule, child, command } = yield* submoduleCleanupFixture();
      const childGit = (yield* command(child, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
      yield* command(submodule, ["submodule", "deinit", "child"]);
      yield* fs.writeFileString(`${childGit}/HEAD`, "not a ref\n");
      expect(
        (yield* service.runNow).entries.find((entry) => entry.path === worktree),
      ).toMatchObject({ outcome: "kept", reason: expect.stringContaining("inspected") });
      expect(yield* fs.exists(worktree)).toBe(true);
      expect(yield* fs.readFileString(`${childGit}/HEAD`)).toBe("not a ref\n");
    }),
  ),
);

it.live("preserves late tracked edits when submodules were never initialized", () =>
  runCleanupTest(
    Effect.gen(function* () {
      const fixture = yield* cleanupFixture();
      const { service, fs, worktree, command } = fixture;
      const head = (yield* command(worktree, ["rev-parse", "HEAD"])).stdout.trim();
      yield* fs.writeFileString(
        `${worktree}/.gitmodules`,
        '[submodule "module"]\n\tpath = module\n\turl = /unused\n',
      );
      yield* command(worktree, ["add", ".gitmodules"]);
      yield* command(worktree, ["update-index", "--add", "--cacheinfo", `160000,${head},module`]);
      yield* command(worktree, ["commit", "-m", "record uninitialized module"]);
      yield* fs.makeDirectory(`${worktree}/module`);
      fixture.editBeforeRemoval();
      expect(
        (yield* service.runNow).entries.find((entry) => entry.path === worktree),
      ).toMatchObject({ outcome: "failed" });
      expect(yield* fs.readFileString(`${worktree}/tracked.txt`)).toBe("late edit\n");
    }),
  ),
);

describe("subagent worktree ownership", () => {
  it.effect.each([
    "idle",
    "grandchild",
    "null-branch",
    "stale-branch",
    "isolated-owner",
    "fork-owner",
    "missing-parent",
    "cycle",
    "two-tops",
    "wrong-root",
    "running",
    "pending",
    "unrelated",
    "fork",
    "recent-activity",
    "recent-inactive",
    "recent-grace",
    "recent-settle",
    "child-settled-now",
    "child-settled-only",
  ] as const)("checks the whole owner group (%s)", (scenario) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW_MS);
      const fixture = yield* cleanupFixture();
      fixture.setSettings({
        storageCleanup: {
          ...DEFAULT_SERVER_SETTINGS.storageCleanup,
          worktreeSettledAfterDays: scenario === "recent-inactive" ? null : 8,
          worktreeAfterDays: scenario === "recent-inactive" ? 8 : null,
        },
      });
      const root = shell({
        branch: "feature",
        worktreePath: fixture.worktree,
        settledAt: scenario === "child-settled-only" ? null : at(-20 * DAY_MS),
        ...(scenario === "isolated-owner" || scenario === "fork-owner"
          ? {
              lineage: {
                parentThreadId: ThreadId.make("ancestor"),
                rootThreadId: ThreadId.make("ancestor"),
                relationshipToParent:
                  scenario === "fork-owner" ? ("fork" as const) : ("subagent" as const),
              },
            }
          : {}),
      });
      const child = shell({
        id: ThreadId.make("child"),
        branch:
          scenario === "null-branch"
            ? null
            : scenario === "stale-branch"
              ? "t3/15a6e5ae"
              : "feature",
        worktreePath: fixture.worktree,
        lineage: {
          parentThreadId:
            scenario === "missing-parent"
              ? ThreadId.make("missing")
              : scenario === "cycle"
                ? ThreadId.make("child")
                : scenario === "two-tops"
                  ? null
                  : root.id,
          rootThreadId:
            scenario === "wrong-root" ? ThreadId.make("other-root") : root.lineage.rootThreadId,
          relationshipToParent:
            scenario === "fork" ? "fork" : scenario === "unrelated" ? null : "subagent",
        },
        status: scenario === "running" ? "running" : "completed",
        pendingBackgroundTasks: scenario === "pending" ? [{ taskId: "task", kind: "command" }] : [],
        latestRunCompletedAt:
          scenario === "recent-activity" || scenario === "recent-inactive"
            ? at(-2 * DAY_MS)
            : scenario === "recent-grace"
              ? at(-30_000)
              : null,
        settledAt: scenario === "child-settled-only" ? at(-20 * DAY_MS) : null,
      });
      const grandchild = {
        ...child,
        id: ThreadId.make("grandchild"),
        lineage: { ...child.lineage, parentThreadId: child.id },
      };
      fixture.setThreads(
        scenario === "grandchild"
          ? [grandchild, child, root]
          : scenario === "isolated-owner" || scenario === "fork-owner"
            ? [child, root, shell({ id: ThreadId.make("ancestor") })]
            : [child, root],
      );
      if (scenario === "recent-settle" || scenario === "child-settled-now")
        fixture.setThreads([
          {
            ...child,
            settledAt: scenario === "recent-settle" ? at(0) : at(-20 * DAY_MS),
            updatedAt: at(0),
          },
          root,
        ]);
      const report = yield* fixture.service.runNow;
      const removed = ["idle", "grandchild", "isolated-owner", "fork-owner"].includes(scenario);
      const shared = [
        "unrelated",
        "fork",
        "missing-parent",
        "cycle",
        "two-tops",
        "wrong-root",
      ].includes(scenario);
      expect(yield* fixture.fs.exists(fixture.worktree)).toBe(!removed);
      expect(report.entries[0]).toMatchObject({
        threadId: shared ? child.id : root.id,
        outcome: removed ? "removed" : "kept",
        reason: removed
          ? "Settled for 20 days"
          : scenario === "running" || scenario === "pending"
            ? "Thread is running or has pending work"
            : shared
              ? "Shared by 2 threads"
              : scenario === "null-branch" || scenario === "stale-branch"
                ? "A subagent thread's branch differs from this worktree's branch"
                : scenario === "recent-activity"
                  ? "Settled for 2 of 8 days"
                  : scenario === "recent-inactive"
                    ? "Inactive for 2 of 8 days"
                    : ["recent-grace", "recent-settle", "child-settled-now"].includes(scenario)
                      ? "Settled moments ago"
                      : "Not settled",
      });
    }).pipe(Effect.provide(cleanupTestLayer), Effect.scoped),
  );

  it.live.each([
    "running",
    "pending",
    "activity",
    "unrelated",
    "settled",
    "resettled",
    "null-branch",
    "stale-branch",
  ] as const)("cancels removal when a child changes during measurement (%s)", (change) =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* pausedMeasurementFixture();
        const root = shell({ branch: "feature", worktreePath: fixture.worktree });
        const child = {
          ...root,
          id: ThreadId.make("child"),
          settledAt: change === "resettled" ? at(-20 * DAY_MS) : null,
          lineage: {
            parentThreadId: root.id,
            rootThreadId: root.id,
            relationshipToParent: "subagent" as const,
          },
        };
        fixture.setThreads([child, root]);
        const run = yield* fixture.service.runNow.pipe(Effect.forkChild);
        yield* Deferred.await(fixture.measuring);
        fixture.setThreads([
          root,
          {
            ...child,
            branch:
              change === "null-branch"
                ? null
                : change === "stale-branch"
                  ? "t3/15a6e5ae"
                  : child.branch,
            settledAt: change === "settled" ? at(-20 * DAY_MS) : child.settledAt,
            updatedAt: change === "settled" || change === "resettled" ? at(0) : child.updatedAt,
            status: change === "running" ? "running" : "idle",
            pendingBackgroundTasks:
              change === "pending" ? [{ taskId: "task", kind: "command" }] : [],
            latestRunCompletedAt: change === "activity" ? at(-DAY_MS) : null,
          },
          ...(change === "unrelated" ? [shell({ ...root, id: ThreadId.make("other") })] : []),
        ]);
        yield* Deferred.succeed(fixture.resume, undefined);
        expect((yield* Fiber.join(run)).entries[0]).toMatchObject({
          outcome: "kept",
          reason: "Thread activity or shared worktree changed since check",
        });
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(true);
      }),
    ),
  );
});

describe("deleted thread worktrees", () => {
  const parent = (worktreePath: string) =>
    shell({ branch: "feature", worktreePath, deletedAt: at(-DAY_MS) });
  // Deleting the parent leaves its native subagent thread in the projection.
  const subagent = (
    owner: OrchestrationV2ThreadShell,
    overrides: Partial<OrchestrationV2ThreadShell> = {},
  ) =>
    shell({
      id: ThreadId.make("child"),
      title: "Subagent",
      branch: "feature",
      worktreePath: owner.worktreePath,
      status: "completed",
      createdBy: "agent",
      creationSource: "provider",
      lineage: {
        rootThreadId: owner.id,
        parentThreadId: owner.id,
        relationshipToParent: "subagent",
      },
      ...overrides,
    });

  it.effect.each(["no subagents", "native subagent"] as const)(
    "removes a deleted thread's worktree with %s",
    (scenario) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW_MS);
        const fixture = yield* cleanupFixture({
          ...DEFAULT_SERVER_SETTINGS.storageCleanup,
          worktreeAfterDays: null,
          worktreeOnDelete: true,
        });
        const owner = parent(fixture.worktree);
        fixture.setDeletedThreads([owner]);
        fixture.setThreads(scenario === "native subagent" ? [subagent(owner)] : []);
        const report = yield* fixture.service.runNow;
        expect(report.entries[0]).toMatchObject({
          threadId: owner.id,
          outcome: "removed",
          reason: "Thread was deleted",
        });
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(false);
      }).pipe(Effect.provide(cleanupTestLayer), Effect.scoped),
  );

  it.effect("applies the remaining subagent's rules when deletion cleanup is off", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW_MS);
      const fixture = yield* cleanupFixture({
        ...DEFAULT_SERVER_SETTINGS.storageCleanup,
        worktreeAfterDays: 8,
        worktreeOnDelete: false,
      });
      const owner = parent(fixture.worktree);
      const child = subagent(owner);
      fixture.setDeletedThreads([owner]);
      fixture.setThreads([child]);
      const report = yield* fixture.service.runNow;
      expect(report.entries[0]).toMatchObject({
        threadId: child.id,
        outcome: "removed",
        reason: "Inactive for 30 days",
      });
      expect(yield* fixture.fs.exists(fixture.worktree)).toBe(false);
    }).pipe(Effect.provide(cleanupTestLayer), Effect.scoped),
  );

  it.effect("waits out the settle grace of a subagent that just settled", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW_MS);
      const fixture = yield* cleanupFixture({
        ...DEFAULT_SERVER_SETTINGS.storageCleanup,
        worktreeAfterDays: null,
        worktreeOnDelete: true,
      });
      const owner = parent(fixture.worktree);
      fixture.setDeletedThreads([owner]);
      fixture.setThreads([subagent(owner, { settledAt: at(0), updatedAt: at(0) })]);
      const report = yield* fixture.service.runNow;
      expect(report.entries[0]).toMatchObject({
        threadId: owner.id,
        outcome: "kept",
        reason: "Settled moments ago",
      });
      expect(yield* fixture.fs.exists(fixture.worktree)).toBe(true);
    }).pipe(Effect.provide(cleanupTestLayer), Effect.scoped),
  );
});

describe("orphan worktree reports", () => {
  // fork: project-lifecycle
  it.live("removes only a clean unreferenced orphan and prunes its empty project folder", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.setThreads([]);
        const parent = `${fixture.config.worktreesDir}/orphan-project`;
        const orphan = `${parent}/checkout`;
        yield* fixture.command(fixture.repo, ["worktree", "add", "-b", "orphan-removal", orphan]);
        yield* fixture.fs.utimes(orphan, 1, 1);
        yield* fixture.fs.writeFileString(`${orphan}/tracked.txt`, "unsaved");
        expect((yield* fixture.service.removeOrphan(orphan)).entries[0]?.outcome).toBe("kept");
        expect(yield* fixture.fs.readFileString(`${orphan}/tracked.txt`)).toBe("unsaved");
        yield* fixture.command(orphan, ["restore", "tracked.txt"]);
        fixture.setStoredWorktreePaths([orphan]);
        expect((yield* fixture.service.removeOrphan(orphan)).entries[0]?.outcome).toBe("kept");
        fixture.setStoredWorktreePaths([]);
        yield* fixture.fs.utimes(orphan, 1, 1);
        const removed = (yield* fixture.service.removeOrphan(orphan)).entries[0];
        expect(removed, JSON.stringify(removed)).toMatchObject({ outcome: "removed" });
        expect(yield* fixture.fs.exists(parent)).toBe(false);
        expect(
          (yield* fixture.command(fixture.repo, [
            "show-ref",
            "--verify",
            "refs/heads/orphan-removal",
          ])).stdout,
        ).toContain("orphan-removal");
      }).pipe(
        // The fixture mocks lsof; a real Linux /proc scan keeps the orphan whenever a runner
        // process hides its cwd. Removal reads the platform per call, so pin the whole test.
        Effect.provideService(HostProcess.Platform, "darwin"),
      ),
    ),
  );

  // fork: project-lifecycle
  it.live.each(["untracked", "ignored", "detached"])(
    "preserves orphan work with %s files or commits",
    (kind) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* cleanupFixture();
          fixture.setThreads([]);
          const orphan = `${fixture.config.worktreesDir}/preserve/${kind}`;
          yield* fixture.command(fixture.repo, [
            "worktree",
            "add",
            ...(kind === "detached" ? ["--detach"] : ["-b", `preserve-${kind}`]),
            orphan,
          ]);
          if (kind === "ignored")
            yield* fixture.fs.writeFileString(`${fixture.repo}/.git/info/exclude`, "keep.dat\n");
          if (kind !== "detached")
            yield* fixture.fs.writeFileString(`${orphan}/keep.dat`, "keep me");
          yield* fixture.fs.utimes(orphan, 1, 1);
          const report = yield* fixture.service.removeOrphan(orphan);
          expect(report.entries[0]?.outcome).toBe("kept");
          expect(yield* fixture.fs.exists(orphan)).toBe(true);
          if (kind !== "detached")
            expect(yield* fixture.fs.readFileString(`${orphan}/keep.dat`)).toBe("keep me");
        }),
      ),
  );

  it.live("keeps orphan results visible when thread results fill the report", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.setThreads(
          Array.from({ length: 205 }, (_, index) =>
            shell({
              id: ThreadId.make(`busy-${index}`),
              branch: "busy",
              worktreePath: `${fixture.config.worktreesDir}/busy-${index}`,
              status: "running",
            }),
          ),
        );
        for (let index = 0; index < 205; index++) {
          yield* fixture.fs.makeDirectory(`${fixture.config.worktreesDir}/busy-${index}`);
        }
        const orphans = ["one", "two"].map(
          (name) => `${fixture.config.worktreesDir}/repository/${name}`,
        );
        for (const orphan of orphans) {
          yield* fixture.fs.makeDirectory(orphan, { recursive: true });
          yield* fixture.fs.utimes(orphan, 1, 1);
        }
        const report = yield* fixture.service.runNow;
        expect(report.entries).toHaveLength(200);
        expect(
          report.entries
            .slice(0, 2)
            .map((entry) => entry.path)
            .sort(),
        ).toEqual(orphans);
        expect(report.counts).toEqual({ removed: 0, kept: 207, failed: 0 });
        expect(report.omittedCount).toBe(7);
      }),
    ),
  );

  it.live.each(["canonical", "win32", "linux"] as const)(
    "skips an ancestor of a referenced thread worktree (%s)",
    (platform) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* cleanupFixture().pipe(
            Effect.provideService(HostProcess.Platform, platform === "win32" ? "win32" : "linux"),
          );
          fixture.setThreads([]);
          const ancestor = `${fixture.config.worktreesDir}/repository/stack`;
          const worktree = `${ancestor}/feature`;
          yield* fixture.command(fixture.repo, ["worktree", "add", "-b", "nested", worktree]);
          const alias = `${fixture.repo}/alias`;
          if (platform === "canonical") yield* fixture.fs.symlink(worktree, alias);
          fixture.setStoredWorktreePaths([
            platform === "canonical"
              ? alias
              : platform === "win32"
                ? worktree.toUpperCase()
                : worktree,
          ]);
          yield* fixture.fs.utimes(ancestor, 1, 1);
          expect((yield* fixture.service.runNow).entries).toEqual([]);
          expect(yield* fixture.fs.exists(worktree)).toBe(true);
        }),
      ),
  );

  it.live("continues reporting when a project root cannot be probed", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.setThreads([]);
        const loop = `${fixture.repo}/loop`;
        yield* fixture.fs.symlink(loop, loop);
        fixture.setProjectRoots([fixture.repo, loop]);
        const orphan = `${fixture.config.worktreesDir}/repository/orphan`;
        yield* fixture.fs.makeDirectory(orphan, { recursive: true });
        yield* fixture.fs.utimes(orphan, 1, 1);
        expect((yield* fixture.service.runNow).entries).toEqual([
          expect.objectContaining({ path: orphan, outcome: "kept", bytes: 0 }),
        ]);
      }),
    ),
  );

  it.live.each(["nested", "direct"] as const)(
    "reports a linked orphan's size without removing its files (%s)",
    (location) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* cleanupFixture();
          fixture.setThreads([]);
          const orphan = `${fixture.config.worktreesDir}/${location === "nested" ? "repository/" : ""}orphan`;
          yield* fixture.command(fixture.repo, ["worktree", "add", "-b", "orphan", orphan]);
          const sizes = yield* Effect.forEach(yield* fixture.fs.readDirectory(orphan), (name) =>
            allocatedBytes(fixture.fs, `${orphan}/${name}`),
          );
          const outside = yield* fixture.fs.makeTempDirectoryScoped();
          yield* fixture.fs.writeFileString(`${outside}/external`, "outside data");
          yield* fixture.fs.symlink(outside, `${orphan}/linked-directory`);
          yield* fixture.fs.symlink(`${outside}/missing`, `${orphan}/dangling-link`);
          yield* fixture.fs.utimes(orphan, 1, 1);
          const report = yield* fixture.service.runNow;
          expect(report.entries).toEqual([
            {
              kind: "worktree",
              outcome: "kept",
              reason: "No thread uses this worktree",
              path: orphan,
              projectPath: null,
              threadId: null,
              threadTitle: null,
              bytes: sizes.reduce((sum, size) => sum + size, 0),
              files: null,
            },
          ]);
          expect(report.bytesFreed).toBe(0);
          expect(yield* fixture.fs.readFileString(`${orphan}/tracked.txt`)).toBe("original\n");
          expect(yield* fixture.fs.readFileString(`${outside}/external`)).toBe("outside data");
          expect(
            (yield* fixture.command(orphan, ["rev-parse", "--is-inside-work-tree"])).stdout.trim(),
          ).toBe("true");
        }),
      ),
  );

  it.live.each(["active", "outside-active-snapshot"] as const)(
    "does not report a folder referenced by a thread (%s)",
    (location) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* cleanupFixture();
          const worktreePath = `${fixture.config.worktreesDir}/repository/referenced`;
          yield* fixture.command(fixture.repo, [
            "worktree",
            "add",
            "-b",
            "referenced",
            worktreePath,
          ]);
          fixture.setThreads(
            location === "active"
              ? [shell({ branch: "referenced", worktreePath, status: "running" })]
              : [],
          );
          if (location !== "active")
            fixture.setStoredWorktreePaths([fixture.worktree, worktreePath]);
          yield* fixture.fs.utimes(worktreePath, 1, 1);
          const report = yield* fixture.service.runNow;
          expect(report.entries.filter((entry) => entry.threadId === null)).toEqual([]);
          expect(yield* fixture.fs.exists(worktreePath)).toBe(true);
        }),
      ),
  );

  it.live.each(["exact", "nested", "symlink"] as const)(
    "does not report a folder containing a project checkout (%s)",
    (location) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* cleanupFixture();
          fixture.setThreads([]);
          const worktreePath = `${fixture.config.worktreesDir}/repository/project-checkout`;
          yield* fixture.fs.makeDirectory(`${worktreePath}/nested`, { recursive: true });
          const alias = `${fixture.repo}/alias`;
          if (location === "symlink") yield* fixture.fs.symlink(`${worktreePath}/nested`, alias);
          fixture.setProjectRoots([
            fixture.repo,
            location === "exact"
              ? worktreePath
              : location === "nested"
                ? `${worktreePath}/nested`
                : alias,
          ]);
          yield* fixture.fs.utimes(worktreePath, 1, 1);
          expect((yield* fixture.service.runNow).entries).toEqual([]);
          expect(yield* fixture.fs.exists(worktreePath)).toBe(true);
        }),
      ),
  );

  it.live.each(["exact", "contains", "symlink"] as const)(
    "does not report project internals under a custom managed root (%s)",
    (location) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* cleanupFixture();
          fixture.setThreads([]);
          const source = `${fixture.repo}/src`;
          yield* fixture.fs.makeDirectory(`${source}/nested/deep`, { recursive: true });
          const alias = `${fixture.config.worktreesDir}/project-alias`;
          if (location === "symlink") {
            yield* fixture.fs.symlink(fixture.repo, alias);
            fixture.setProjectRoots([alias]);
          }
          if (location === "contains") fixture.setProjectRoots([fixture.repo, `${source}/nested`]);
          fixture.setSettings({
            worktreesDirectory: location === "contains" ? source : fixture.repo,
          });
          expect((yield* fixture.service.runNow).entries).toEqual([]);
          expect(yield* fixture.fs.exists(`${source}/nested/deep`)).toBe(true);
        }),
      ),
  );

  it.live("skips symbolic links at both directory levels and disabled cleanup", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.setThreads([]);
        const outside = yield* fixture.fs.makeTempDirectoryScoped();
        yield* fixture.fs.makeDirectory(`${outside}/checkout`);
        const projectDirectory = `${fixture.config.worktreesDir}/repository`;
        yield* fixture.fs.makeDirectory(projectDirectory);
        yield* fixture.fs.symlink(outside, `${fixture.config.worktreesDir}/linked-project`);
        yield* fixture.fs.symlink(`${outside}/checkout`, `${projectDirectory}/linked-checkout`);
        yield* fixture.fs.symlink(`${outside}/missing`, `${projectDirectory}/dangling-link`);
        expect((yield* fixture.service.runNow).entries).toEqual([]);
        const orphan = `${projectDirectory}/orphan`;
        yield* fixture.fs.makeDirectory(orphan);
        fixture.disable();
        expect((yield* fixture.service.runNow).entries).toEqual([]);
        expect(yield* fixture.fs.exists(orphan)).toBe(true);
      }),
    ),
  );

  it.live("reports ordinary folders with an honest reason and keeps their files", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fixture = yield* cleanupFixture();
        fixture.setThreads([]);
        const folder = `${fixture.config.worktreesDir}/repository/leftover`;
        yield* fixture.fs.makeDirectory(folder, { recursive: true });
        yield* fixture.fs.writeFileString(`${folder}/payload`, "leftover data");
        yield* fixture.fs.utimes(folder, 1, 1);
        const report = yield* fixture.service.runNow;
        expect(report.entries).toEqual([
          expect.objectContaining({
            path: folder,
            outcome: "kept",
            bytes: yield* allocatedBytes(fixture.fs, `${folder}/payload`),
            reason: "No thread uses this folder, and it isn't a git worktree",
          }),
        ]);
        expect(report.bytesFreed).toBe(0);
        expect(yield* fixture.fs.readFileString(`${folder}/payload`)).toBe("leftover data");
      }),
    ),
  );

  it.live("continues after an inaccessible directory's git probe", (context) =>
    runCleanupTest(
      Effect.gen(function* () {
        if ((yield* HostProcess.isWindows) || (yield* HostProcess.UserId) === 0)
          return context.skip();
        const fixture = yield* cleanupFixture();
        fixture.setThreads([]);
        const blocked = `${fixture.config.worktreesDir}/a-inaccessible`;
        const orphan = `${fixture.config.worktreesDir}/z-repository/orphan`;
        yield* fixture.fs.makeDirectory(blocked);
        yield* fixture.fs.makeDirectory(orphan, { recursive: true });
        yield* fixture.fs.writeFileString(`${orphan}/file`, "x");
        yield* fixture.fs.chmod(blocked, 0);
        yield* fixture.fs.utimes(orphan, 1, 1);
        const report = yield* fixture.service.runNow.pipe(
          Effect.ensuring(fixture.fs.chmod(blocked, 0o700).pipe(Effect.orDie)),
        );
        expect(report.entries).toEqual([
          expect.objectContaining({
            path: orphan,
            outcome: "kept",
            bytes: yield* allocatedBytes(fixture.fs, `${orphan}/file`),
          }),
        ]);
        expect(yield* fixture.fs.exists(orphan)).toBe(true);
      }),
    ),
  );

  it.live.each(["win32", "linux"] as const)(
    "compares thread paths with host casing rules and excludes existing projects (%s)",
    (platform) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* cleanupFixture().pipe(
            Effect.provideService(HostProcess.Platform, platform),
          );
          fixture.setThreads([]);
          const parent = `${fixture.config.worktreesDir}/repository`;
          const referenced = `${parent}/Referenced`;
          const project = `${parent}/Project`;
          const nested = `${parent}/Nested`;
          for (const folder of [referenced, project, nested]) {
            yield* fixture.fs.makeDirectory(`${folder}/child`, { recursive: true });
            yield* fixture.fs.utimes(folder, 1, 1);
          }
          fixture.setStoredWorktreePaths([fixture.worktree, referenced.toUpperCase()]);
          fixture.setProjectRoots([fixture.repo, project, `${nested}/child`]);
          const report = yield* fixture.service.runNow;
          expect(report.entries.map((entry) => entry.path).sort()).toEqual(
            platform === "win32" ? [] : [referenced],
          );
        }),
      ),
  );
});

describe("storage cleanup reports and local file policies", () => {
  // fork: project-lifecycle -- settled worktree release and restoration.
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
              getById: () => Effect.succeedSome({ workspaceRoot: fixture.repo } as never),
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
          expect(yield* SetupMarker.exists(fixture.worktree)).toBe(true);
          expect((yield* fixture.service.runNow).entries[0]?.reason).toBe(
            "Workspace preparation is pending",
          );
          // A fresh tracker models another host process. The marker, not memory,
          // makes the retry run setup on the checkout the failed attempt retained.
          yield* restore.pipe(Effect.provide(restorationLayer));
          expect(yield* fixture.fs.readFileString(`${fixture.worktree}/node_modules/ready`)).toBe(
            "prepared",
          );
          expect(yield* SetupMarker.exists(fixture.worktree)).toBe(false);
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
  it.effect("automatically removes an eligible archived thread checkout", () =>
    runCleanupTest(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW_MS);
        const fixture = yield* cleanupFixture();
        fixture.setThreads([
          shell({
            branch: "feature",
            worktreePath: fixture.worktree,
            archivedAt: at(-DAY_MS),
          }),
        ]);
        yield* fixture.activate(Stream.empty);
        const [report] = yield* fixture.service.reports.pipe(
          Stream.filter((report) => report !== null),
          Stream.take(1),
          Stream.runCollect,
        );
        yield* fixture.service.drain;
        expect(report).toMatchObject({
          trigger: "automatic",
          counts: { removed: 1, kept: 0, failed: 0 },
          entries: [
            {
              threadId: "thread-1",
              path: fixture.worktree,
              outcome: "removed",
              reason: "Inactive for 30 days",
            },
          ],
        });
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(false);
      }),
    ),
  );
  it.live.each(["before-check", "while-measuring"] as const)(
    "keeps a worktree protected by a missing project root (%s)",
    (timing) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fixture = yield* pausedMeasurementFixture();
          if (timing === "before-check")
            fixture.setProjectRoots([fixture.repo, `${fixture.worktree}/removed-checkout`]);
          const cleanup = yield* fixture.service.runNow.pipe(Effect.forkChild);
          if (timing === "while-measuring") {
            yield* Deferred.await(fixture.measuring);
            fixture.setProjectRoots([fixture.repo, `${fixture.worktree}/removed-checkout`]);
          }
          yield* Deferred.succeed(fixture.resume, undefined);
          const report = yield* Fiber.join(cleanup);
          expect(report.entries[0]).toMatchObject({
            outcome: "kept",
            reason: "Contains a project checkout",
          });
          expect(yield* fixture.fs.readFileString(`${fixture.worktree}/tracked.txt`)).toBe(
            "original\n",
          );
        }),
      ),
  );

  it.live("reports allocated bytes of single-link files without following symlinks", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, fs, worktree, setPolicy } = yield* cleanupFixture();
        setPolicy("tracked-changes");
        const sizes = yield* Effect.forEach(yield* fs.readDirectory(worktree), (name) =>
          allocatedBytes(fs, `${worktree}/${name}`),
        );
        const outside = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFileString(`${outside}/external`, "must not count");
        yield* fs.writeFileString(`${outside}/store-file`, "shared ".repeat(10_000));
        yield* fs.makeDirectory(`${worktree}/node_modules/nested`, { recursive: true });
        yield* fs.writeFileString(`${worktree}/node_modules/nested/file`, "count me");
        sizes.push(yield* allocatedBytes(fs, `${worktree}/node_modules/nested/file`));
        yield* fs.link(`${outside}/store-file`, `${worktree}/node_modules/hardlinked`);
        yield* fs.symlink(outside, `${worktree}/node_modules/directory-link`);
        yield* fs.symlink(`${outside}/external`, `${worktree}/node_modules/file-link`);
        yield* fs.symlink(`${outside}/missing`, `${worktree}/node_modules/dangling-link`);
        const report = yield* service.runNow;
        const bytes = sizes.reduce((sum, size) => sum + size, 0);
        expect(report.entries[0]).toMatchObject({ outcome: "removed", bytes, files: null });
        expect(report.bytesFreed).toBe(bytes);
        expect(yield* fs.readFileString(`${outside}/external`)).toBe("must not count");
        expect(yield* fs.readFileString(`${outside}/store-file`)).toBe("shared ".repeat(10_000));
        expect(yield* fs.exists(worktree)).toBe(false);
      }),
    ),
  );
  it.live.each(["same-device", "other-device", "no-manifest"] as const)(
    "counts the pnpm virtual store only when its store forces copies (%s)",
    (store) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const storeDir = yield* fs.makeTempDirectoryScoped({ prefix: "pnpm-store-" });
          const { service, worktree, setPolicy } = yield* cleanupFixture().pipe(
            Effect.provideService(FileSystem.FileSystem, {
              ...fs,
              stat: (target) =>
                fs
                  .stat(target)
                  .pipe(
                    Effect.map((info) =>
                      store === "other-device" && target === storeDir
                        ? { ...info, dev: info.dev + 1n }
                        : info,
                    ),
                  ),
            }),
          );
          setPolicy("tracked-changes");
          const nodeModules = `${worktree}/node_modules`;
          yield* fs.makeDirectory(`${nodeModules}/.pnpm/pkg@1.0.0`, { recursive: true });
          yield* fs.makeDirectory(`${nodeModules}/.vite`);
          yield* fs.writeFileString(
            `${nodeModules}/.pnpm/pkg@1.0.0/index.js`,
            "clone ".repeat(10_000),
          );
          yield* fs.writeFileString(`${nodeModules}/.vite/deps.js`, "cache");
          if (store !== "no-manifest")
            yield* fs.writeFileString(
              `${nodeModules}/.modules.yaml`,
              JSON.stringify({ storeDir, virtualStoreDir: ".pnpm" }),
            );
          const counted = [
            ...(yield* fs.readDirectory(worktree)).flatMap((name) =>
              name === "node_modules" ? [] : [`${worktree}/${name}`],
            ),
            `${nodeModules}/.vite/deps.js`,
            ...(store === "no-manifest" ? [] : [`${nodeModules}/.modules.yaml`]),
            ...(store === "same-device" ? [] : [`${nodeModules}/.pnpm/pkg@1.0.0/index.js`]),
          ];
          const bytes = (yield* Effect.forEach(counted, (file) => allocatedBytes(fs, file))).reduce(
            (sum, size) => sum + size,
            0,
          );
          const report = yield* service.runNow;
          expect(report.entries[0]).toMatchObject({ outcome: "removed", bytes });
        }),
      ),
  );
  // An agent can write this manifest. Statting its store sent the Windows
  // user's NTLM credentials to attacker.test during a background sweep.
  it.live.each([
    { storeDir: "\\\\attacker.test\\s" },
    { storeDir: "/local/store", virtualStoreDir: "//attacker.test/s" },
  ])("never stats a network pnpm store %o", (manifest) =>
    runCleanupTest(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const statted: Array<string> = [];
        const { service, worktree, setPolicy } = yield* cleanupFixture().pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            stat: (target) => {
              statted.push(target);
              return fs.stat(target);
            },
          }),
        );
        setPolicy("tracked-changes");
        yield* fs.makeDirectory(`${worktree}/node_modules`);
        yield* fs.writeFileString(
          `${worktree}/node_modules/.modules.yaml`,
          JSON.stringify(manifest),
        );
        expect((yield* service.runNow).entries[0]).toMatchObject({ outcome: "removed" });
        expect(statted.filter((target) => target.includes("attacker.test"))).toEqual([]);
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
      "its owner's branch is cleared",
      (worktree: string) => [shell({ branch: null, worktreePath: worktree, updatedAt: at(0) })],
    ],
    [
      "its owner's branch changes",
      (worktree: string) => [shell({ branch: "other", worktreePath: worktree, updatedAt: at(0) })],
    ],
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
    [
      "an archived thread starts using it",
      (worktree: string) => [
        shell({ branch: "feature", worktreePath: worktree }),
        shell({
          id: ThreadId.make("thread-2"),
          branch: "feature",
          worktreePath: worktree,
          archivedAt: at(-DAY_MS),
        }),
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
        const { service, fs, repo, worktree, command, setThreads, fullStatusCalls } =
          yield* cleanupFixture();
        const changed = { outcome: "kept", reason: "Repository or branch changed" };
        yield* command(worktree, ["checkout", "--detach"]);
        expect((yield* service.runNow).entries[0]).toMatchObject(changed);
        yield* command(worktree, ["switch", "--orphan", "other"]);
        expect((yield* service.runNow).entries[0]).toMatchObject(changed);
        yield* command(worktree, ["switch", "-c", "(feature)", "feature"]);
        setThreads([shell({ branch: "(feature)", worktreePath: worktree })]);
        expect((yield* service.runNow).entries[0]).toMatchObject(changed);
        setThreads([shell({ branch: "feature", worktreePath: worktree })]);
        yield* command(worktree, ["tag", "feature", "feature"]);
        // Newer Git refuses to create a tag named HEAD, but still reads one.
        yield* command(worktree, ["update-ref", "refs/tags/HEAD", "refs/heads/feature"]);
        yield* command(worktree, ["switch", "feature"]);
        const index = (yield* command(worktree, ["rev-parse", "--git-path", "index"])).stdout;
        yield* fs.writeFileString(`${index.trim()}.lock`, "");
        const locked = (yield* service.runNow).entries[0];
        expect(locked).toMatchObject({
          outcome: "failed",
          projectPath: repo,
          path: worktree,
          threadId: "thread-1",
          threadTitle: "Thread",
        });
        expect(locked?.reason).toContain("Git index is locked");
        expect(yield* fs.readFileString(`${worktree}/tracked.txt`)).toBe("original\n");
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
          allocatedBytes(fs, `${worktree}/${name}`),
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
  it.live(
    "discovers trunk without a remote HEAD or tracking ref and removes an integrated worktree",
    () =>
      runCleanupTest(
        Effect.gen(function* () {
          const { service, fs, repo, worktree, command } = yield* cleanupFixture({
            ...DEFAULT_SERVER_SETTINGS.storageCleanup,
            worktreeUnchanged: true,
          });
          const remote = yield* fs.makeTempDirectoryScoped({ prefix: "cleanup-remote-" });
          yield* command(remote, ["init", "--bare", "-b", "trunk"]);
          yield* command(repo, ["remote", "add", "origin", remote]);
          yield* command(repo, ["push", "origin", "main:trunk"]);
          yield* command(repo, ["update-ref", "-d", "refs/remotes/origin/trunk"]);
          expect((yield* command(repo, ["for-each-ref", "refs/remotes/origin"])).stdout).toBe("");

          const report = yield* service.runNow;
          expect(report.entries[0]).toMatchObject({
            outcome: "removed",
            reason: "No commits beyond the default branch",
          });
          expect(yield* fs.exists(worktree)).toBe(false);
        }),
      ),
  );
  it.live(
    "keeps worktree commits present on nondefault main but absent from advertised trunk",
    () =>
      runCleanupTest(
        Effect.gen(function* () {
          const { service, fs, repo, worktree, command } = yield* cleanupFixture({
            ...DEFAULT_SERVER_SETTINGS.storageCleanup,
            worktreeUnchanged: true,
          });
          const remote = yield* fs.makeTempDirectoryScoped({ prefix: "cleanup-remote-" });
          yield* command(remote, ["init", "--bare", "-b", "trunk"]);
          yield* command(repo, ["remote", "add", "origin", remote]);
          yield* command(repo, ["push", "origin", "main:trunk"]);
          yield* fs.writeFileString(`${worktree}/tracked.txt`, "unmerged work\n");
          yield* command(worktree, ["commit", "-am", "unmerged work"]);
          yield* command(repo, ["push", "origin", "feature:main"]);
          expect(
            (yield* command(repo, ["symbolic-ref", "refs/remotes/origin/HEAD"]).pipe(Effect.exit))
              ._tag,
          ).toBe("Failure");

          const report = yield* service.runNow;
          expect(report.entries[0]).toMatchObject({
            outcome: "kept",
            reason: "Has commits beyond the default branch",
          });
          expect(yield* fs.readFileString(`${worktree}/tracked.txt`)).toBe("unmerged work\n");
        }),
      ),
  );
  it.live("keeps the worktree when the remote default is unavailable even if main exists", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, fs, repo, worktree, command } = yield* cleanupFixture({
          ...DEFAULT_SERVER_SETTINGS.storageCleanup,
          worktreeUnchanged: true,
        });
        const remote = yield* fs.makeTempDirectoryScoped({ prefix: "cleanup-remote-" });
        yield* command(remote, ["init", "--bare", "-b", "trunk"]);
        yield* command(repo, ["remote", "add", "origin", remote]);
        // The remote HEAD names an unborn trunk; main exists but is not its default.
        yield* command(repo, ["push", "origin", "main"]);

        const report = yield* service.runNow;
        expect(report.entries[0]).toMatchObject({
          outcome: "kept",
          reason: "Default branch is unavailable",
        });
        expect(yield* fs.exists(worktree)).toBe(true);
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
  // fork: retention-defaults
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

// fork: mini-native-retention
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
        // fork: mini-native-retention -- the pin lands while cleanup walks the checkout
        pinDuringWalk = () =>
          f.setThreads([shell({ branch: "feature", worktreePath: f.worktree, pinnedAt: at(0) })]);
        expect((yield* f.service.runNow).entries[0]?.reason).toBe("Thread is pinned");
        expect(yield* fs.exists(f.worktree)).toBe(true);
      }),
    ),
  );
  // fork: mini-native-retention -- Scratch tests continue this describe block

  // fork: mini-native-retention
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

  it.live("Library management also excludes native Scratch cleanup", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* scratchFixture;
        const receipt = libraryReceipt(f.cwd);
        yield* f.libraryStore.put({ ...receipt, copy: { ...receipt.copy, ownership: "managed" } });
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "scratch")?.reason,
        ).toBe("The Library manages these files");
        expect(yield* f.fs.exists(f.cwd)).toBe(true);
      }),
    ),
  );

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
  const repositoryIdentity = buildRepositoryIdentity({
    rootPath: cwd,
    remoteName: "origin",
    remoteUrl: remote,
    originUrl: remote,
  });
  const mark = markManagedProjectCheckout(cwd, repositoryIdentity);
  const adopt = markManagedProjectCheckout(cwd, repositoryIdentity, {
    ownershipSource: "adopted",
    retention: "release-on-settle",
    projectId: ProjectId.make("project-1"),
  });
  return { ...f, cwd, mark, adopt };
});
const libraryReceipt = (rootPath: string): LibraryWorkspaceStore.WorkspaceReceipt => {
  const timestamp = "2026-06-01T12:00:00.000Z";
  return {
    requestId: "library-copy",
    fingerprint: "copy",
    project: {
      id: "library-project",
      revision: 1,
      title: "Library project",
      brief: "",
      resources: [],
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    copy: {
      id: "library-copy",
      projectId: "library-project",
      projectRevision: 1,
      environmentId: EnvironmentId.make("library-computer"),
      rootPath,
      repositories: [
        {
          resourceId: "repo",
          path: rootPath,
          localProjectId: ProjectId.make("project-1"),
          head: null,
          branch: "main",
        },
      ],
      ownership: "borrowed",
      state: "ready",
      keepOnComputer: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    rootLocalProjectId: ProjectId.make("project-1"),
    rootCheckpointRepository: false,
    legacyThreadIds: [],
    rootIdentity: null,
    releaseRequestId: null,
    releaseReviewToken: null,
    removalPath: null,
    archivePath: null,
    archiveDigest: null,
  };
};
const libraryPrimaryFixture = Effect.gen(function* () {
  const f = yield* primaryFixture;
  yield* f.adopt;
  const store = f.libraryStore;
  const receipt = libraryReceipt(f.cwd);
  yield* store.put(receipt);
  const bind = (threadId: ThreadId, localProjectId = ProjectId.make("project-1")) =>
    store.bind(threadId, {
      binding: {
        projectId: receipt.project.id,
        projectRevision: 1,
        environmentId: receipt.copy.environmentId,
        workingCopyId: receipt.copy.id,
        resourceIds: ["repo"],
      },
      cwd: f.cwd,
      localProjectId,
      repositoryPaths: [f.cwd],
    });
  yield* bind(ThreadId.make("thread-1"));
  const context = yield* Layer.build(NodeSqliteClient.layer({ filename: ":memory:" }));
  const history = Context.get(context, SqlClient.SqlClient);
  yield* history`CREATE TABLE fork_library_source_state (key TEXT, environment_id TEXT)`;
  yield* history`CREATE TABLE fork_library_source_threads (thread_id TEXT, queued_sequence INTEGER, acknowledged_sequence INTEGER)`;
  yield* history`CREATE TABLE fork_library_source_outbox (thread_id TEXT)`;
  yield* history`CREATE TABLE orchestration_events (sequence INTEGER, application_event_version INTEGER, aggregate_kind TEXT, stream_id TEXT, event_type TEXT)`;
  yield* history`INSERT INTO fork_library_source_state VALUES ('host', 'library-computer')`;
  yield* history`INSERT INTO fork_library_source_threads VALUES ('thread-1', 10, 10)`;
  yield* history`INSERT INTO orchestration_events VALUES (10, 2, 'thread', 'thread-1', 'thread.settled')`;
  f.useLibraryHistory(history);
  f.setThreads([shell({ settledOverride: "settled" })]);
  return { ...f, receipt, bind, history };
});

describe("primary project storage cleanup", () => {
  it.live("an unrelated Library Keep does not protect an independent native folder", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* libraryPrimaryFixture;
        yield* f.libraryStore.put({
          ...f.receipt,
          copy: {
            ...f.receipt.copy,
            ownership: "managed",
            rootPath: `${f.cwd}-library`,
            repositories: [],
          },
        });
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "project")?.outcome,
        ).toBe("removed");
      }),
    ),
  );

  it.live("Library management also excludes native linked-worktree cleanup", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* cleanupFixture();
        const receipt = libraryReceipt(f.worktree);
        yield* f.libraryStore.put({ ...receipt, copy: { ...receipt.copy, ownership: "managed" } });
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "worktree")?.reason,
        ).toBe("The Library manages these files");
        expect(yield* f.fs.exists(f.worktree)).toBe(true);
      }),
    ),
  );

  it.live("rechecks Library ownership acquired during native publication checks", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* libraryPrimaryFixture;
        f.onPublicationFetch(
          f.libraryStore
            .put({ ...f.receipt, copy: { ...f.receipt.copy, ownership: "managed" } })
            .pipe(Effect.orDie),
        );
        const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
        expect(entry?.reason).toBe("The Library manages these files");
        expect(yield* f.fs.exists(f.cwd)).toBe(true);
      }),
    ),
  );
  it.live("Library history acknowledges late events before native release can proceed", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* libraryPrimaryFixture;
        f.onPublicationFetch(
          f.history`INSERT INTO orchestration_events VALUES (11, 2, 'thread', 'thread-1', 'thread.settled')`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
        );
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "project")?.reason,
        ).toBe("Library history has not been acknowledged");
        expect(yield* f.fs.exists(f.cwd)).toBe(true);
        yield* f.history`UPDATE fork_library_source_threads SET queued_sequence=11,acknowledged_sequence=11`;
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "project")?.outcome,
        ).toBe("removed");
      }),
    ),
  );
  it.live("visiting an acknowledged Library conversation does not prevent native cleanup", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* libraryPrimaryFixture;
        yield* f.history`INSERT INTO orchestration_events VALUES (11, 2, 'thread', 'thread-1', 'thread.visited')`;
        expect(
          (yield* f.service.runNow).entries.find((entry) => entry.kind === "project")?.outcome,
        ).toBe("removed");
      }),
    ),
  );
  it.live.each(["unbound", "missing", "unregistered"] as const)(
    "protects %s Library bindings",
    (state) =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* libraryPrimaryFixture;
          if (state === "missing") yield* f.bind(ThreadId.make("missing-thread"));
          else
            f.setThreads([
              shell({ settledOverride: "settled" }),
              shell({ id: ThreadId.make("unbound-thread"), settledOverride: "settled" }),
            ]);
          if (state === "unregistered")
            yield* f.libraryStore.put({
              ...f.receipt,
              copy: { ...f.receipt.copy, registered: false },
            });
          expect(
            (yield* f.service.runNow).entries.find((entry) => entry.kind === "project")?.reason,
          ).toBe("Library conversation bindings could not be verified");
          expect(yield* f.fs.exists(f.cwd)).toBe(true);
        }),
      ),
  );

  it.live.each(["root", "component", "alias", "ancestor"] as const)(
    "Library Keep survives a competing native release of its %s",
    (location) =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* libraryPrimaryFixture;
          let rootPath = location === "component" ? `${f.cwd}/..` : f.cwd;
          if (location === "alias") {
            rootPath = `${f.cwd}-alias`;
            yield* f.fs.symlink(f.cwd, rootPath);
          }
          if (location === "ancestor") rootPath = `${f.cwd}/nested-copy`;
          yield* f.libraryStore.put({
            ...f.receipt,
            copy: {
              ...f.receipt.copy,
              ownership: "managed",
              rootPath,
              repositories:
                location === "alias" || location === "ancestor" ? [] : f.receipt.copy.repositories,
            },
          });
          const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
          expect(entry?.reason).toBe("The Library manages these files");
          expect(yield* f.fs.exists(f.cwd)).toBe(true);
          expect((yield* readManagedProjectCheckout(f.cwd))?.released).toBe(false);
        }),
      ),
  );
  it.live.each(["queued", "uncaptured", "outbox", "unknown-thread", "unknown-journal"] as const)(
    "native release cannot bypass %s Library history",
    (pending) =>
      runCleanupTest(
        Effect.gen(function* () {
          const f = yield* libraryPrimaryFixture;
          if (pending === "queued")
            yield* f.history`UPDATE fork_library_source_threads SET queued_sequence=11`;
          if (pending === "uncaptured")
            yield* f.history`INSERT INTO orchestration_events VALUES (11, 2, 'thread', 'thread-1', 'thread.settled')`;
          if (pending === "outbox")
            yield* f.history`INSERT INTO fork_library_source_outbox VALUES ('thread-1')`;
          if (pending === "unknown-thread")
            yield* f.history`DELETE FROM fork_library_source_threads`;
          if (pending === "unknown-journal")
            yield* f.history`DELETE FROM fork_library_source_state`;
          const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
          expect(entry?.reason).toBe("Library history has not been acknowledged");
          expect(yield* f.fs.exists(f.cwd)).toBe(true);
        }),
      ),
  );
  it.live("an active Library root thread protects an adopted component", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* libraryPrimaryFixture;
        const rootId = ProjectId.make("library-root");
        yield* f.libraryStore.put({
          ...f.receipt,
          rootLocalProjectId: rootId,
          copy: { ...f.receipt.copy, rootPath: `${f.cwd}/..`, rootLocalProjectId: rootId },
        });
        yield* f.bind(ThreadId.make("root-thread"), rootId);
        f.setThreads([
          shell({ settledOverride: "settled" }),
          shell({
            id: ThreadId.make("root-thread"),
            projectId: rootId,
            activeRunId: RunId.make("root-run"),
          }),
        ]);
        const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
        expect(entry?.reason).toBe("A Library conversation is active or has pending work");
        expect(yield* f.fs.exists(f.cwd)).toBe(true);
      }),
    ),
  );
  it.live("preserves native release and restore for an acknowledged borrowed Library folder", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* libraryPrimaryFixture;
        const entry = (yield* f.service.runNow).entries.find((entry) => entry.kind === "project");
        expect(entry?.outcome, entry?.reason).toBe("removed");
        expect(yield* f.fs.exists(f.cwd)).toBe(false);
        expect(yield* restoreManagedProjectCheckout(f.cwd)).toBe(true);
        expect(yield* f.fs.readFileString(`${f.cwd}/tracked.txt`)).toBe("original\n");
      }),
    ),
  );

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
          expect(yield* SetupMarker.exists(f.cwd)).toBe(true);
          expect(yield* f.fs.exists(`${f.cwd}.t3-setup-pending`)).toBe(false);
          yield* SetupMarker.clear(f.cwd);
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
          const receiptPath = yield* ownershipReceiptPath(f.cwd);
          f.onPublicationFetch(
            Effect.gen(function* () {
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

// fork: library-launch-files
describe("Library Git mirror cleanup", () => {
  const remote = (name: string) => `https://example.test/${name}.git`;
  const mirror = (name: string, lastUsedAt: DateTime.Utc): LibraryGitFetch.LibraryGitMirror => ({
    key: `key:${remote(name)}`,
    path: `/mirrors/${name}.git`,
    remoteUrl: remote(name),
    bytes: 4_096,
    lastUsedAt: DateTime.formatIso(lastUsedAt),
  });
  const libraryCopy = (name: string, state: "ready" | "released") => {
    const receipt = libraryReceipt(`/library-copies/${name}`);
    return {
      ...receipt,
      project: {
        ...receipt.project,
        resources: [
          {
            id: "repo",
            title: "Repository",
            remoteUrl: remote(name),
            relativePath: "",
            defaultBranch: "main",
          },
        ],
      },
      copy: { ...receipt.copy, id: `copy-${name}`, state },
    };
  };
  const sweepMirrors = (input: {
    readonly mirrors: ReadonlyArray<LibraryGitFetch.LibraryGitMirror>;
    readonly copies?: ReadonlyArray<LibraryWorkspaceStore.WorkspaceReceipt>;
    readonly failing?: string;
  }) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW_MS);
      const removals: Array<{ readonly key: string; readonly unusedSince: string }> = [];
      const f = yield* cleanupFixture().pipe(
        Effect.provide(
          Layer.mock(LibraryGitFetch.LibraryGitFetch)({
            mirrorKey: (remoteUrl) => Effect.succeed(`key:${remoteUrl}`),
            mirrors: Effect.succeed(input.mirrors),
            removeMirror: (request) =>
              request.key === input.failing
                ? Effect.fail(new LibraryError({ reason: "io", detail: "Mirror folder is busy" }))
                : Effect.sync(() => {
                    removals.push(request);
                    return 4_096;
                  }),
          }),
        ),
      );
      f.disable();
      for (const copy of input.copies ?? []) yield* f.libraryStore.put(copy);
      return { report: yield* f.service.runNow, removals };
    });

  it.effect("removes an idle mirror that no live Library copy uses and counts its bytes", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const idle = mirror("idle", at(-40 * DAY_MS));
        const { report, removals } = yield* sweepMirrors({
          mirrors: [idle],
          copies: [libraryCopy("idle", "released")],
        });
        expect(removals).toEqual([
          { key: idle.key, unusedSince: DateTime.formatIso(at(-30 * DAY_MS)) },
        ]);
        expect(report.gitMirrors).toEqual([
          {
            path: idle.path,
            remoteUrl: idle.remoteUrl,
            bytes: 4_096,
            lastUsedAt: idle.lastUsedAt,
            outcome: "removed",
            reason: "Unused for 30 days and no Library copy on this computer uses it",
          },
        ]);
        expect(report.bytesFreed).toBe(4_096);
      }),
    ),
  );

  it.effect("keeps an idle mirror that a live Library copy uses", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { report, removals } = yield* sweepMirrors({
          mirrors: [mirror("shared", at(-40 * DAY_MS))],
          copies: [libraryCopy("shared", "ready")],
        });
        expect(removals).toEqual([]);
        expect(report.gitMirrors).toMatchObject([
          { outcome: "kept", reason: "A Library copy on this computer uses it" },
        ]);
        expect(report.bytesFreed).toBe(0);
      }),
    ),
  );

  it.effect("keeps a mirror used in the last 30 days", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const { report, removals } = yield* sweepMirrors({
          mirrors: [mirror("recent", at(-2 * DAY_MS))],
        });
        expect(removals).toEqual([]);
        expect(report.gitMirrors).toMatchObject([
          { outcome: "kept", reason: "Used in the last 30 days" },
        ]);
      }),
    ),
  );

  it.effect("records a failed removal and still removes the other idle mirrors", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const busy = mirror("busy", at(-40 * DAY_MS));
        const idle = mirror("idle", at(-40 * DAY_MS));
        const { report } = yield* sweepMirrors({ mirrors: [busy, idle], failing: busy.key });
        expect(report.gitMirrors).toMatchObject([
          { path: busy.path, outcome: "failed", reason: "Mirror folder is busy" },
          { path: idle.path, outcome: "removed" },
        ]);
        expect(report.bytesFreed).toBe(4_096);
      }),
    ),
  );

  it.live("reports no mirrors on a host without the mirror service", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const f = yield* cleanupFixture();
        f.disable();
        const report = yield* f.service.runNow;
        expect(report.gitMirrors).toBeUndefined();
        expect(report.counts.failed).toBe(0);
      }),
    ),
  );
});

// fork: file-placement
describe("landed ignored-file rule", () => {
  it.live.each(["worktree", "repository", "bare"] as const)(
    "keeps a %s nested in ignored build output",
    (kind) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const git = yield* GitVcsDriver.GitVcsDriver;
          const cwd = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
          const command = (at: string, args: string[]) =>
            git.execute({ operation: "landed-rule-test", cwd: at, args });
          yield* command(cwd, ["init", "-b", "main"]);
          yield* command(cwd, ["config", "user.email", "cleanup@example.test"]);
          yield* command(cwd, ["config", "user.name", "Cleanup test"]);
          yield* fs.writeFileString(`${cwd}/.gitignore`, "dist/\nnode_modules/\n");
          yield* command(cwd, ["add", "."]);
          yield* command(cwd, ["commit", "-m", "initial"]);
          yield* fs.makeDirectory(`${cwd}/node_modules/pkg`, { recursive: true });
          yield* fs.writeFileString(`${cwd}/node_modules/pkg/index.js`, "dependency");
          const ignored = () =>
            command(cwd, [
              "ls-files",
              "--others",
              "--ignored",
              "--exclude-standard",
              "--directory",
              "-z",
            ]).pipe(
              Effect.flatMap((listing) =>
                StorageCleanup.landedIgnoredFileBlocker(cwd, listing.stdout),
              ),
            );
          expect(yield* ignored()).toBeNull();
          const nested = `${cwd}/dist/build/nested`;
          if (kind === "worktree") yield* command(cwd, ["worktree", "add", "-b", "nested", nested]);
          else
            yield* command(cwd, [
              "clone",
              "--no-hardlinks",
              ...(kind === "bare" ? ["--bare"] : []),
              cwd,
              nested,
            ]);
          expect(yield* ignored()).toBe("dist/build/nested/");
        }),
      ),
  );
});
