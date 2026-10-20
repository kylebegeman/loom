import {
  CommandId,
  type ProjectId,
  type RunId,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import {
  BOTS_MAX_ACTIVE_RUNS,
  BOTS_RESULT_MAX_BYTES,
  BotsError,
  botRunThreadId,
  isTerminalBotRunStatus,
  type BotCreator,
  type BotDefinition,
  type BotRun,
  type BotRunStatus,
  type BotsChange,
  type BotsListRunsInput,
  type BotsRunInput,
  type BotsSaveInput,
} from "@t3tools/contracts/fork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ThreadLaunch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import { forkParked } from "../../serverActivation.ts";
import { makeBotsStore, RUNS_KEPT_PER_BOT } from "./BotsStore.ts";
import { checkParameters, renderInstructions, validateInputs } from "./render.ts";

/** Who asked for a bot operation. */
export interface BotCaller {
  readonly actor: BotCreator;
  readonly threadId: ThreadId | null;
  readonly projectId: ProjectId | null;
  /** An agent's own runtime mode; a bot may not run with a broader one. Null for people. */
  readonly runtimeMode: RuntimeMode | null;
}

export const USER_CALLER: BotCaller = {
  actor: "user",
  threadId: null,
  projectId: null,
  runtimeMode: null,
};

const RUNTIME_MODE_RANK: Record<RuntimeMode, number> = {
  "approval-required": 0,
  "auto-accept-edits": 1,
  auto: 2,
  "full-access": 3,
};

export const outranks = (mode: RuntimeMode, than: RuntimeMode) =>
  RUNTIME_MODE_RANK[mode] > RUNTIME_MODE_RANK[than];

/** After a timeout interrupt, how long to wait for the run to stop so its reply can be read. */
const INTERRUPT_GRACE_MS = 30_000;
/** Used for a recovered run whose bot was deleted meanwhile. */
const FALLBACK_TIMEOUT_MINUTES = 30;

interface LiveRun {
  run: BotRun;
  fiber: Fiber.Fiber<void> | null;
  /** Set once the run holds its permits and is launching or waiting. */
  started: boolean;
  cancelRequested: boolean;
  threadRunId: RunId | null;
}

const fail = (reason: BotsError["reason"], message: string) => new BotsError({ reason, message });

const storageError = (cause: unknown) =>
  Effect.logWarning("Bots storage failed", { cause }).pipe(
    Effect.andThen(Effect.fail(fail("storage", "Loom could not read or write bots storage."))),
  );

/** Caps the reply at the stored limit without splitting a character. */
export const capReply = (text: string): { readonly text: string; readonly truncated: boolean } => {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= BOTS_RESULT_MAX_BYTES) return { text, truncated: false };
  const cut = new TextDecoder().decode(bytes.slice(0, BOTS_RESULT_MAX_BYTES));
  return { text: cut.replace(/�$/u, ""), truncated: true };
};

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message !== "" ? error.message : String(error);

export const make = Effect.gen(function* () {
  const store = yield* makeBotsStore;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const serviceScope = yield* Effect.scope;
  const changes = yield* PubSub.unbounded<BotsChange>();
  const environmentPermits = yield* Semaphore.make(BOTS_MAX_ACTIVE_RUNS);
  const botPermits = new Map<string, { readonly semaphore: Semaphore.Semaphore; size: number }>();
  const live = new Map<string, LiveRun>();

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const publish = (change: BotsChange) => PubSub.publish(changes, change).pipe(Effect.asVoid);

  const permitsFor = Effect.fnUntraced(function* (bot: BotDefinition) {
    const existing = botPermits.get(bot.id);
    if (existing === undefined) {
      const semaphore = yield* Semaphore.make(bot.maxConcurrentRuns);
      botPermits.set(bot.id, { semaphore, size: bot.maxConcurrentRuns });
      return semaphore;
    }
    if (existing.size !== bot.maxConcurrentRuns) {
      yield* Semaphore.resize(bot.maxConcurrentRuns)(existing.semaphore);
      existing.size = bot.maxConcurrentRuns;
    }
    return existing.semaphore;
  });

  const requireBot = Effect.fnUntraced(function* (botId: string) {
    const bot = yield* store.getDefinition(botId).pipe(Effect.catch(storageError));
    if (bot === null) return yield* fail("not_found", `There is no bot named ${botId}.`);
    return bot;
  });

  const list = () => store.listDefinitions().pipe(Effect.catch(storageError));

  const save = Effect.fn("BotsService.save")(function* (input: BotsSaveInput, caller: BotCaller) {
    const { expectedVersion, ...definition } = input;
    const problem = checkParameters(definition);
    if (problem !== null) return yield* fail("invalid", problem);
    if (
      definition.workspace.type === "project" &&
      definition.workspace.projectId !== null &&
      definition.scopeProjectId !== null &&
      definition.workspace.projectId !== definition.scopeProjectId
    )
      return yield* fail("invalid", "A project-scoped bot can only run in its own project.");
    if (caller.runtimeMode !== null && outranks(definition.runtimeMode, caller.runtimeMode))
      return yield* fail(
        "permission",
        `An agent running in ${caller.runtimeMode} mode cannot define a bot that runs in ${definition.runtimeMode} mode.`,
      );
    const existing = yield* store.getDefinition(definition.id).pipe(Effect.catch(storageError));
    if (
      existing === null &&
      (yield* store.hasDefinition(definition.id).pipe(Effect.catch(storageError)))
    )
      return yield* fail("invalid", "A newer version of Loom saved this bot; update to edit it.");
    if (expectedVersion !== undefined && (existing?.version ?? 0) !== expectedVersion)
      return yield* fail(
        "invalid",
        "This bot changed since it was opened. Reload it and apply your edits again.",
      );
    const now = yield* nowIso;
    const bot: BotDefinition = {
      ...definition,
      version: (existing?.version ?? 0) + 1,
      createdBy: existing?.createdBy ?? caller.actor,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archivedAt: existing?.archivedAt ?? null,
    };
    yield* store.putDefinition(bot).pipe(Effect.catch(storageError));
    yield* permitsFor(bot);
    yield* publish({ _tag: "bot", bot });
    return bot;
  });

  const archive = Effect.fn("BotsService.archive")(function* (botId: string, archived: boolean) {
    const bot = yield* requireBot(botId);
    if ((bot.archivedAt !== null) === archived) return bot;
    const next: BotDefinition = { ...bot, archivedAt: archived ? yield* nowIso : null };
    yield* store.putDefinition(next).pipe(Effect.catch(storageError));
    yield* publish({ _tag: "bot", bot: next });
    return next;
  });

  const activeRunCount = (botId: string) =>
    [...live.values()].filter((entry) => entry.run.botId === botId).length;

  const remove = Effect.fn("BotsService.delete")(function* (botId: string) {
    yield* requireBot(botId);
    if (activeRunCount(botId) > 0)
      return yield* fail("invalid", "Cancel this bot's active runs before deleting it.");
    yield* store.deleteDefinition(botId).pipe(Effect.catch(storageError));
    botPermits.delete(botId);
    yield* publish({ _tag: "bot-deleted", botId });
  });

  /** Records a terminal state once, whichever path reaches it first. */
  const finish = Effect.fnUntraced(function* (
    entry: LiveRun,
    outcome: {
      readonly status: BotRunStatus;
      readonly error?: string | null;
      readonly reply?: string | null;
    },
  ) {
    if (isTerminalBotRunStatus(entry.run.status)) return;
    const reply = outcome.reply == null ? null : capReply(outcome.reply);
    entry.run = {
      ...entry.run,
      status: outcome.status,
      finishedAt: yield* nowIso,
      result: reply?.text ?? null,
      resultTruncated: reply?.truncated ?? false,
      error: outcome.error ?? null,
    };
    live.delete(entry.run.id);
    yield* store.saveRun(entry.run).pipe(Effect.ignore({ log: true }));
    yield* store.pruneRuns(entry.run.botId, RUNS_KEPT_PER_BOT).pipe(Effect.ignore({ log: true }));
    yield* publish({ _tag: "run", run: entry.run });
  });

  const interruptThread = (entry: LiveRun, reason: string) => {
    const { projectId } = entry.run;
    if (projectId === null) return Effect.void;
    return threads
      .interruptThread({
        projectId,
        threadId: entry.run.threadId,
        commandId: CommandId.make(`bot-run:${entry.run.id}:interrupt`),
        ...(entry.threadRunId === null ? {} : { runId: entry.threadRunId }),
        reason,
      })
      .pipe(Effect.ignore({ log: true }));
  };

  /** The run thread holds one request, so its last assistant message is the reply. */
  const readReply = (projectId: ProjectId, threadId: ThreadId) =>
    threads.getProjectThreadRecords({ projectId, threadId }, ["messages"]).pipe(
      Effect.map(
        (records) =>
          records.messages.findLast((message) => message.role === "assistant")?.text ?? null,
      ),
      Effect.orElseSucceed(() => null),
    );

  /** Waits for the run thread to end, enforces the timeout, and records the outcome. */
  const awaitThread = Effect.fnUntraced(function* (entry: LiveRun, timeoutMs: number) {
    const projectId = entry.run.projectId;
    if (projectId === null)
      return yield* finish(entry, { status: "failed", error: "The run has no project." });
    const target = {
      projectId,
      threadId: entry.run.threadId,
      ...(entry.threadRunId === null ? {} : { runId: entry.threadRunId }),
    };
    let waited = yield* threads.waitForThread({ ...target, timeoutMs });
    const timedOut = waited.timedOut;
    if (timedOut) {
      yield* interruptThread(entry, "The bot run reached its time limit.");
      waited = yield* threads.waitForThread({ ...target, timeoutMs: INTERRUPT_GRACE_MS });
    }
    const reply = yield* readReply(projectId, entry.run.threadId);
    if (entry.cancelRequested) return yield* finish(entry, { status: "cancelled", reply });
    if (timedOut)
      return yield* finish(entry, {
        status: "timed_out",
        error: `The run passed its ${Math.max(1, Math.round(timeoutMs / 60_000))} minute limit and was stopped.`,
        reply,
      });
    if (waited.run === null)
      return yield* finish(entry, { status: "failed", error: "The run thread never started." });
    if (waited.run.status === "completed")
      return yield* finish(entry, { status: "completed", reply });
    return yield* finish(entry, {
      status: "failed",
      error: `The run ended as ${waited.run.status.replaceAll("_", " ")}.`,
      reply,
    });
  });

  const recordFailure = (entry: LiveRun) => (error: unknown) =>
    finish(entry, { status: "failed", error: errorMessage(error) });

  const execute = (
    entry: LiveRun,
    bot: BotDefinition,
    launch: Omit<ThreadLaunch.ThreadLaunchInput, "commandId" | "threadId">,
  ) =>
    Effect.gen(function* () {
      const botSemaphore = yield* permitsFor(bot);
      // The bot's own permit comes first, so a run queued behind its bot holds no shared permit.
      yield* Effect.gen(function* () {
        entry.started = true;
        if (entry.cancelRequested) return yield* finish(entry, { status: "cancelled" });
        entry.run = { ...entry.run, status: "running", startedAt: yield* nowIso };
        yield* store.saveRun(entry.run).pipe(Effect.ignore({ log: true }));
        yield* publish({ _tag: "run", run: entry.run });
        const result = yield* launches.launch({
          ...launch,
          commandId: CommandId.make(`bot-run:${entry.run.id}`),
          threadId: entry.run.threadId,
        });
        entry.threadRunId = ThreadManagement.latestRun(result.projection)?.id ?? null;
        if (entry.cancelRequested) yield* interruptThread(entry, "The bot run was cancelled.");
        yield* awaitThread(entry, bot.timeoutMinutes * 60_000);
      }).pipe(
        Effect.catch(recordFailure(entry)),
        environmentPermits.withPermits(1),
        botSemaphore.withPermits(1),
      );
    }).pipe(
      Effect.catchDefect(recordFailure(entry)),
      // Shutdown also interrupts runs; those stay unfinished for restart recovery.
      Effect.onInterrupt(() =>
        entry.cancelRequested
          ? (entry.started
              ? interruptThread(entry, "The bot run was cancelled.")
              : Effect.void
            ).pipe(Effect.andThen(finish(entry, { status: "cancelled" })))
          : Effect.void,
      ),
    );

  const resolveProject = Effect.fnUntraced(function* (
    bot: BotDefinition,
    input: BotsRunInput,
    caller: BotCaller,
  ) {
    if (bot.workspace.type === "scratch") {
      const scratch = yield* folders.ensureScratchProject.pipe(
        Effect.mapError((error) =>
          fail("launch", `Loom could not prepare a scratch folder: ${errorMessage(error)}`),
        ),
      );
      return scratch.projectId;
    }
    const projectId =
      bot.workspace.projectId ?? input.projectId ?? caller.projectId ?? bot.scopeProjectId;
    if (projectId === null)
      return yield* fail("invalid", `Choose a project to run ${bot.name} in.`);
    if (bot.scopeProjectId !== null && projectId !== bot.scopeProjectId)
      return yield* fail("invalid", `${bot.name} belongs to another project.`);
    return projectId;
  });

  const run = Effect.fn("BotsService.run")(function* (input: BotsRunInput, caller: BotCaller) {
    const bot = yield* requireBot(input.botId);
    if (bot.archivedAt !== null)
      return yield* fail("archived", `${bot.name} is archived. Restore it to run it.`);
    if (caller.runtimeMode !== null && outranks(bot.runtimeMode, caller.runtimeMode))
      return yield* fail(
        "permission",
        `${bot.name} runs in ${bot.runtimeMode} mode, broader than this agent's ${caller.runtimeMode} mode.`,
      );
    const checked = validateInputs(bot, input.inputs);
    if (!checked.ok) return yield* fail("invalid", checked.message);
    const projectId = yield* resolveProject(bot, input, caller);
    const runId = yield* randomUuidV4;

    const workspaceStrategy: ThreadLaunch.ThreadLaunchWorkspaceStrategy =
      bot.workspace.type === "project" && bot.workspace.worktree
        ? { type: "worktree", baseRef: bot.workspace.baseRef ?? "HEAD" }
        : { type: "root" };
    if (workspaceStrategy.type === "worktree")
      yield* launches
        .checkWorktreeBase({ projectId, workspaceStrategy })
        .pipe(Effect.mapError((error) => fail("invalid", error.message)));

    const entry: LiveRun = {
      run: {
        id: runId,
        botId: bot.id,
        botVersion: bot.version,
        botName: bot.name,
        threadId: botRunThreadId(runId),
        projectId,
        inputs: checked.values,
        status: "queued",
        startedBy: caller.actor,
        callerThreadId: caller.threadId,
        createdAt: yield* nowIso,
        startedAt: null,
        finishedAt: null,
        result: null,
        resultTruncated: false,
        error: null,
      },
      fiber: null,
      started: false,
      cancelRequested: false,
      threadRunId: null,
    };
    yield* store.insertRun(entry.run).pipe(Effect.catch(storageError));
    live.set(runId, entry);
    yield* publish({ _tag: "run", run: entry.run });
    entry.fiber = yield* execute(entry, bot, {
      projectId,
      title: bot.name,
      generateTitle: false,
      modelSelection: bot.modelSelection,
      runtimeMode: bot.runtimeMode,
      interactionMode: bot.interactionMode,
      workspaceStrategy,
      initialMessage: {
        text: renderInstructions(bot, checked.values),
        attachments: [],
        ...(caller.threadId === null ? {} : { senderThreadId: caller.threadId }),
      },
      createdBy: caller.actor,
      creationSource: "server",
    }).pipe(Effect.forkIn(serviceScope));
    return entry.run;
  });

  const getRun = Effect.fn("BotsService.getRun")(function* (runId: string) {
    const current =
      live.get(runId)?.run ?? (yield* store.getRun(runId).pipe(Effect.catch(storageError)));
    if (current === null) return yield* fail("not_found", "The bot run was not found.");
    return current;
  });

  const cancel = Effect.fn("BotsService.cancel")(function* (runId: string) {
    const entry = live.get(runId);
    if (entry === undefined) return yield* getRun(runId);
    entry.cancelRequested = true;
    if (!entry.started && entry.fiber !== null) yield* Fiber.interrupt(entry.fiber);
    // Before launch returns there is no thread run yet; the launch path interrupts it after.
    else if (entry.threadRunId !== null)
      yield* interruptThread(entry, "The bot run was cancelled.");
    return entry.run;
  });

  const listRuns = (input: BotsListRunsInput) =>
    store.listRuns(input).pipe(
      Effect.map(({ runs, hasMore }) => ({
        // Live runs carry state newer than their last write.
        runs: runs.map((stored) => live.get(stored.id)?.run ?? stored),
        hasMore,
      })),
      Effect.catch(storageError),
    );

  /** Waits up to `timeoutMs` for a run to finish and returns it as it stands then. */
  const awaitRun = (runId: string, timeoutMs: number) =>
    Effect.scoped(
      Effect.gen(function* () {
        // Subscribe before reading so a finish between the two is not missed.
        const subscription = yield* PubSub.subscribe(changes);
        const current = yield* getRun(runId);
        if (isTerminalBotRunStatus(current.status)) return current;
        const finished = Effect.gen(function* () {
          while (true) {
            const change = yield* PubSub.take(subscription);
            if (
              change._tag === "run" &&
              change.run.id === runId &&
              isTerminalBotRunStatus(change.run.status)
            )
              return;
          }
        });
        yield* finished.pipe(Effect.timeoutOption(timeoutMs));
        return yield* getRun(runId);
      }),
    );

  /**
   * Queued runs died with the previous server. Running runs still have a thread, so each gets a
   * new waiter with the time it had left.
   */
  const recover = Effect.fn("BotsService.recover")(function* () {
    const unfinished = yield* store.listUnfinishedRuns().pipe(Effect.catch(storageError));
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    for (const stored of unfinished) {
      if (live.has(stored.id)) continue;
      const entry: LiveRun = {
        run: stored,
        fiber: null,
        started: stored.status === "running",
        cancelRequested: false,
        threadRunId: null,
      };
      if (stored.status === "queued") {
        yield* finish(entry, {
          status: "failed",
          error: "The server restarted before this run started.",
        });
        continue;
      }
      live.set(stored.id, entry);
      const bot = yield* store.getDefinition(stored.botId).pipe(Effect.orElseSucceed(() => null));
      const limitMs = (bot?.timeoutMinutes ?? FALLBACK_TIMEOUT_MINUTES) * 60_000;
      const startedMs = stored.startedAt === null ? nowMs : Date.parse(stored.startedAt);
      const remainingMs = Math.max(1, limitMs - (nowMs - startedMs));
      entry.fiber = yield* awaitThread(entry, remainingMs).pipe(
        Effect.catch(recordFailure(entry)),
        Effect.catchDefect(recordFailure(entry)),
        Effect.forkIn(serviceScope),
      );
    }
  });

  return {
    list,
    save,
    archive,
    delete: remove,
    run,
    cancel,
    getRun,
    listRuns,
    awaitRun,
    activeRunCount,
    recover,
    changes: Stream.fromPubSub(changes),
  };
});

export class BotsService extends Context.Service<BotsService, Effect.Success<typeof make>>()(
  "t3/fork/bots/BotsService",
) {}

export const layer = Layer.effect(BotsService, make);

/** Settles runs the previous server left unfinished, once the server is active. */
export const BotsRecoveryLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const bots = yield* BotsService;
    yield* forkParked(
      bots
        .recover()
        .pipe(
          Effect.catchCause((cause) => Effect.logWarning("Bot run recovery failed", { cause })),
        ),
    );
  }),
);
