import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EventId,
  type GitCommandError,
  OrchestrationV2AppThreadJson,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ServerSettings,
  type StorageCleanupSettings,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as GitManager from "../../git/GitManager.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProviderSessionManager from "../../orchestration-v2/ProviderSessionManager.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { ServerActivation } from "../../serverActivation.ts";
import * as Settings from "../../serverSettings.ts";
import * as StorageCleanup from "../../storageCleanup.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";

const DAY_MS = 86_400_000;
// Sweeps read the live clock, so holder times sit well before any test run.
const BASE_MS = Date.parse("2026-01-01T00:00:00.000Z");
const ago = (ms: number) => DateTime.makeUnsafe(BASE_MS - ms);
const encodeThread = Schema.encodeSync(Schema.fromJsonString(OrchestrationV2AppThreadJson));

function holder(overrides: Partial<OrchestrationV2ThreadShell>): OrchestrationV2ThreadShell {
  const id = overrides.id ?? ThreadId.make("thread-1");
  return {
    id,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
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
    branch: "feature",
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
    createdAt: ago(30 * DAY_MS),
    updatedAt: ago(2 * DAY_MS),
    archivedAt: null,
    settledOverride: "settled",
    settledAt: ago(2 * DAY_MS),
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

/**
 * A repository with a bare origin and one managed worktree on `feature` holding one commit.
 * Every path lives inside `root`, the test's own temporary directory.
 */
const landedFixture = (root: string, storageCleanup: Partial<StorageCleanupSettings> = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const git = yield* GitVcsDriver.GitVcsDriver;
    const runner = yield* ProcessRunner.make();
    const command = (cwd: string, args: string[]) =>
      git.execute({ operation: "landed-worktree-test", cwd, args });
    const revParse = (cwd: string, revision: string) =>
      command(cwd, ["rev-parse", "--verify", "--quiet", revision]).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.orElseSucceed(() => null),
      );
    const repo = `${root}/repo`;
    const remote = `${root}/origin.git`;
    yield* fs.makeDirectory(repo);
    yield* command(root, ["init", "--bare", "-b", "main", remote]);
    yield* command(repo, ["init", "-b", "main"]);
    yield* command(repo, ["config", "user.email", "landed@example.test"]);
    yield* command(repo, ["config", "user.name", "Landed test"]);
    yield* fs.writeFileString(`${repo}/tracked.txt`, "original\n");
    yield* fs.writeFileString(
      `${repo}/.gitignore`,
      ".env.local\n.t3/\ndist/\nnode_modules/\n*.tsbuildinfo\n",
    );
    yield* command(repo, ["add", "."]);
    yield* command(repo, ["commit", "-m", "initial"]);
    yield* command(repo, ["remote", "add", "origin", remote]);
    yield* command(repo, ["push", "-u", "origin", "main"]);
    yield* command(repo, ["remote", "set-head", "origin", "main"]);
    const initial = (yield* revParse(repo, "HEAD"))!;

    yield* fs.makeDirectory(config.worktreesDir, { recursive: true });
    /** A ready checkpoint of the branch's current head, as a finished turn leaves one. */
    const checkpoint = (worktree: string, branch: string) =>
      Effect.gen(function* () {
        const tree = (yield* revParse(worktree, "HEAD^{tree}"))!;
        const commit = yield* command(worktree, [
          "commit-tree",
          tree,
          "-p",
          "HEAD",
          "-m",
          "checkpoint",
        ]);
        yield* command(worktree, [
          "update-ref",
          `refs/t3/checkpoints/${branch}`,
          commit.stdout.trim(),
        ]);
      });
    const addWorktree = (branch: string) =>
      Effect.gen(function* () {
        const worktree = `${config.worktreesDir}/${branch}`;
        yield* command(repo, ["worktree", "add", "-b", branch, worktree]);
        yield* fs.writeFileString(`${worktree}/${branch}.txt`, "work\n");
        yield* command(worktree, ["add", "."]);
        yield* command(worktree, ["commit", "-m", `${branch} work`]);
        yield* checkpoint(worktree, branch);
        return worktree;
      });
    const worktree = yield* addWorktree("feature");
    /**
     * Lands the branch on origin's main. The local tracking ref follows only when `fetched`, as
     * after the user's own fetch or pull.
     */
    const land = (branch = "feature", fetched = true) =>
      Effect.gen(function* () {
        yield* command(repo, ["push", "origin", branch]);
        const head = (yield* revParse(repo, `refs/heads/${branch}`))!;
        // Git may refuse implicit bare repositories (safe.bareRepository=explicit).
        yield* command(root, ["--git-dir", remote, "update-ref", "refs/heads/main", head]);
        if (fetched) yield* command(repo, ["fetch", "origin"]);
      });

    let settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      storageCleanup: {
        ...DEFAULT_SERVER_SETTINGS.storageCleanup,
        browserArtifactsAfterDays: null,
        ...storageCleanup,
      },
    };
    let threads = [holder({ worktreePath: worktree })];
    let deletedThreads: ReadonlyArray<OrchestrationV2ThreadShell> = [];
    const withoutCheckpoint = new Set<string>();
    let afterWorktreeRemove: Effect.Effect<void, GitCommandError> | undefined;
    let fetches = 0;
    const networkCommands: string[] = [];
    let pullRequestRefreshes = 0;
    let processCwd: string | null = null;
    let sweeps = 0;
    const activated = yield* Deferred.make<void>();
    let events: Stream.Stream<OrchestrationV2DomainEvent> = Stream.never;
    const context = yield* Layer.build(StorageCleanup.layer).pipe(
      Effect.provideService(GitVcsDriver.GitVcsDriver, {
        ...git,
        execute: (input) =>
          Effect.gen(function* () {
            const network = input.args.find((arg) => arg === "fetch" || arg === "ls-remote");
            if (network !== undefined) networkCommands.push(network);
            const result = yield* git.execute(input);
            if (
              afterWorktreeRemove !== undefined &&
              input.args.includes("worktree") &&
              input.args.includes("remove")
            )
              yield* afterWorktreeRemove;
            return result;
          }),
        fetchRemoteTrackingBranch: (input) =>
          Effect.suspend(() => {
            fetches++;
            return git.fetchRemoteTrackingBranch(input);
          }),
      }),
      Effect.provideService(ProcessRunner.ProcessRunner, {
        run: (input) =>
          input.command === "/usr/sbin/lsof"
            ? Effect.sync(() => ({
                stdout: processCwd === null ? "" : `p42\nn${processCwd}\n`,
                stderr: "",
                code: 0,
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
        // Each sweep lists projects once, for its orphan worktree report.
        list: () =>
          Effect.sync(() => {
            sweeps++;
            return [{ workspaceRoot: repo }];
          }),
        listShells: () =>
          Effect.succeed([
            {
              id: ProjectId.make("project-1"),
              title: "Project",
              workspaceRoot: repo,
              createdAt: DateTime.formatIso(ago(30 * DAY_MS)),
            },
          ]),
      } as unknown as ProjectStore.ProjectStoreV2["Service"]),
      Effect.provideService(ProjectionStore.ProjectionStoreV2, {
        getShellSnapshot: () =>
          Effect.sync(() => ({
            threads: threads.filter((thread) => thread.archivedAt === null),
            archivedThreads: threads.filter((thread) => thread.archivedAt !== null),
          })),
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
        getCheckpointContext: (threadId: ThreadId) =>
          Effect.sync(() => {
            const thread = threads.find((candidate) => candidate.id === threadId);
            const runId = RunId.make(`run-${threadId}`);
            return withoutCheckpoint.has(threadId) || thread?.worktreePath == null
              ? { runs: [], checkpointScopes: [], checkpoints: [] }
              : {
                  runs: [],
                  checkpointScopes: [
                    { id: `scope-${threadId}`, runId, kind: "root_run", cwd: thread.worktreePath },
                  ],
                  checkpoints: [
                    {
                      scopeId: `scope-${threadId}`,
                      runId,
                      ordinalWithinScope: 1,
                      appRunOrdinal: 1,
                      status: "ready",
                      ref: `refs/t3/checkpoints/${thread.branch}`,
                    },
                  ],
                };
          }),
      } as unknown as ProjectionStore.ProjectionStoreV2["Service"]),
      Effect.provideService(ProviderSessionManager.ProviderSessionManagerV2, {
        isLive: () => Effect.succeed(false),
      } as unknown as ProviderSessionManager.ProviderSessionManagerV2["Service"]),
      Effect.provideService(Orchestrator.OrchestratorV2, {
        streamDomainEvents: Stream.suspend(() => events),
      } as unknown as Orchestrator.OrchestratorV2["Service"]),
      Effect.provideService(SqlClient.SqlClient, ((strings: TemplateStringsArray) =>
        Effect.sync(() => {
          const query = strings.join("");
          if (query.includes('AS "worktreePath"'))
            return threads.flatMap((thread) =>
              thread.worktreePath === null ? [] : [{ worktreePath: thread.worktreePath }],
            );
          if (query.includes("deleted_at IS NOT NULL"))
            return deletedThreads.map((thread) => ({
              payload_json: encodeThread({
                ...thread,
                lastVisitedAt: thread.lastVisitedAt ?? null,
                deletedAt: ago(DAY_MS),
              }),
              workspaceRoot: repo,
            }));
          return [];
        })) as unknown as SqlClient.SqlClient),
      Effect.provideService(GitManager.GitManager, {
        invalidateStatus: () => Effect.void,
        branchPullRequest: () =>
          Effect.sync(() => {
            pullRequestRefreshes++;
            return null;
          }),
      } as unknown as GitManager.GitManager["Service"]),
      Effect.provideService(TerminalManager.TerminalManager, {
        subscribeMetadata: () => Effect.succeed(() => undefined),
      } as unknown as TerminalManager.TerminalManager["Service"]),
      // Automatic sweeps stay parked unless a test activates them; most run the sweep they inspect.
      Effect.provideService(ServerActivation, Deferred.await(activated)),
    );
    const service = Context.get(context, StorageCleanup.StorageCleanup);
    const sweep = Effect.gen(function* () {
      const report = yield* service.runNow;
      return {
        report,
        entry: (path: string) => report.entries.find((candidate) => candidate.path === path),
      };
    });
    return {
      fs,
      root,
      repo,
      worktree,
      worktreesDir: config.worktreesDir,
      initial,
      command,
      revParse,
      addWorktree,
      land,
      sweep,
      service,
      fetches: () => fetches,
      networkCommands: () => networkCommands,
      pullRequestRefreshes: () => pullRequestRefreshes,
      sweeps: () => sweeps,
      setThreads: (next: ReadonlyArray<OrchestrationV2ThreadShell>) => {
        threads = [...next];
      },
      setDeletedThreads: (next: ReadonlyArray<OrchestrationV2ThreadShell>) => {
        deletedThreads = next;
      },
      setProcessCwd: (cwd: string) => {
        processCwd = cwd;
      },
      /** Starts the parked startup and hourly sweeps and the domain event subscription. */
      activate: (domainEvents: Stream.Stream<OrchestrationV2DomainEvent>) => {
        events = domainEvents;
        return Deferred.succeed(activated, undefined);
      },
      setStorageCleanup: (patch: Partial<StorageCleanupSettings>) => {
        settings = { ...settings, storageCleanup: { ...settings.storageCleanup, ...patch } };
      },
      dropCheckpoint: (threadId: ThreadId) => {
        withoutCheckpoint.add(threadId);
      },
      afterWorktreeRemove: (effect: Effect.Effect<void, GitCommandError>) => {
        afterWorktreeRemove = effect;
      },
    };
  });

const runLanded = <A, E>(
  body: (
    fixture: Effect.Success<ReturnType<typeof landedFixture>>,
  ) => Effect.Effect<A, E, FileSystem.FileSystem>,
  // Settings the service starts with, which its event triggers read until a settings change.
  storageCleanup?: Partial<StorageCleanupSettings>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "landed-" }));
    return yield* landedFixture(root, storageCleanup).pipe(
      Effect.flatMap(body),
      // The fixture mocks lsof, so every runner takes the macOS process inspection path.
      Effect.provideService(HostProcess.Platform, "darwin"),
      Effect.provide(
        GitVcsDriver.layer.pipe(
          Layer.provideMerge(ServerConfig.layerTest(process.cwd(), `${root}/home`)),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("landed worktree cleanup", () => {
  it.live("is on by default and removes a landed worktree and its branch", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        const { entry } = yield* fixture.sweep;
        expect(entry(fixture.worktree)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch deleted",
          threadId: "thread-1",
        });
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(false);
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).toBeNull();
        expect(
          (yield* fixture.command(fixture.repo, ["config", "--get-regexp", "^branch\\."])).stdout,
        ).not.toContain("branch.feature.");
      }),
    ),
  );

  it.live("keeps a worktree whose commits are not on the default branch", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        const { entry } = yield* fixture.sweep;
        expect(entry(fixture.worktree)).toMatchObject({
          outcome: "kept",
          reason: "Has commits not on main",
        });
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(true);
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).not.toBeNull();
      }),
    ),
  );

  it.live("keeps a landed worktree with tracked edits or untracked files", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        yield* fixture.fs.writeFileString(`${fixture.worktree}/tracked.txt`, "edited\n");
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "kept",
          reason: "Has uncommitted changes (1 file)",
        });
        yield* fixture.command(fixture.worktree, ["checkout", "--", "tracked.txt"]);
        // The landing rule protects untracked files even when cleanup is set to edited files only.
        fixture.setStorageCleanup({ worktreeKeepWhen: "tracked-changes" });
        yield* fixture.fs.writeFileString(`${fixture.worktree}/notes.txt`, "notes\n");
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "kept",
          reason: "Has uncommitted changes (1 file)",
        });
        expect(yield* fixture.fs.readFileString(`${fixture.worktree}/notes.txt`)).toBe("notes\n");
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).not.toBeNull();
      }),
    ),
  );

  it.live("waits until every thread sharing the worktree is settled and idle", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        const worktreePath = fixture.worktree;
        const second = ThreadId.make("thread-2");
        fixture.setThreads([
          holder({ worktreePath }),
          holder({ id: second, worktreePath, settledOverride: null, settledAt: null }),
        ]);
        expect((yield* fixture.sweep).entry(worktreePath)).toMatchObject({
          outcome: "kept",
          reason: "1 of 2 threads are not settled or archived",
        });
        fixture.setThreads([
          holder({ worktreePath }),
          holder({ id: second, worktreePath, status: "running", activeRunId: RunId.make("run") }),
        ]);
        expect((yield* fixture.sweep).entry(worktreePath)).toMatchObject({
          outcome: "kept",
          reason: "Thread is running or has pending work",
        });
        expect(yield* fixture.fs.exists(worktreePath)).toBe(true);
        fixture.setThreads([holder({ worktreePath }), holder({ id: second, worktreePath })]);
        expect((yield* fixture.sweep).entry(worktreePath)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch deleted",
        });
      }),
    ),
  );

  it.live("counts an archived thread as done", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        const worktreePath = fixture.worktree;
        fixture.setThreads([
          holder({ worktreePath }),
          holder({
            id: ThreadId.make("thread-2"),
            worktreePath,
            settledOverride: null,
            settledAt: null,
            archivedAt: ago(DAY_MS),
          }),
        ]);
        expect((yield* fixture.sweep).entry(worktreePath)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch deleted",
        });
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).toBeNull();
      }),
    ),
  );

  it.live("lets a subagent chain follow its owner", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        const worktreePath = fixture.worktree;
        const owner = holder({ worktreePath, settledOverride: null, settledAt: null });
        const subagent = holder({
          id: ThreadId.make("subagent"),
          worktreePath,
          settledOverride: null,
          settledAt: null,
          lineage: {
            rootThreadId: owner.id,
            parentThreadId: owner.id,
            relationshipToParent: "subagent",
          },
        });
        fixture.setThreads([owner, subagent]);
        expect((yield* fixture.sweep).entry(worktreePath)).toMatchObject({
          outcome: "kept",
          reason: "Thread is not settled or archived",
        });
        fixture.setThreads([
          { ...owner, settledOverride: "settled", settledAt: ago(DAY_MS) },
          subagent,
        ]);
        expect((yield* fixture.sweep).entry(worktreePath)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch deleted",
        });
      }),
    ),
  );

  it.live("removes the worktree but keeps a branch another worktree has checked out", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        const head = yield* fixture.revParse(fixture.repo, "refs/heads/feature");
        yield* fixture.command(fixture.repo, [
          "worktree",
          "add",
          "--force",
          `${fixture.root}/elsewhere`,
          "feature",
        ]);
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch kept because another worktree has it checked out",
        });
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(false);
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).toBe(head);
      }),
    ),
  );

  it.live("keeps a branch whose head moved after verification", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        fixture.afterWorktreeRemove(
          fixture.command(fixture.repo, ["update-ref", "refs/heads/feature", fixture.initial]),
        );
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch kept because it moved after the check",
        });
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).toBe(fixture.initial);
      }),
    ),
  );

  it.live("keeps the branch when a thread has no checkpoint to restore it from", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        fixture.dropCheckpoint(ThreadId.make("thread-1"));
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "removed",
          reason:
            "Landed on main; branch kept because a thread has no checkpoint to restore it from",
        });
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).not.toBeNull();
      }),
    ),
  );

  it.live("decides from the last fetch and never contacts the remote", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land("feature", false);
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "kept",
          reason: "Has commits not on main",
        });
        yield* fixture.command(fixture.repo, ["fetch", "origin"]);
        // Unreachable, like an SSH remote whose key approval would block a background fetch.
        yield* fixture.command(fixture.repo, [
          "remote",
          "set-url",
          "origin",
          `${fixture.root}/missing.git`,
        ]);
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch deleted",
        });
        expect(fixture.fetches()).toBe(0);
        expect(fixture.networkCommands()).toEqual([]);
      }),
    ),
  );

  it.live("keeps worktrees while the default branch is unknown locally", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        yield* fixture.command(fixture.repo, ["update-ref", "-d", "refs/remotes/origin/main"]);
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "kept",
          reason: "Default branch is unknown locally",
        });
        yield* fixture.command(fixture.repo, ["remote", "set-head", "origin", "--delete"]);
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "kept",
          reason: "Default branch is unknown locally",
        });
        expect(fixture.networkCommands()).toEqual([]);
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(true);
      }),
    ),
  );

  it.live("leaves the unchanged rule's refresh, once per repository per sweep, in place", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        fixture.setStorageCleanup({ worktreeUnchanged: true });
        const other = yield* fixture.addWorktree("other");
        fixture.setThreads([
          holder({ worktreePath: fixture.worktree }),
          holder({ id: ThreadId.make("thread-2"), worktreePath: other, branch: "other" }),
        ]);
        const first = yield* fixture.sweep;
        expect(fixture.fetches()).toBe(1);
        expect(first.entry(other)).toMatchObject({ reason: "Has commits not on main" });
        yield* fixture.command(fixture.repo, [
          "remote",
          "set-url",
          "origin",
          `${fixture.root}/missing.git`,
        ]);
        const offline = yield* fixture.sweep;
        expect(fixture.fetches()).toBe(2);
        for (const path of [fixture.worktree, other])
          expect(offline.entry(path)).toMatchObject({ outcome: "failed" });
      }),
    ),
  );

  it.live("keeps ignored local files but not dependency or build output", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        const { fs, worktree } = fixture;
        yield* fixture.land();
        yield* fs.writeFileString(`${worktree}/.env.local`, "SECRET=1\n");
        expect((yield* fixture.sweep).entry(worktree)).toMatchObject({
          outcome: "kept",
          reason: "Has ignored local files such as .env.local",
        });
        yield* fs.remove(`${worktree}/.env.local`);
        yield* fs.makeDirectory(`${worktree}/.t3/userdata`, { recursive: true });
        yield* fs.writeFileString(`${worktree}/.t3/userdata/statev2.sqlite`, "dev data");
        expect((yield* fixture.sweep).entry(worktree)).toMatchObject({
          outcome: "kept",
          reason: "Has ignored local files such as .t3/",
        });
        expect(yield* fs.exists(`${worktree}/.t3/userdata/statev2.sqlite`)).toBe(true);
        // An emptied ignored folder holds nothing to lose.
        yield* fs.remove(`${worktree}/.t3/userdata`, { recursive: true });
        for (const directory of ["dist", "node_modules/pkg", "packages/web/dist"])
          yield* fs.makeDirectory(`${worktree}/${directory}`, { recursive: true });
        yield* fs.writeFileString(`${worktree}/dist/app.js`, "built");
        yield* fs.writeFileString(`${worktree}/node_modules/pkg/index.js`, "dependency");
        yield* fs.writeFileString(`${worktree}/packages/web/dist/app.js`, "built");
        yield* fs.writeFileString(`${worktree}/tsconfig.tsbuildinfo`, "{}");
        expect((yield* fixture.sweep).entry(worktree)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch deleted",
        });
        expect(yield* fs.exists(worktree)).toBe(false);
      }),
    ),
  );

  it.live("keeps the branch when its latest checkpoint is older than the branch", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        // A commit made outside a turn, such as Commit and push, has no checkpoint yet.
        yield* fixture.fs.writeFileString(`${fixture.worktree}/later.txt`, "later\n");
        yield* fixture.command(fixture.worktree, ["add", "later.txt"]);
        yield* fixture.command(fixture.worktree, ["commit", "-m", "later"]);
        const head = yield* fixture.revParse(fixture.repo, "refs/heads/feature");
        yield* fixture.land();
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "removed",
          reason:
            "Landed on main; branch kept because its latest checkpoint is older than the branch",
        });
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).toBe(head);
      }),
    ),
  );

  it.live("never deletes the default branch a managed worktree checks out", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        // The root moves off main so a managed worktree can check out main itself.
        yield* fixture.command(fixture.repo, ["switch", "-c", "elsewhere"]);
        const mainWorktree = `${fixture.worktreesDir}/main`;
        yield* fixture.command(fixture.repo, ["worktree", "add", mainWorktree, "main"]);
        fixture.setThreads([holder({ worktreePath: mainWorktree, branch: "main" })]);
        expect((yield* fixture.sweep).entry(mainWorktree)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch kept because it is the default branch",
        });
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/main")).toBe(fixture.initial);
      }),
    ),
  );

  it.live("keeps the branch when a thread starts on the worktree during removal", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        const worktreePath = fixture.worktree;
        fixture.afterWorktreeRemove(
          Effect.sync(() =>
            fixture.setThreads([
              holder({ worktreePath }),
              holder({
                id: ThreadId.make("thread-2"),
                worktreePath,
                settledOverride: null,
                settledAt: null,
              }),
            ]),
          ),
        );
        expect((yield* fixture.sweep).entry(worktreePath)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch kept because the threads using it changed during cleanup",
        });
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).not.toBeNull();
      }),
    ),
  );

  it.live("keeps a landed worktree that a program is using", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        fixture.setProcessCwd(`${fixture.worktree}/src`);
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "kept",
          reason: "A process is using the project folder",
        });
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(true);
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).not.toBeNull();
      }),
    ),
  );

  it.live("leaves a deleted thread's worktree that did not land to the deletion rule", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        fixture.setStorageCleanup({ worktreeOnMerge: true });
        fixture.setThreads([]);
        fixture.setDeletedThreads([holder({ worktreePath: fixture.worktree })]);
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "kept",
          reason: "Has commits not on main",
        });
        expect(fixture.pullRequestRefreshes()).toBe(0);
        expect(fixture.networkCommands()).toEqual([]);
        yield* fixture.land();
        expect((yield* fixture.sweep).entry(fixture.worktree)).toMatchObject({
          outcome: "removed",
          reason: "Landed on main; branch deleted",
        });
        expect(yield* fixture.revParse(fixture.repo, "refs/heads/feature")).toBeNull();
      }),
    ),
  );

  it.live.each([
    ["only the landing rule", 1, false],
    ["deleted-thread cleanup too", 2, true],
  ] as const)("an archive during a sweep with %s makes %i sweep(s)", ([, count, onDelete]) =>
    runLanded(
      (fixture) =>
        Effect.gen(function* () {
          yield* fixture.land();
          const removing = yield* Deferred.make<void>();
          const resume = yield* Deferred.make<void>();
          const handled = yield* Deferred.make<void>();
          fixture.afterWorktreeRemove(
            Deferred.succeed(removing, undefined).pipe(Effect.andThen(Deferred.await(resume))),
          );
          const archived = holder({ id: ThreadId.make("archived"), archivedAt: ago(0) });
          yield* fixture.activate(
            Stream.fromEffect(Deferred.await(removing)).pipe(
              Stream.as<OrchestrationV2DomainEvent>({
                id: EventId.make("archived"),
                type: "thread.archived",
                threadId: archived.id,
                occurredAt: ago(0),
                payload: { ...archived, lastVisitedAt: null },
              }),
              Stream.concat(
                Stream.fromEffect(Deferred.succeed(handled, undefined)).pipe(Stream.drain),
              ),
            ),
          );
          yield* Deferred.await(handled);
          yield* Deferred.succeed(resume, undefined);
          yield* fixture.service.drain;
          expect(fixture.sweeps()).toBe(count);
          expect(yield* fixture.fs.exists(fixture.worktree)).toBe(false);
        }),
      { worktreeOnDelete: onDelete },
    ),
  );

  it.live("keeps a landed worktree once the landing rule is turned off", () =>
    runLanded((fixture) =>
      Effect.gen(function* () {
        yield* fixture.land();
        fixture.setStorageCleanup({ worktreeOnLand: false });
        const { report } = yield* fixture.sweep;
        expect(report.entries.filter((entry) => entry.kind === "worktree")).toEqual([]);
        expect(yield* fixture.fs.exists(fixture.worktree)).toBe(true);
      }),
    ),
  );
});
