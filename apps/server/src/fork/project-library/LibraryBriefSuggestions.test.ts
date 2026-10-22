import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import {
  BRIEF_SUGGESTION_RUNS_PER_DAY,
  LibraryError,
  type LibraryBriefSuggestionMode,
  type LibraryProject,
  type LibraryResolvedBinding,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as ServerConfig from "../../config.ts";
import * as ThreadLaunch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { emptyProjection } from "../../orchestration-v2/ProjectionStore.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { resource } from "./Library.testkit.ts";
import * as Suggestions from "./LibraryBriefSuggestions.ts";
import * as LibraryPublisher from "./LibraryPublisher.ts";
import * as LibraryService from "./LibraryService.ts";
import * as LibraryWorkspaceStore from "./LibraryWorkspaceStore.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";

function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}

const computer = EnvironmentId.make("computer");
const localProjectId = ProjectId.make("local-project");
const noAssets = Layer.succeed(Assets.LibraryAssetService, {
  mode: "local",
  find: () => Effect.fail(new LibraryError({ reason: "not-found" })),
  read: () => Effect.fail(new LibraryError({ reason: "not-found" })),
  put: () => Effect.fail(new LibraryError({ reason: "io" })),
  url: () => Effect.succeed(null),
});
const libraryLayer = LibraryService.layer.pipe(
  Layer.provide(noAssets),
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
  ),
  Layer.provide(
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(computer) }),
  ),
);
// These tests run on the Library itself, so suggestions read and propose through it directly.
const noPublisher = partial<LibraryPublisher.LibraryPublisher["Service"]>({ enabled: false });
const isLibraryError = Schema.is(LibraryError);

const settledThread = (id: string): OrchestrationV2AppThread => ({
  id: ThreadId.make(id),
  projectId: localProjectId,
  title: `Work ${id}`,
  providerInstanceId: ProviderInstanceId.make("claude"),
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
  forkedFrom: null,
  createdBy: "user",
  creationSource: "web",
  createdAt: DateTime.makeUnsafe(0),
  updatedAt: DateTime.makeUnsafe(0),
  archivedAt: null,
  settledOverride: "settled",
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
});

const threadShell = (
  id: string,
  worktreePath: string | null = null,
): OrchestrationV2ThreadShell => ({
  ...settledThread(id),
  worktreePath,
  latestRunId: null,
  activeRunId: null,
  status: "idle",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: null,
  hasActionableProposedPlan: false,
  pendingBackgroundTasks: [],
  providerInstanceHistory: [],
  itemCount: 0,
  visibleItemCount: 0,
});

/**
 * A computer with one Library project. Launches behave like the real service: one thread per
 * command id, however often it is repeated.
 */
const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  const library = yield* LibraryService.LibraryService.pipe(Effect.provide(libraryLayer));
  let project = yield* library.createProject({
    requestId: "create",
    title: "AspectAvy",
    brief: "Ship the viewer.",
    resources: [resource],
  });
  const setMode = Effect.fnUntraced(function* (mode: LibraryBriefSuggestionMode) {
    project = yield* library.updateProject({
      requestId: `mode-${mode}-${project.revision}`,
      projectId: project.id,
      expectedRevision: project.revision,
      title: project.title,
      brief: project.brief,
      resources: project.resources,
      profile: { briefSuggestions: mode },
    });
  });
  const binding = (threadId: ThreadId, bound: LibraryProject): LibraryResolvedBinding => ({
    cwd: "/copies/aspectavy",
    localProjectId,
    repositoryPaths: [],
    binding: {
      projectId: bound.id,
      projectRevision: bound.revision,
      workingCopyId: "copy",
      environmentId: computer,
      resourceIds: [resource.id],
    },
  });
  const unbound = new Set<string>(["unbound"]);
  const runBindings = new Map<
    string,
    { resolved: LibraryResolvedBinding; project: LibraryProject }
  >();
  const workspaces = partial<LibraryWorkspaceStore.LibraryWorkspaceStore["Service"]>({
    getBinding: (threadId) =>
      Effect.sync(() => (unbound.has(threadId) ? null : binding(threadId, project))),
    getBoundProject: () => Effect.succeed(project),
    validateThreadCwd: (input) => Effect.succeed(input.cwd),
    bind: (threadId, resolved, pinned) =>
      Effect.sync(() => {
        if (pinned === undefined) throw new Error("The suggestion must pin its source project.");
        runBindings.set(threadId, { resolved, project: pinned });
      }),
  });
  const launched = new Map<string, ThreadLaunch.ThreadLaunchInput>();
  const launchCalls: Array<ThreadLaunch.ThreadLaunchInput> = [];
  const launches = partial<ThreadLaunch.ThreadLaunchService["Service"]>({
    launch: (input) =>
      Effect.sync(() => {
        launchCalls.push(input);
        const resumed = launched.has(input.commandId);
        if (!resumed) launched.set(input.commandId, input);
        const thread = settledThread(input.threadId!);
        return {
          threadId: input.threadId!,
          projection: {
            ...emptyProjection({
              type: "thread.created",
              id: EventId.make(`created-${thread.id}`),
              threadId: thread.id,
              occurredAt: thread.createdAt,
              payload: thread,
            }),
            runs: [
              {
                id: RunId.make(`run-${input.threadId}`),
                threadId: thread.id,
                ordinal: 1,
                providerInstanceId: thread.providerInstanceId,
                modelSelection: thread.modelSelection,
                providerThreadId: null,
                userMessageId: MessageId.make(`message-${input.threadId}`),
                rootNodeId: null,
                activeAttemptId: null,
                status: "running",
                requestedAt: thread.createdAt,
                startedAt: thread.createdAt,
                completedAt: null,
                checkpointId: null,
                contextHandoffId: null,
              },
            ],
          },
          resumed,
        } satisfies ThreadLaunch.ThreadLaunchResult;
      }),
  });
  const settledRuns: Array<string> = [];
  const threads = partial<ThreadManagement.ThreadManagementService["Service"]>({
    settleAfterRun: (input) => Effect.sync(() => void settledRuns.push(input.runId)),
    getThreadShell: (threadId) => Effect.succeed(threadShell(threadId)),
  });
  // A fresh instance over the same database is what a restart gives.
  const start = Layer.build(Suggestions.layer).pipe(
    Effect.map(Context.get(Suggestions.LibraryBriefSuggestions)),
    Effect.provideService(LibraryPublisher.LibraryPublisher, noPublisher),
    Effect.provideService(LibraryService.LibraryService, library),
    Effect.provideService(LibraryWorkspaceStore.LibraryWorkspaceStore, workspaces),
    Effect.provideService(ThreadLaunch.ThreadLaunchService, launches),
    Effect.provideService(ThreadManagement.ThreadManagementService, threads),
  );
  return {
    library,
    project: () => project,
    setMode,
    unbound,
    launched,
    launchCalls,
    runBindings,
    settledRuns,
    threads,
    workspaces,
    launches,
    start,
  };
});

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  );

describe("Library brief suggestions", () => {
  it.effect.each([false, true])("starts in a bound Library copy (worktree: %s)", (inWorktree) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.setMode("automatic");
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const cwd = inWorktree ? `${root}/worktree` : root;
        if (inWorktree) yield* fs.makeDirectory(cwd);
        const workspaces = yield* Layer.build(
          LibraryWorkspaceStore.layer.pipe(
            Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "brief-copy-" })),
            Layer.provide(
              Layer.succeed(ServerEnvironmentIdentity, {
                getEnvironmentId: Effect.succeed(computer),
              }),
            ),
            Layer.provide(Layer.succeed(HostProcess.HomeDirectory, root)),
          ),
        ).pipe(Effect.map(Context.get(LibraryWorkspaceStore.LibraryWorkspaceStore)));
        const pinned = f.project();
        const resolved: LibraryResolvedBinding = {
          cwd,
          localProjectId,
          repositoryPaths: [],
          binding: {
            projectId: pinned.id,
            projectRevision: pinned.revision,
            workingCopyId: "copy",
            environmentId: computer,
            resourceIds: [],
          },
        };
        yield* workspaces.put({
          requestId: "copy",
          fingerprint: "copy",
          project: pinned,
          copy: {
            id: "copy",
            projectId: pinned.id,
            projectRevision: pinned.revision,
            environmentId: computer,
            rootPath: root,
            rootLocalProjectId: localProjectId,
            repositories: [],
            ownership: "managed",
            state: "ready",
            createdAt: pinned.createdAt,
            updatedAt: pinned.updatedAt,
          },
          rootLocalProjectId: localProjectId,
          rootCheckpointRepository: true,
          legacyThreadIds: [],
          rootIdentity: null,
          releaseRequestId: null,
          releaseReviewToken: null,
          removalPath: null,
          archivePath: null,
          archiveDigest: null,
        });
        const source = settledThread("bound-source");
        yield* workspaces.bind(source.id, resolved, pinned);
        const launches = partial<ThreadLaunch.ThreadLaunchService["Service"]>({
          launch: (input) =>
            workspaces
              .validateThreadCwd({
                threadId: input.threadId!,
                localProjectId: input.projectId,
                cwd:
                  input.workspaceStrategy.type === "existing_worktree"
                    ? input.workspaceStrategy.worktreePath
                    : root,
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new ThreadLaunch.ThreadLaunchError({
                      operation: "resolve-project",
                      commandId: input.commandId,
                      projectId: input.projectId,
                      threadId: input.threadId,
                      cause,
                    }),
                ),
                Effect.andThen(f.launches.launch(input)),
              ),
        });
        const threads = partial<ThreadManagement.ThreadManagementService["Service"]>({
          settleAfterRun: f.threads.settleAfterRun,
          getThreadShell: (threadId) =>
            Effect.succeed(threadShell(threadId, inWorktree ? cwd : null)),
        });
        const suggestions = yield* Layer.build(Suggestions.layer).pipe(
          Effect.map(Context.get(Suggestions.LibraryBriefSuggestions)),
          Effect.provideService(LibraryPublisher.LibraryPublisher, noPublisher),
          Effect.provideService(LibraryService.LibraryService, f.library),
          Effect.provideService(LibraryWorkspaceStore.LibraryWorkspaceStore, workspaces),
          Effect.provideService(ThreadLaunch.ThreadLaunchService, launches),
          Effect.provideService(ThreadManagement.ThreadManagementService, threads),
        );
        yield* suggestions.settled(source);

        const suggestion = yield* suggestions.suggestion({ threadId: source.id });
        expect(suggestion?.status).toBe("started");
        expect(f.launchCalls).toHaveLength(1);
        expect(yield* workspaces.getBinding(suggestion!.runThreadId!)).toEqual(resolved);
        expect(yield* workspaces.getBoundProject(suggestion!.runThreadId!)).toEqual(pinned);
      }),
    ),
  );

  it.effect("does nothing when the project setting is off", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const suggestions = yield* f.start;
        yield* suggestions.settled(settledThread("thread-1"));
        yield* f.setMode("off");
        yield* suggestions.settled(settledThread("thread-2"));

        expect(f.launchCalls).toEqual([]);
        expect(yield* suggestions.suggestion({ threadId: ThreadId.make("thread-1") })).toBeNull();
        expect(yield* suggestions.suggestion({ threadId: ThreadId.make("thread-2") })).toBeNull();
      }),
    ),
  );

  it.effect("ignores conversations that are not bound to a Library project", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.setMode("automatic");
        const suggestions = yield* f.start;
        yield* suggestions.settled(settledThread("unbound"));
        expect(f.launchCalls).toEqual([]);
        expect(yield* suggestions.suggestion({ threadId: ThreadId.make("unbound") })).toBeNull();
      }),
    ),
  );

  it.effect("automatic starts one run with the thread's model and links its one proposal", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.setMode("automatic");
        const suggestions = yield* f.start;
        const thread = settledThread("thread-1");
        yield* suggestions.settled(thread);
        yield* suggestions.settled(thread);

        expect(f.launchCalls).toHaveLength(1);
        const launch = f.launchCalls[0]!;
        expect(launch).toMatchObject({
          projectId: localProjectId,
          modelSelection: thread.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          createdBy: "system",
        });
        expect(launch.threadId).not.toBe(thread.id);
        expect(f.runBindings.get(launch.threadId!)).toMatchObject({
          resolved: {
            localProjectId,
            binding: {
              projectId: f.project().id,
              workingCopyId: "copy",
              resourceIds: [resource.id],
            },
          },
          project: f.project(),
        });
        expect(launch.initialMessage?.text).toContain(`threadId ${thread.id}`);
        expect(launch.initialMessage?.text).toContain("loom_library_brief_propose once");
        // The run settles itself in the background once its turn ends.
        yield* Effect.yieldNow;
        expect(f.settledRuns).toEqual([`run-${launch.threadId}`]);

        const started = yield* suggestions.suggestion({ threadId: thread.id });
        expect(started).toMatchObject({
          threadId: thread.id,
          projectId: f.project().id,
          mode: "automatic",
          status: "started",
          runThreadId: launch.threadId,
        });

        // The run proposes as itself; the proposal is recorded as the conversation it read.
        const runSource = {
          kind: "conversation" as const,
          environmentId: computer,
          threadId: launch.threadId!,
        };
        const request = {
          requestId: "suggest",
          projectId: f.project().id,
          baseRevision: f.project().revision,
          proposedBrief: "Ship the viewer. Export as STEP.",
          summary: "The conversation chose STEP export.",
        };
        const proposal = yield* suggestions.propose(request, runSource);
        expect(proposal.source).toEqual({ ...runSource, threadId: thread.id });
        expect(yield* suggestions.suggestion({ threadId: thread.id })).toMatchObject({
          proposalId: proposal.id,
        });

        const second = yield* suggestions
          .propose({ ...request, requestId: "again" }, runSource)
          .pipe(Effect.result);
        expect(second._tag === "Failure" && isLibraryError(second.failure)).toBe(true);
        expect(second._tag === "Failure" ? second.failure.reason : null).toBe("blocked");
        const page = yield* f.library.briefProposals({ projectId: f.project().id });
        expect(page.proposals).toHaveLength(1);

        // The run settling is not a conversation of its own to suggest from.
        yield* suggestions.settled(settledThread(launch.threadId!));
        expect(f.launchCalls).toHaveLength(1);
      }),
    ),
  );

  it.effect("refuses runs past the daily limit and records why", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.setMode("automatic");
        const suggestions = yield* f.start;
        for (let index = 0; index <= BRIEF_SUGGESTION_RUNS_PER_DAY; index++)
          yield* suggestions.settled(settledThread(`thread-${index}`));

        expect(f.launchCalls).toHaveLength(BRIEF_SUGGESTION_RUNS_PER_DAY);
        const refused = yield* suggestions.suggestion({
          threadId: ThreadId.make(`thread-${BRIEF_SUGGESTION_RUNS_PER_DAY}`),
        });
        expect(refused).toMatchObject({ status: "skipped", reason: "daily-limit" });
        expect(refused?.runThreadId).toBeUndefined();

        // A day later the project may run again.
        yield* TestClock.adjust("25 hours");
        yield* suggestions.settled(settledThread("tomorrow"));
        expect(f.launchCalls).toHaveLength(BRIEF_SUGGESTION_RUNS_PER_DAY + 1);
      }),
    ),
  );

  it.effect("a restart neither repeats a started run nor starts a second one", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.setMode("automatic");
        const before = yield* f.start;
        yield* before.settled(settledThread("thread-1"));
        expect(f.launchCalls).toHaveLength(1);

        const after = yield* f.start;
        yield* after.resume;
        yield* after.settled(settledThread("thread-1"));
        expect(f.launchCalls).toHaveLength(1);
        expect(f.launched.size).toBe(1);
      }),
    ),
  );

  it.effect("a restart finishes a launch it recorded but never made, as the same run", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.setMode("automatic");
        // The first instance records the run, then the computer stops while launching.
        const launching = yield* Deferred.make<void>();
        const crashed = yield* Layer.build(Suggestions.layer).pipe(
          Effect.map(Context.get(Suggestions.LibraryBriefSuggestions)),
          Effect.provideService(LibraryPublisher.LibraryPublisher, noPublisher),
          Effect.provideService(LibraryService.LibraryService, f.library),
          Effect.provideService(LibraryWorkspaceStore.LibraryWorkspaceStore, f.workspaces),
          Effect.provideService(
            ThreadLaunch.ThreadLaunchService,
            partial<ThreadLaunch.ThreadLaunchService["Service"]>({
              launch: () =>
                Deferred.succeed(launching, undefined).pipe(Effect.andThen(Effect.never)),
            }),
          ),
          Effect.provideService(ThreadManagement.ThreadManagementService, f.threads),
        );
        const fiber = yield* Effect.forkChild(crashed.settled(settledThread("thread-1")));
        yield* Deferred.await(launching);
        yield* Fiber.interrupt(fiber);
        expect(yield* crashed.suggestion({ threadId: ThreadId.make("thread-1") })).toMatchObject({
          status: "starting",
        });

        const restarted = yield* f.start;
        yield* restarted.resume;
        yield* restarted.resume;
        expect(f.launched.size).toBe(1);
        expect(yield* restarted.suggestion({ threadId: ThreadId.make("thread-1") })).toMatchObject({
          status: "started",
        });
      }),
    ),
  );

  it.effect("ask offers the run and starts it only when accepted", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.setMode("ask");
        const suggestions = yield* f.start;
        yield* suggestions.settled(settledThread("accepted"));
        yield* suggestions.settled(settledThread("declined"));
        expect(f.launchCalls).toEqual([]);
        expect(
          yield* suggestions.suggestion({ threadId: ThreadId.make("accepted") }),
        ).toMatchObject({ mode: "ask", status: "offered" });

        const started = yield* suggestions.start({ threadId: ThreadId.make("accepted") });
        expect(started.status).toBe("started");
        expect(f.launchCalls).toHaveLength(1);

        const declined = yield* suggestions.decline({ threadId: ThreadId.make("declined") });
        expect(declined.status).toBe("declined");
        const again = yield* suggestions
          .start({ threadId: ThreadId.make("declined") })
          .pipe(Effect.result);
        expect(again._tag === "Failure" ? again.failure.reason : null).toBe("invalid");
        expect(f.launchCalls).toHaveLength(1);
      }),
    ),
  );

  it.effect("each settled event is handed over once, and a repeated event runs nothing more", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.setMode("automatic");
        const suggestions = yield* f.start;
        const done = yield* Deferred.make<void>();
        const settled = (id: string) => ({ type: "thread.settled", payload: settledThread(id) });
        const threads = partial<ThreadManagement.ThreadManagementService["Service"]>({
          streamDomainEvents: Stream.make(
            settled("thread-1"),
            { type: "thread.unsettled", payload: settledThread("thread-2") },
            settled("thread-1"),
          ).pipe(
            Stream.concat(Stream.fromEffectDrain(Deferred.succeed(done, undefined))),
          ) as unknown as ThreadManagement.ThreadManagementService["Service"]["streamDomainEvents"],
        });
        yield* Layer.build(Suggestions.BriefSuggestionsReactorLive).pipe(
          Effect.provideService(Suggestions.LibraryBriefSuggestions, suggestions),
          Effect.provideService(ThreadManagement.ThreadManagementService, threads),
        );
        yield* Deferred.await(done);
        expect(f.launchCalls).toHaveLength(1);
        expect(f.launchCalls[0]?.initialMessage?.text).toContain("threadId thread-1");
      }),
    ),
  );
});
