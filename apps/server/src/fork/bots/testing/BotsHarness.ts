import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  type ThreadId,
  type TurnTokenUsage,
} from "@t3tools/contracts";
import type { BotsSaveInput } from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import type * as SqlClient from "effect/sql/SqlClient";
import { layerMemory as SqlitePersistenceMemory } from "../../../persistence/Sqlite.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import { runForkMigrationSet } from "../../persistence/migrations.ts";
import { make } from "../BotsService.ts";
import { BotsMigrations } from "../migrations.ts";

export const projectId = ProjectId.make("project-a");
export const model: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "test",
};

/** Settings where no provider a starter could fall back to is enabled. */
export const NO_PROVIDERS = Object.fromEntries(
  ["codex", "claudeAgent", "cursor", "grok", "muse", "pi", "opencode", "antigravity"].map(
    (driver) => [driver, { driver: ProviderDriverKind.make(driver), enabled: false, config: {} }],
  ),
);

export const reviewer = (fields: Partial<BotsSaveInput> = {}): BotsSaveInput => ({
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews one file.",
  instructions: "Review {{file}}.",
  parameters: [{ name: "file", label: "File", type: "string", required: true }],
  modelSelection: model,
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "project", projectId: null, worktree: false },
  timeoutMinutes: 5,
  maxConcurrentRuns: 1,
  scopeProjectId: null,
  ...fields,
});

export interface ThreadOutcome {
  readonly status: "completed" | "failed" | "interrupted";
  readonly reply: string | null;
}

/** Fake launch and thread services: a test decides when and how each run thread ends. */
export const makeHarness = Effect.gen(function* () {
  const launched = yield* Queue.unbounded<ThreadLaunch.ThreadLaunchInput>();
  const launches: Array<ThreadLaunch.ThreadLaunchInput> = [];
  const interrupted: Array<string> = [];
  const outcomes = new Map<string, Deferred.Deferred<ThreadOutcome>>();
  const replies = new Map<string, string>();
  const sent: Array<ThreadManagement.ThreadManagementSendInput> = [];
  const receipts = new Set<string>();
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  /** Token usage per provider turn of a run thread; a thread with none reports no usage. */
  const turns = new Map<string, Array<TurnTokenUsage | undefined>>();
  const state = {
    timeOut: false,
    sendError: null as unknown,
    usageError: false,
    settings: { defaultModelSelection: model as ModelSelection | null, providerInstances: {} },
  };
  const shells = new Map<string, Partial<OrchestrationV2ThreadShell>>();
  const outcomeFor = (threadId: string) => {
    const existing = outcomes.get(threadId);
    if (existing !== undefined) return existing;
    const created = Deferred.makeUnsafe<ThreadOutcome>();
    outcomes.set(threadId, created);
    return created;
  };
  const end = (threadId: string, outcome: ThreadOutcome) =>
    Effect.sync(() => {
      if (outcome.reply !== null && !replies.has(threadId)) replies.set(threadId, outcome.reply);
    }).pipe(Effect.andThen(Deferred.succeed(outcomeFor(threadId), outcome)), Effect.asVoid);

  const messagesOf = (threadId: string) => {
    const reply = replies.get(threadId);
    return {
      messages: [
        { role: "user", text: "brief" },
        ...(reply === undefined ? [] : [{ role: "assistant", text: reply }]),
      ],
    };
  };

  const threads = {
    getThreadShell: (threadId: string) =>
      Effect.sync(() => {
        const shell = shells.get(threadId);
        return shell === undefined ? null : { deletedAt: null, archivedAt: null, ...shell };
      }),
    waitForThread: (input: ThreadManagement.ThreadManagementWaitInput) =>
      Effect.gen(function* () {
        if (state.timeOut && !interrupted.includes(input.threadId))
          return { threadId: input.threadId, run: { status: "running" }, timedOut: true };
        const outcome = yield* Deferred.await(outcomeFor(input.threadId));
        return { threadId: input.threadId, run: { status: outcome.status }, timedOut: false };
      }),
    interruptThread: (input: ThreadManagement.ThreadManagementInterruptInput) =>
      Effect.gen(function* () {
        interrupted.push(input.threadId);
        yield* end(input.threadId, { status: "interrupted", reply: "Partial notes." });
        return {};
      }),
    getProjectThreadRecords: (
      input: { readonly threadId: ThreadId },
      fields: ReadonlyArray<string>,
    ) =>
      Effect.suspend((): Effect.Effect<unknown, { readonly _tag: string }> => {
        if (!fields.includes("providerTurns")) return Effect.succeed(messagesOf(input.threadId));
        if (state.usageError) return Effect.fail({ _tag: "RecordsUnavailable" });
        return Effect.succeed({
          providerTurns: (turns.get(input.threadId) ?? []).map((turnTokenUsage) =>
            turnTokenUsage === undefined ? {} : { turnTokenUsage },
          ),
        });
      }),
    hasReceipt: (commandId: string) => Effect.sync(() => receipts.has(commandId)),
    sendToThread: (input: ThreadManagement.ThreadManagementSendInput) =>
      Effect.gen(function* () {
        if (state.sendError !== null) return yield* Effect.fail(state.sendError);
        sent.push(input);
        receipts.add(input.commandId);
        return {};
      }),
    dispatch: (command: OrchestrationV2ServerCommand) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: dispatched.length };
      }),
  } as unknown as ThreadManagement.ThreadManagementService["Service"];

  const launchService = {
    launch: (input: ThreadLaunch.ThreadLaunchInput) =>
      Effect.gen(function* () {
        launches.push(input);
        yield* Queue.offer(launched, input);
        return {
          threadId: input.threadId!,
          projection: { runs: [{ id: `run-${input.threadId}`, ordinal: 1, status: "running" }] },
          resumed: false,
        };
      }),
    checkWorktreeBase: () => Effect.void,
  } as unknown as ThreadLaunch.ThreadLaunchService["Service"];

  const folders = {
    ensureScratchProject: Effect.succeed({ projectId: ProjectId.make("scratch") }),
  } as unknown as ManagedProjectFolders.ManagedProjectFolders["Service"];

  const settingsService = {
    getSettings: Effect.sync(() => state.settings),
  } as unknown as ServerSettings.ServerSettingsService["Service"];

  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(ServerSettings.ServerSettingsService, settingsService),
      Effect.provideService(ThreadManagement.ThreadManagementService, threads),
      Effect.provideService(ThreadLaunch.ThreadLaunchService, launchService),
      Effect.provideService(ManagedProjectFolders.ManagedProjectFolders, folders),
    );

  return {
    launches,
    sent,
    receipts,
    dispatched,
    turns,
    interrupted,
    state,
    shells,
    end,
    nextLaunch: Queue.take(launched),
    provide,
    service: provide(make),
  };
});

export type Harness = Effect.Success<typeof makeHarness>;

export const withHarness = <A, E>(
  use: (harness: Harness) => Effect.Effect<A, E, SqlClient.SqlClient | Scope.Scope>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(BotsMigrations);
    return yield* use(yield* makeHarness);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory));
