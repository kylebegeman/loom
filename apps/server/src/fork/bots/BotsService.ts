import {
  CommandId,
  MessageId,
  resolveProviderInstanceEnabled,
  type ModelSelection,
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
  isBotRunThreadId,
  isTerminalBotRunStatus,
  type BotCreator,
  type BotDefinition,
  type BotDefinitionInput,
  type BotFinding,
  type BotOrigin,
  type BotOutput,
  type BotRun,
  type BotRunStatus,
  type BotsChange,
  type BotsListRunsInput,
  type BotsRunInput,
  type BotsSaveInput,
  type BotStarterId,
  type BotStarterState,
  type BotStarterStatus,
  type BotVerdict,
} from "@t3tools/contracts/fork";
import {
  fallbackTextGenerationModelSelection,
  isModelSelectionProviderEnabled,
} from "@t3tools/shared/serverSettings";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import type { SqlError } from "effect/sql/SqlError";
import * as Stream from "effect/Stream";

import * as ThreadLaunch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import { forkParked } from "../../serverActivation.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { makeBotsStore, RUNS_KEPT_PER_BOT } from "./BotsStore.ts";
import { checkParameters, renderPrompt, validateInputs } from "./render.ts";
import { decodeVerdictReply } from "./verdict.ts";
import { BOT_STARTERS, differsFromStarter, starterById, type BotStarter } from "./starters.ts";

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
/** A queued run the previous server never started; a batch puts its item back to wait. */
export const RESTARTED_BEFORE_START = "The server restarted before this run started.";
/** Used for a recovered run whose bot was deleted meanwhile. */
const FALLBACK_TIMEOUT_MINUTES = 30;

interface LiveRun {
  run: BotRun;
  fiber: Fiber.Fiber<void> | null;
  /** Set once the run holds its permits and is launching or waiting. */
  started: boolean;
  cancelRequested: boolean;
  threadRunId: RunId | null;
  /** From the version that ran; a restarted server reads the current one. */
  output: BotOutput;
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

const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const VERDICT_LABELS = { pass: "pass", fail: "fail", needs_attention: "needs attention" } as const;

/** `fail (3 findings)`, the verdict as a run's headline. */
export const verdictLabel = (verdict: BotVerdict): string => {
  const count = verdict.findings.length;
  const label = VERDICT_LABELS[verdict.verdict];
  if (count === 0) return label;
  return `${label} (${count}${verdict.findingsTruncated ? "+" : ""} finding${count === 1 && !verdict.findingsTruncated ? "" : "s"})`;
};

const findingLine = (finding: BotFinding): string => {
  const where =
    finding.path === undefined
      ? ""
      : ` (${finding.path}${finding.line === undefined ? "" : `:${finding.line}`})`;
  return `${finding.title}${where}${finding.detail === "" ? "" : `: ${finding.detail}`}`;
};

/** What a finished run posts to the thread it was started from. */
export const runResultMessage = (run: BotRun): string => {
  const started = run.startedAt ?? run.createdAt;
  const duration =
    run.finishedAt === null
      ? null
      : formatDuration(Date.parse(run.finishedAt) - Date.parse(started));
  const status = run.status.replaceAll("_", " ");
  const verdict = run.verdict ?? null;
  const outcome = verdict === null ? status : verdictLabel(verdict);
  const header = `Bot run finished: ${run.botName} (${duration === null ? outcome : `${outcome}, ${duration}`})`;
  const truncated =
    run.status === "completed" && run.resultTruncated ? "\n\n(Reply cut short.)" : "";
  const reply = `${run.result ?? "The bot gave no reply."}${truncated}`;
  const body =
    run.status !== "completed"
      ? (run.error ?? `The run ended as ${status}.`)
      : verdict === null
        ? reply
        : [
            verdict.summary,
            ...(verdict.findings.length === 0
              ? []
              : [verdict.findings.map((finding) => `- ${findingLine(finding)}`).join("\n")]),
            ...(verdict.source === "invalid" ? [reply] : []),
          ].join("\n\n");
  return `${header}\nRun id: ${run.id}\n\n${body}`;
};

const deliveryFailure = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error
    ? error._tag === "ThreadManagementThreadArchivedError"
      ? "the calling thread is archived."
      : error._tag === "ThreadManagementThreadNotFoundError"
        ? "the calling thread no longer exists."
        : errorMessage(error)
    : errorMessage(error);

export const make = Effect.gen(function* () {
  const store = yield* makeBotsStore;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const settings = yield* ServerSettings.ServerSettingsService;
  const serviceScope = yield* Effect.scope;
  const changes = yield* PubSub.unbounded<BotsChange>();
  const environmentPermits = yield* Semaphore.make(BOTS_MAX_ACTIVE_RUNS);
  const botPermits = new Map<string, { readonly semaphore: Semaphore.Semaphore; size: number }>();
  const live = new Map<string, LiveRun>();
  const recovered = yield* Deferred.make<void>();

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

  /** The one write path for definitions; `origin` is set only by the starter paths. */
  const write = Effect.fnUntraced(function* (
    definition: BotDefinitionInput,
    caller: BotCaller,
    options: {
      readonly expectedVersion?: number | undefined;
      readonly origin?: BotOrigin | undefined;
      readonly unarchive?: boolean | undefined;
    },
  ) {
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
    if (
      options.expectedVersion !== undefined &&
      (existing?.version ?? 0) !== options.expectedVersion
    )
      return yield* fail(
        "invalid",
        "This bot changed since it was opened. Reload it and apply your edits again.",
      );
    // A bot recreated under a deleted bot's id continues its numbering, so a version its runs
    // recorded never names two different texts.
    const previousVersion =
      existing?.version ??
      (yield* store.maxRunVersion(definition.id).pipe(Effect.catch(storageError)));
    const origin = options.origin ?? existing?.origin;
    const now = yield* nowIso;
    const bot: BotDefinition = {
      ...definition,
      version: previousVersion + 1,
      createdBy: existing?.createdBy ?? caller.actor,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archivedAt: options.unarchive === true ? null : (existing?.archivedAt ?? null),
      ...(origin === undefined ? {} : { origin }),
    };
    yield* store.putDefinition(bot).pipe(Effect.catch(storageError));
    yield* permitsFor(bot);
    yield* publish({ _tag: "bot", bot });
    return bot;
  });

  const save = Effect.fn("BotsService.save")(function* (input: BotsSaveInput, caller: BotCaller) {
    const { expectedVersion, ...definition } = input;
    return yield* write(definition, caller, { expectedVersion });
  });

  /** The environment's default model, or the first enabled provider's; null when none is usable. */
  const starterModel = settings.getSettings.pipe(
    Effect.map((current): ModelSelection | null => {
      const preferred = current.defaultModelSelection;
      if (preferred != null && isModelSelectionProviderEnabled(current, preferred))
        return preferred;
      return fallbackTextGenerationModelSelection(
        current.providerInstances,
        (instanceId, driver) =>
          resolveProviderInstanceEnabled(
            current.providerInstances[instanceId] ?? { driver, config: {} },
          ),
        { defaultModelSelection: preferred ?? null },
      );
    }),
    Effect.orElseSucceed(() => null),
  );

  const starterDefinition = (
    starter: BotStarter,
    modelSelection: ModelSelection,
    scopeProjectId: ProjectId | null,
  ): BotDefinitionInput => ({ ...starter.definition, modelSelection, scopeProjectId });

  const starterOrigin = (starter: BotStarter): BotOrigin => ({
    kind: "starter",
    starterId: starter.starterId,
    revision: starter.revision,
  });

  /**
   * Offers each shipped starter once. An id a person already uses is left alone; the starter is
   * still recorded as offered, so it shows as removed and can be restored over that bot.
   */
  const seedStarters = Effect.fn("BotsService.seedStarters")(function* () {
    const offered = new Set(
      (yield* store.listStarterRows().pipe(Effect.catch(storageError))).map((row) => row.starterId),
    );
    const pending = BOT_STARTERS.filter((starter) => !offered.has(starter.starterId));
    if (pending.length === 0) return;
    // Without a usable model nothing is recorded, so the next start tries again.
    const modelSelection = yield* starterModel;
    if (modelSelection === null) return;
    for (const starter of pending) {
      const now = yield* nowIso;
      const seeded = yield* store
        .withTransaction(
          Effect.gen(function* () {
            const taken = yield* store.hasDefinition(starter.starterId);
            const bot: BotDefinition | null = taken
              ? null
              : {
                  ...starterDefinition(starter, modelSelection, null),
                  version: (yield* store.maxRunVersion(starter.starterId)) + 1,
                  createdBy: "user",
                  createdAt: now,
                  updatedAt: now,
                  archivedAt: null,
                  origin: starterOrigin(starter),
                };
            if (bot !== null) yield* store.putDefinition(bot);
            yield* store.recordStarter(starter.starterId, starter.revision, now);
            return bot;
          }),
        )
        .pipe(Effect.catch(storageError));
      if (seeded !== null) {
        yield* permitsFor(seeded);
        yield* publish({ _tag: "bot", bot: seeded });
      }
    }
  });

  const starterState = (starter: BotStarter, bot: BotDefinition | undefined): BotStarterState => {
    if (bot?.origin?.starterId !== starter.starterId) return "removed";
    if (bot.origin.revision < starter.revision) return "outdated";
    return differsFromStarter(bot, starter) ? "edited" : "present";
  };

  /** Starters this environment has offered, with how each stands now. */
  const listStarters = Effect.fn("BotsService.listStarters")(function* () {
    const offered = new Set(
      (yield* store.listStarterRows().pipe(Effect.catch(storageError))).map((row) => row.starterId),
    );
    const bots = new Map((yield* list()).map((bot) => [bot.id, bot]));
    return BOT_STARTERS.filter((starter) => offered.has(starter.starterId)).map(
      (starter): BotStarterStatus => ({
        starterId: starter.starterId,
        revision: starter.revision,
        name: starter.definition.name,
        description: starter.definition.description,
        state: starterState(starter, bots.get(starter.starterId)),
      }),
    );
  });

  /** Puts the shipped text back as a new version, keeping the bot's model and project scope. */
  const restoreStarter = Effect.fn("BotsService.restoreStarter")(function* (
    starterId: BotStarterId,
    caller: BotCaller,
  ) {
    const starter = starterById(starterId);
    if (starter === undefined)
      return yield* fail("not_found", `There is no starter bot named ${starterId}.`);
    const existing = yield* store.getDefinition(starter.starterId).pipe(Effect.catch(storageError));
    const modelSelection = existing?.modelSelection ?? (yield* starterModel);
    if (modelSelection === null)
      return yield* fail("invalid", "Enable a provider in Settings before restoring a starter.");
    const bot = yield* write(
      starterDefinition(starter, modelSelection, existing?.scopeProjectId ?? null),
      caller,
      { origin: starterOrigin(starter), unarchive: true },
    );
    yield* store
      .recordStarter(starter.starterId, starter.revision, bot.updatedAt)
      .pipe(Effect.catch(storageError));
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

  /**
   * Posts a finished run's result to the thread it was started from, once. The command id makes a
   * retry after a crash replay the recorded receipt instead of posting twice. A failed delivery is
   * noted on the run and never changes its status. Returns the run with that note.
   */
  const deliver = Effect.fnUntraced(function* (run: BotRun) {
    const callerThreadId = run.callerThreadId;
    if (run.notify !== true || callerThreadId === null) return run;
    const commandId = CommandId.make(`bot-run-notify:${run.id}`);
    const failure = yield* Effect.gen(function* () {
      if (yield* threads.hasReceipt(commandId)) return null;
      const shell = yield* threads.getThreadShell(callerThreadId);
      if (shell === null || shell.deletedAt !== null) return "the calling thread no longer exists.";
      yield* threads.sendToThread({
        projectId: shell.projectId,
        threadId: callerThreadId,
        commandId,
        messageId: MessageId.make(`bot-run-notify-message:${run.id}`),
        senderThreadId: run.threadId,
        text: runResultMessage(run),
        attachments: [],
        mode: "auto",
        createdBy: "system",
        creationSource: "server",
      });
      return null;
    }).pipe(
      Effect.catch((error) => Effect.succeed(deliveryFailure(error))),
      Effect.catchDefect((defect) => Effect.succeed(errorMessage(defect))),
    );
    const error =
      failure === null
        ? run.error
        : [run.error, `Result delivery failed: ${failure}`].filter(Boolean).join("\n");
    yield* store.markNotified(run.id, yield* nowIso, error).pipe(Effect.ignore({ log: true }));
    if (failure !== null)
      yield* Effect.logWarning("Bot run result delivery failed", { runId: run.id, failure });
    return { ...run, error };
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
    // Decoded from the whole reply, so a verdict past the stored cap still counts.
    const verdict =
      outcome.status === "completed" && entry.output === "verdict"
        ? decodeVerdictReply(outcome.reply ?? "")
        : null;
    entry.run = {
      ...entry.run,
      status: outcome.status,
      finishedAt: yield* nowIso,
      result: reply?.text ?? null,
      resultTruncated: reply?.truncated ?? false,
      error: outcome.error ?? null,
      ...(verdict === null ? {} : { verdict }),
    };
    live.delete(entry.run.id);
    yield* store.saveRun(entry.run).pipe(Effect.ignore({ log: true }));
    yield* store.pruneRuns(entry.run.botId, RUNS_KEPT_PER_BOT).pipe(Effect.ignore({ log: true }));
    // Delivered before the terminal event, so that event already says whether it reached the thread.
    entry.run = yield* deliver(entry.run);
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

  /** `permitBot` is the stored definition, whose limit holds even for a run of an older version. */
  const execute = (
    entry: LiveRun,
    bot: BotDefinition,
    launch: Omit<ThreadLaunch.ThreadLaunchInput, "commandId" | "threadId">,
    permitBot: BotDefinition,
  ) =>
    Effect.gen(function* () {
      const botSemaphore = yield* permitsFor(permitBot);
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

  /**
   * A `caller` checkout bot runs where the work is: the chosen thread's checkout, else the calling
   * thread's. Only checkouts Loom already manages are reachable, since the input is a thread id.
   * Null for every other bot, and for a person who picked a project without a thread (its root).
   */
  const resolveCheckout = Effect.fnUntraced(function* (
    bot: BotDefinition,
    input: BotsRunInput,
    caller: BotCaller,
  ) {
    if (bot.workspace.type !== "project" || bot.workspace.checkout !== "caller") return null;
    const threadId = input.checkoutThreadId ?? caller.threadId;
    if (threadId === null) {
      if (input.projectId !== undefined) return null;
      return yield* fail(
        "invalid",
        "This bot runs in the checkout that holds the work; start it from that thread or pick a checkout.",
      );
    }
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => fail("invalid", "Loom could not read the thread to run in.")));
    if (shell === null || shell.deletedAt !== null)
      return yield* fail("invalid", "The thread whose checkout this run uses no longer exists.");
    const projectId = bot.workspace.projectId ?? input.projectId ?? shell.projectId;
    if (shell.projectId !== projectId || (bot.scopeProjectId ?? projectId) !== projectId)
      return yield* fail("invalid", "The chosen checkout belongs to another project.");
    const strategy: ThreadLaunch.ThreadLaunchWorkspaceStrategy =
      shell.worktreePath === null
        ? { type: "root" }
        : {
            type: "existing_worktree",
            worktreePath: shell.worktreePath,
            ...(shell.branch === null ? {} : { branch: shell.branch }),
          };
    return { projectId, strategy };
  });

  /** A person running a bot from a thread: the thread must be live and not itself a bot run. */
  const threadCaller = Effect.fn("BotsService.threadCaller")(function* (threadId: ThreadId) {
    if (isBotRunThreadId(threadId))
      return yield* fail("invalid", "A bot run cannot start another bot.");
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => fail("invalid", "Loom could not read the calling thread.")));
    if (shell === null || shell.deletedAt !== null)
      return yield* fail("invalid", "The calling thread no longer exists.");
    if (shell.archivedAt !== null) return yield* fail("invalid", "The calling thread is archived.");
    return {
      actor: "user",
      threadId,
      projectId: shell.projectId,
      runtimeMode: null,
    } satisfies BotCaller;
  });

  /** Refuses a start from inside a bot run, and a result post with no thread to post to. */
  const checkCaller = (input: BotsRunInput, caller: BotCaller) => {
    // Until pipelines bring explicit limits, a bot run may not fan out into more bot runs.
    if (caller.threadId !== null && isBotRunThreadId(caller.threadId))
      return Effect.fail(fail("permission", "A bot run cannot start another bot."));
    if (input.notify === true && caller.threadId === null)
      return Effect.fail(
        fail("invalid", "Only a run started from a thread can post its result there."),
      );
    return Effect.void;
  };

  /** Refuses a bot an agent could not run itself, since the run would outrank the agent. */
  const checkRunnable = (bot: BotDefinition, caller: BotCaller) => {
    if (bot.archivedAt !== null)
      return Effect.fail(fail("archived", `${bot.name} is archived. Restore it to run it.`));
    if (caller.runtimeMode !== null && outranks(bot.runtimeMode, caller.runtimeMode))
      return Effect.fail(
        fail(
          "permission",
          `${bot.name} runs in ${bot.runtimeMode} mode, broader than this agent's ${caller.runtimeMode} mode.`,
        ),
      );
    return Effect.void;
  };

  interface StartOptions {
    readonly batchId?: string | undefined;
    /** Written in the same transaction as the queued run row. */
    readonly onInserted?: ((run: BotRun) => Effect.Effect<void, SqlError>) | undefined;
  }

  const insertRun = (run: BotRun, options: StartOptions) =>
    store
      .withTransaction(
        store
          .insertRun(run)
          .pipe(
            Effect.andThen(
              options.onInserted === undefined ? Effect.void : options.onInserted(run),
            ),
          ),
      )
      .pipe(Effect.catch(storageError));

  /** Validates the inputs, writes the queued run and starts it under `permitBot`'s limits. */
  const start = Effect.fnUntraced(function* (
    bot: BotDefinition,
    input: BotsRunInput,
    caller: BotCaller,
    permitBot: BotDefinition,
    options: StartOptions,
  ) {
    const checked = validateInputs(bot, input.inputs);
    if (!checked.ok) return yield* fail("invalid", checked.message);
    const checkout = yield* resolveCheckout(bot, input, caller);
    const projectId = checkout?.projectId ?? (yield* resolveProject(bot, input, caller));
    const runId = yield* randomUuidV4;

    const workspaceStrategy: ThreadLaunch.ThreadLaunchWorkspaceStrategy =
      checkout !== null
        ? checkout.strategy
        : bot.workspace.type === "project" && bot.workspace.worktree
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
        ...(input.notify === true ? { notify: true } : {}),
        ...(options.batchId === undefined ? {} : { batchId: options.batchId }),
      },
      fiber: null,
      started: false,
      cancelRequested: false,
      threadRunId: null,
      output: bot.output ?? "text",
    };
    yield* insertRun(entry.run, options);
    live.set(runId, entry);
    yield* publish({ _tag: "run", run: entry.run });
    entry.fiber = yield* execute(
      entry,
      bot,
      {
        projectId,
        title: bot.name,
        generateTitle: false,
        modelSelection: bot.modelSelection,
        runtimeMode: bot.runtimeMode,
        interactionMode: bot.interactionMode,
        workspaceStrategy,
        initialMessage: {
          text: renderPrompt(bot, checked.values),
          attachments: [],
          ...(caller.threadId === null ? {} : { senderThreadId: caller.threadId }),
        },
        createdBy: caller.actor,
        creationSource: "server",
      },
      permitBot,
    ).pipe(Effect.forkIn(serviceScope));
    return entry.run;
  });

  const run = Effect.fn("BotsService.run")(function* (input: BotsRunInput, caller: BotCaller) {
    yield* checkCaller(input, caller);
    const bot = yield* requireBot(input.botId);
    yield* checkRunnable(bot, caller);
    return yield* start(bot, input, caller, bot, {});
  });

  /**
   * Starts one batch item with the definition the batch pinned. The bot must still exist and be
   * active; its stored limit, not the pinned one, holds the run back. A run that cannot start is
   * recorded as failed, so the item shows why and can be retried.
   */
  const startRunWith = Effect.fn("BotsService.startRunWith")(function* (
    definition: BotDefinition,
    input: BotsRunInput,
    caller: BotCaller,
    options: StartOptions & { readonly batchId: string },
  ) {
    const current = yield* requireBot(definition.id);
    if (current.archivedAt !== null)
      return yield* fail("archived", `${current.name} is archived. Restore it to run it.`);
    return yield* start(definition, input, caller, current, options).pipe(
      Effect.catchIf(
        (error) => error.reason === "invalid",
        (error) =>
          Effect.gen(function* () {
            const runId = yield* randomUuidV4;
            const now = yield* nowIso;
            const failed: BotRun = {
              id: runId,
              botId: definition.id,
              botVersion: definition.version,
              botName: definition.name,
              threadId: botRunThreadId(runId),
              projectId: input.projectId ?? null,
              inputs: input.inputs,
              status: "failed",
              startedBy: caller.actor,
              callerThreadId: caller.threadId,
              createdAt: now,
              startedAt: null,
              finishedAt: now,
              result: null,
              resultTruncated: false,
              error: error.message,
              batchId: options.batchId,
            };
            yield* insertRun(failed, options);
            yield* publish({ _tag: "run", run: failed });
            return failed;
          }),
      ),
    );
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

  /** Waits up to `timeoutMs`, or until it ends when omitted, and returns the run as it stands. */
  const awaitRun = (runId: string, timeoutMs?: number) =>
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
        if (timeoutMs === undefined) yield* finished;
        else yield* finished.pipe(Effect.timeoutOption(timeoutMs));
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
      const bot = yield* store.getDefinition(stored.botId).pipe(Effect.orElseSucceed(() => null));
      const entry: LiveRun = {
        run: stored,
        fiber: null,
        started: stored.status === "running",
        cancelRequested: false,
        threadRunId: null,
        output: bot?.output ?? "text",
      };
      if (stored.status === "queued") {
        yield* finish(entry, {
          status: "failed",
          error: RESTARTED_BEFORE_START,
        });
        continue;
      }
      live.set(stored.id, entry);
      const limitMs = (bot?.timeoutMinutes ?? FALLBACK_TIMEOUT_MINUTES) * 60_000;
      const startedMs = stored.startedAt === null ? nowMs : Date.parse(stored.startedAt);
      const remainingMs = Math.max(1, limitMs - (nowMs - startedMs));
      entry.fiber = yield* awaitThread(entry, remainingMs).pipe(
        Effect.catch(recordFailure(entry)),
        Effect.catchDefect(recordFailure(entry)),
        Effect.forkIn(serviceScope),
      );
    }
    // After the loop, whose own finishes already delivered, so nothing is posted twice.
    const undelivered = yield* store.listUndeliveredRuns().pipe(Effect.catch(storageError));
    for (const stored of undelivered) {
      const delivered = yield* deliver(stored);
      if (delivered.error !== stored.error) yield* publish({ _tag: "run", run: delivered });
    }
  });

  return {
    list,
    get: requireBot,
    save,
    archive,
    delete: remove,
    run,
    startRunWith,
    checkCaller,
    checkRunnable,
    threadCaller,
    cancel,
    getRun,
    listRuns,
    awaitRun,
    activeRunCount,
    recover,
    /** Marks recovery done, whatever its outcome, so work that depends on it can go ahead. */
    markRecovered: Deferred.succeed(recovered, undefined).pipe(Effect.asVoid),
    whenRecovered: Deferred.await(recovered),
    seedStarters,
    listStarters,
    restoreStarter,
    changes: Stream.fromPubSub(changes),
  };
});

export type BotsServiceShape = Effect.Success<typeof make>;

export class BotsService extends Context.Service<BotsService, Effect.Success<typeof make>>()(
  "t3/fork/bots/BotsService",
) {}

export const layer = Layer.effect(BotsService, make);

/** Settles runs the previous server left unfinished and offers new starters, once active. */
export const BotsRecoveryLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const bots = yield* BotsService;
    yield* forkParked(
      bots.recover().pipe(
        Effect.catchCause((cause) => Effect.logWarning("Bot run recovery failed", { cause })),
        Effect.ensuring(bots.markRecovered),
        Effect.andThen(
          bots
            .seedStarters()
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Seeding starter bots failed", { cause }),
              ),
            ),
        ),
      ),
    );
  }),
);
