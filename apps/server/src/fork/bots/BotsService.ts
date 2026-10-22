import {
  CommandId,
  MessageId,
  resolveProviderInstanceEnabled,
  ThreadId,
  type ModelSelection,
  type ProjectId,
  type RunId,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  BOTS_MAX_ACTIVE_RUNS,
  BOTS_RESULT_MAX_BYTES,
  BOTS_USAGE_MAX_DAYS,
  BotsError,
  botRunThreadId,
  isBotInboxRun,
  isBotRunThreadId,
  isTerminalBotRunStatus,
  type BotCreator,
  type BotDefinition,
  type BotDefinitionInput,
  type BotFinding,
  type BotLibraryLink,
  type BotRemoteUpdate,
  type BotRunComputer,
  type BotTarget,
  type BotOrigin,
  type BotOutput,
  type BotRun,
  type BotRunRating,
  type BotRunStatus,
  type BotRunUsage,
  type BotsChange,
  type BotsDismissInput,
  type BotsRateRunInput,
  type BotsRestoreVersionInput,
  type BotsSetStableInput,
  type BotsVersionRef,
  type BotsVersionsInput,
  type BotsInboxInput,
  type BotsListRunsInput,
  type BotsPromoteResult,
  type BotsRetryInput,
  type BotsRunInput,
  type BotsSaveInput,
  type BotsUsageInput,
  type BotsUsageResult,
  type BotStarterId,
  type BotStarterState,
  type BotStarterStatus,
  type BotVerdict,
  type BotVersionSavedBy,
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
import { budgetRefusal, budgetState, BUDGET_WINDOW_MS, isoAt } from "./BotBudgets.ts";
import { makeBotsStore, RUNS_KEPT_PER_BOT, VERSIONS_KEPT_PER_BOT } from "./BotsStore.ts";
import { checkParameters, renderPrompt, validateInputs, type UntrustedInputs } from "./render.ts";
import { summarizePipelineUsage, summarizeRunUsage, summarizeUsage } from "./usage.ts";
import { decodeVerdictReply } from "./verdict.ts";
import { BOT_STARTERS, differsFromStarter, starterById, type BotStarter } from "./starters.ts";
import { changedFields } from "./versions/compare.ts";

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
/** A run opened as a thread is named after its bot and first input, at most this long. */
const PROMOTED_TITLE_MAX = 120;

/** `Reviewer: src/app.ts`, the name of a run opened as an ordinary thread. */
export const promotedTitle = (run: BotRun): string => {
  const first = Object.values(run.inputs)[0];
  const value = first === undefined ? "" : String(first).replace(/\s+/gu, " ").trim();
  const title = value === "" ? run.botName : `${run.botName}: ${value}`;
  return title.length <= PROMOTED_TITLE_MAX
    ? title
    : `${title.slice(0, PROMOTED_TITLE_MAX - 3)}...`;
};

interface LiveRun {
  run: BotRun;
  fiber: Fiber.Fiber<void> | null;
  /** Set once the run holds its permits and is launching or waiting. */
  started: boolean;
  cancelRequested: boolean;
  /**
   * Set once the run thread exists. A run recovered after a restart has one but no known thread
   * run id, so it is interrupted by thread.
   */
  launched: boolean;
  threadRunId: RunId | null;
  /** From the version that ran, including after recovery when its version is still stored. */
  output: BotOutput;
}

const fail = (reason: BotsError["reason"], message: string) => new BotsError({ reason, message });

/** What a version stores of a definition: everything but the server-owned fields. */
export const versionInput = ({
  version: _version,
  createdBy: _createdBy,
  createdAt: _createdAt,
  updatedAt: _updatedAt,
  archivedAt: _archivedAt,
  stableVersion: _stableVersion,
  origin: _origin,
  library: _library,
  ...input
}: BotDefinition): BotDefinitionInput => input;

/**
 * How runs and saves reach other computers through the Library. BotSharing installs these once
 * it starts; without them a bot runs only here and a shared bot cannot be saved.
 */
export interface BotsAnywhereHooks {
  /** Publishes a shared bot's edit before it is saved here, returning the link to its revision. */
  readonly publish: (
    definition: BotDefinitionInput,
    link: BotLibraryLink,
  ) => Effect.Effect<BotLibraryLink, BotsError>;
  /** The computer a run goes to, or null for this one. */
  readonly resolveTarget: (
    bot: BotDefinition,
    target: BotTarget,
    projectId: ProjectId | null,
  ) => Effect.Effect<BotRunComputer | null, BotsError>;
  /** Hands a queued remote run to the Library, with the inputs it frames as untrusted. */
  readonly submit: (
    run: BotRun,
    bot: BotDefinition,
    untrusted: Omit<UntrustedInputs, "frameId"> | undefined,
  ) => Effect.Effect<void, BotsError>;
  /** True when the Library withdrew the run before its target took it, so no ending comes back. */
  readonly cancel: (run: BotRun) => Effect.Effect<boolean>;
  /** The Vault reference lines a run's first message carries, one per bound slot. */
  readonly vaultLines: (bot: BotDefinition) => Effect.Effect<ReadonlyArray<string>, BotsError>;
}

/** The project a run on another computer works in; that computer makes its own scratch folder. */
const remoteProject = (bot: BotDefinition, input: BotsRunInput, caller: BotCaller) =>
  bot.workspace.type === "scratch"
    ? null
    : (bot.workspace.projectId ?? input.projectId ?? caller.projectId ?? bot.scopeProjectId);

const BATCH_RERUNS_ITEM = "Its batch already runs this item again.";

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
  const recoveredRuns = new Map<string, number>();
  let recoveredRunCount = 0;
  const live = new Map<string, LiveRun>();
  const recovered = yield* Deferred.make<void>();
  const seeded = yield* Deferred.make<void>();
  const retryPermit = yield* Semaphore.make(1);
  // The optimistic check also covers publishing to the Library, which yields before the write.
  const definitionPermit = yield* Semaphore.make(1);
  // Serializes a budget check with the run row it admits, so two starts cannot both take the last run.
  const budgetPermit = yield* Semaphore.make(1);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const publish = (change: BotsChange) => PubSub.publish(changes, change).pipe(Effect.asVoid);
  let anywhere: BotsAnywhereHooks | null = null;
  const requireHooks = (message: string): Effect.Effect<BotsAnywhereHooks, BotsError> =>
    anywhere === null ? Effect.fail(fail("invalid", message)) : Effect.succeed(anywhere);

  const permitsFor = Effect.fnUntraced(function* (bot: BotDefinition) {
    const existing = botPermits.get(bot.id);
    const available = Math.max(0, bot.maxConcurrentRuns - (recoveredRuns.get(bot.id) ?? 0));
    if (existing === undefined) {
      const semaphore = yield* Semaphore.make(available);
      botPermits.set(bot.id, { semaphore, size: bot.maxConcurrentRuns });
      return semaphore;
    }
    if (existing.size !== bot.maxConcurrentRuns) {
      yield* Semaphore.resize(available)(existing.semaphore);
      existing.size = bot.maxConcurrentRuns;
    }
    return existing.semaphore;
  });

  // Recovered threads already run, so they reduce launch capacity while all their waiters start
  // immediately, including when a bot's limit was lowered below its unfinished run count.
  const accountRecovered = Effect.fnUntraced(function* (botId: string, delta: 1 | -1) {
    recoveredRunCount += delta;
    const count = (recoveredRuns.get(botId) ?? 0) + delta;
    if (count === 0) recoveredRuns.delete(botId);
    else recoveredRuns.set(botId, count);
    yield* environmentPermits.resize(Math.max(0, BOTS_MAX_ACTIVE_RUNS - recoveredRunCount));
    const permits = botPermits.get(botId);
    if (permits !== undefined) yield* permits.semaphore.resize(Math.max(0, permits.size - count));
  });

  // Only a budget needs the runs of its window kept past RUNS_KEPT_PER_BOT.
  const pruneRuns = (botId: string) =>
    store.getDefinition(botId).pipe(
      Effect.flatMap((bot) => store.pruneRuns(botId, RUNS_KEPT_PER_BOT, bot?.budget !== undefined)),
      Effect.ignore({ log: true }),
    );

  const requireBot = Effect.fnUntraced(function* (botId: string) {
    const bot = yield* store.getDefinition(botId).pipe(Effect.catch(storageError));
    if (bot === null) return yield* fail("not_found", `There is no bot named ${botId}.`);
    return bot;
  });

  const list = () => store.listDefinitions().pipe(Effect.catch(storageError));

  /**
   * The highest version this id ever used. A bot recreated under a deleted bot's id continues
   * past its runs and stored versions, so a version number never names two different texts.
   */
  const nextVersion = Effect.fnUntraced(function* (botId: string, existing: BotDefinition | null) {
    return Math.max(
      existing?.version ?? 0,
      yield* store.maxRunVersion(botId),
      yield* store.maxVersion(botId),
    );
  });

  /** What every saved definition, and every draft a replay runs, must satisfy. */
  const checkDefinition = (definition: BotDefinitionInput, caller: BotCaller) => {
    // A trigger following the latest version would repeat a run's edit on every firing.
    if (caller.threadId !== null && isBotRunThreadId(caller.threadId))
      return Effect.fail(fail("permission", "A bot run cannot change bots."));
    const problem = checkParameters(definition);
    if (problem !== null) return Effect.fail(fail("invalid", problem));
    if (
      definition.workspace.type === "project" &&
      definition.workspace.projectId !== null &&
      definition.scopeProjectId !== null &&
      definition.workspace.projectId !== definition.scopeProjectId
    )
      return Effect.fail(fail("invalid", "A project-scoped bot can only run in its own project."));
    if (caller.runtimeMode !== null && outranks(definition.runtimeMode, caller.runtimeMode))
      return Effect.fail(
        fail(
          "permission",
          `An agent running in ${caller.runtimeMode} mode cannot define a bot that runs in ${definition.runtimeMode} mode.`,
        ),
      );
    return Effect.void;
  };

  /** The one write path for definitions; `origin` is set only by the starter paths. */
  const write = Effect.fnUntraced(function* (
    definition: BotDefinitionInput,
    caller: BotCaller,
    options: {
      readonly expectedVersion?: number | undefined;
      readonly origin?: BotOrigin | undefined;
      readonly unarchive?: boolean | undefined;
      /** Defaults to the caller's actor. */
      readonly savedBy?: BotVersionSavedBy | undefined;
      readonly restoredFrom?: number | undefined;
      /** Set by sync, which writes what the Library has; otherwise a shared bot publishes first. */
      readonly library?: BotLibraryLink | null | undefined;
    },
  ) {
    yield* checkDefinition(definition, caller);
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
    const origin = options.origin ?? existing?.origin;
    const existingLink = existing?.library ?? null;
    // A sync may have read its revision before waiting behind a local save or unshare.
    if (options.library != null && existing !== null) {
      if (existingLink === null)
        return yield* fail("invalid", "A local bot with this id already exists on this computer.");
      if (existingLink.revision >= options.library.revision) return existing;
    }
    const library =
      options.library !== undefined
        ? options.library
        : existingLink === null
          ? null
          : yield* requireHooks("Loom is still connecting to the Library. Try again shortly.").pipe(
              Effect.flatMap((hooks) => hooks.publish(definition, existingLink)),
            );
    const now = yield* nowIso;
    const bot = yield* store
      .withTransaction(
        Effect.gen(function* () {
          const next: BotDefinition = {
            ...definition,
            version: (yield* nextVersion(definition.id, existing)) + 1,
            createdBy: existing?.createdBy ?? caller.actor,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            archivedAt: options.unarchive === true ? null : (existing?.archivedAt ?? null),
            ...(existing?.stableVersion == null ? {} : { stableVersion: existing.stableVersion }),
            ...(origin === undefined ? {} : { origin }),
            ...(library === null ? {} : { library }),
          };
          yield* store.putDefinition(next);
          yield* store.insertVersion(next, {
            savedBy: options.savedBy ?? caller.actor,
            savedAt: now,
            changed: existing === null ? [] : changedFields(versionInput(existing), definition),
            restoredFrom: options.restoredFrom ?? null,
          });
          yield* store.pruneVersions(definition.id, VERSIONS_KEPT_PER_BOT);
          return next;
        }),
      )
      .pipe(Effect.catch(storageError));
    yield* permitsFor(bot);
    yield* publish({ _tag: "bot", bot });
    return bot;
  }, definitionPermit.withPermits(1));

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
                  version: (yield* nextVersion(starter.starterId, null)) + 1,
                  createdBy: "user",
                  createdAt: now,
                  updatedAt: now,
                  archivedAt: null,
                  origin: starterOrigin(starter),
                };
            if (bot !== null) {
              yield* store.putDefinition(bot);
              yield* store.insertVersion(bot, {
                savedBy: "starter",
                savedAt: now,
                changed: [],
                restoredFrom: null,
              });
            }
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
      { origin: starterOrigin(starter), unarchive: true, savedBy: "starter" },
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
  }, definitionPermit.withPermits(1));

  const activeRunCount = (botId: string) =>
    [...live.values()].filter((entry) => entry.run.botId === botId).length;

  const remove = Effect.fn("BotsService.delete")(function* (botId: string) {
    yield* requireBot(botId);
    if (activeRunCount(botId) > 0)
      return yield* fail("invalid", "Cancel this bot's active runs before deleting it.");
    yield* store.deleteDefinition(botId).pipe(Effect.catch(storageError));
    botPermits.delete(botId);
    yield* publish({ _tag: "bot-deleted", botId });
  }, definitionPermit.withPermits(1));

  const missingVersion = (bot: BotDefinition, version: number) =>
    fail("not_found", `Version ${version} of ${bot.name} is no longer stored.`);

  /**
   * The bot as it was at `version`, with the current row's state, so an archived bot refuses
   * every version. "stable" is the latest while none is marked.
   */
  const definitionAt = Effect.fn("BotsService.definitionAt")(function* (
    botId: string,
    at: number | "stable" | "latest",
  ) {
    const current = yield* requireBot(botId);
    if (current.archivedAt !== null)
      return yield* fail("archived", `${current.name} is archived. Restore it to run it.`);
    const version =
      at === "latest"
        ? current.version
        : at === "stable"
          ? (current.stableVersion ?? current.version)
          : at;
    if (version === current.version) return current;
    const stored = yield* store.getVersion(botId, version).pipe(Effect.catch(storageError));
    if (stored === null) return yield* missingVersion(current, version);
    return { ...current, ...stored.definition, version } satisfies BotDefinition;
  });

  const versions = (input: BotsVersionsInput) =>
    store.listVersions(input.botId, input.before, input.limit).pipe(Effect.catch(storageError));

  const version = Effect.fn("BotsService.version")(function* (input: BotsVersionRef) {
    const stored = yield* store
      .getVersion(input.botId, input.version)
      .pipe(Effect.catch(storageError));
    if (stored !== null) return stored;
    return yield* missingVersion(yield* requireBot(input.botId), input.version);
  });

  /** Marks a stored version known good, or clears the mark; the bot's version does not change. */
  const setStable = Effect.fn("BotsService.setStable")(function* (input: BotsSetStableInput) {
    const bot = yield* requireBot(input.botId);
    if (input.version !== null && input.version !== bot.version)
      yield* version({ botId: bot.id, version: input.version });
    yield* store.setStable(bot.id, input.version).pipe(Effect.catch(storageError));
    const { stableVersion: _previous, ...rest } = bot;
    const next: BotDefinition =
      input.version === null ? rest : { ...rest, stableVersion: input.version };
    yield* publish({ _tag: "bot", bot: next });
    return next;
  }, definitionPermit.withPermits(1));

  /** Saves an earlier version's definition as a new version, so history only grows. */
  const restoreVersion = Effect.fn("BotsService.restoreVersion")(function* (
    input: BotsRestoreVersionInput,
    caller: BotCaller,
  ) {
    const stored = yield* version(input);
    return yield* write(stored.definition, caller, {
      expectedVersion: input.expectedVersion,
      savedBy: "restore",
      restoredFrom: input.version,
    });
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
      readonly usage?: BotRunUsage | null;
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
      ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
    };
    live.delete(entry.run.id);
    yield* store.saveRun(entry.run).pipe(Effect.ignore({ log: true }));
    yield* pruneRuns(entry.run.botId);
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

  /** Read once at the end; a failed read leaves the run without usage and never fails it. */
  const readUsage = (projectId: ProjectId, threadId: ThreadId) =>
    threads.getProjectThreadRecords({ projectId, threadId }, ["providerTurns"]).pipe(
      Effect.map((records) => summarizeRunUsage(records.providerTurns)),
      Effect.catchCause((cause) =>
        Effect.logWarning("Reading bot run usage failed", { threadId, cause }).pipe(
          Effect.as(null),
        ),
      ),
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
    const usage = yield* readUsage(projectId, entry.run.threadId);
    if (entry.cancelRequested) return yield* finish(entry, { status: "cancelled", reply, usage });
    if (timedOut)
      return yield* finish(entry, {
        status: "timed_out",
        error: `The run passed its ${Math.max(1, Math.round(timeoutMs / 60_000))} minute limit and was stopped.`,
        reply,
        usage,
      });
    if (waited.run === null)
      return yield* finish(entry, {
        status: "failed",
        error: "The run thread never started.",
        usage,
      });
    if (waited.run.status === "completed")
      return yield* finish(entry, { status: "completed", reply, usage });
    return yield* finish(entry, {
      status: "failed",
      error: `The run ended as ${waited.run.status.replaceAll("_", " ")}.`,
      reply,
      usage,
    });
  });

  const recordFailure = (entry: LiveRun) => (error: unknown) =>
    finish(entry, { status: "failed", error: errorMessage(error) });

  /** `permitBot` is the stored definition, whose limit holds even for a run of an older version. */
  const execute = Effect.fn("BotsService.execute")(
    function* (
      entry: LiveRun,
      bot: BotDefinition,
      launch: Omit<ThreadLaunch.ThreadLaunchInput, "commandId" | "threadId">,
      permitBot: BotDefinition,
    ) {
      const botSemaphore = yield* permitsFor(permitBot);
      // The bot's own permit comes first, so a run queued behind its bot holds no shared permit.
      yield* Effect.gen(function* () {
        entry.started = true;
        if (entry.cancelRequested) return yield* finish(entry, { status: "cancelled" });
        // A run another computer sent can wait for a permit past the switch being turned off.
        if (entry.run.requestedBy != null && !(yield* store.remoteSettings()).acceptRemote)
          return yield* finish(entry, {
            status: "failed",
            error: "This computer stopped running bots for other computers before the run started.",
          });
        entry.run = { ...entry.run, status: "running", startedAt: yield* nowIso };
        yield* store.saveRun(entry.run).pipe(Effect.ignore({ log: true }));
        yield* publish({ _tag: "run", run: entry.run });
        const result = yield* launches.launch({
          ...launch,
          commandId: CommandId.make(`bot-run:${entry.run.id}`),
          threadId: entry.run.threadId,
        });
        entry.threadRunId = ThreadManagement.latestRun(result.projection)?.id ?? null;
        entry.launched = true;
        if (entry.cancelRequested) yield* interruptThread(entry, "The bot run was cancelled.");
        yield* awaitThread(entry, bot.timeoutMinutes * 60_000);
      }).pipe(
        Effect.catch(recordFailure(entry)),
        environmentPermits.withPermits(1),
        botSemaphore.withPermits(1),
      );
    },
    (effect, entry) =>
      effect.pipe(
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
    return { projectId, strategy, threadId };
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
    /** Runs on this model instead of the bot's. */
    readonly modelSelection?: ModelSelection | undefined;
    readonly retryOf?: string | undefined;
    readonly triggerId?: string | undefined;
    readonly replayId?: string | undefined;
    readonly pipelineRunId?: string | undefined;
    /** Inputs framed as untrusted data in the prompt; a trigger's run frames them all. */
    readonly untrusted?: Omit<UntrustedInputs, "frameId"> | undefined;
    /** Written in the same transaction as the queued run row. */
    readonly onInserted?: ((run: BotRun) => Effect.Effect<void, SqlError | BotsError>) | undefined;
    /** A run another computer asked for keeps that computer's run id, and so its thread id. */
    readonly remote?: { readonly runId: string; readonly requestedBy: BotRunComputer } | undefined;
  }

  // Event data reaches a trigger's run, so its text inputs are framed as untrusted.
  const untrustedInputs = (options: StartOptions, values: BotRun["inputs"]) =>
    options.untrusted ??
    (options.triggerId === undefined ? undefined : { names: Object.keys(values) });

  const budgetFor = Effect.fnUntraced(function* (bot: BotDefinition, nowMs: number) {
    const since = isoAt(nowMs - BUDGET_WINDOW_MS);
    const window = yield* store.budgetWindow(bot.id, since).pipe(Effect.catch(storageError));
    return budgetState(bot.budget, window);
  });

  /** Fails with the refusal, carrying `retryAt`, when `bot`'s budget has no room for a run. */
  const checkBudget = Effect.fnUntraced(function* (bot: BotDefinition) {
    if (bot.budget === undefined) return;
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const refusal = budgetRefusal(bot.name, yield* budgetFor(bot, nowMs), nowMs);
    if (refusal !== null) return yield* Effect.fail(refusal);
  });

  /** The bot's budget as it stands now. */
  const budgetNow = Effect.fnUntraced(function* (bot: BotDefinition) {
    return yield* budgetFor(bot, DateTime.toEpochMillis(yield* DateTime.now));
  });

  const insertRun = (run: BotRun, options: StartOptions) =>
    store
      .withTransaction(
        store
          .insertRun(run, { requestId: options.remote?.runId })
          .pipe(
            Effect.andThen(
              options.onInserted === undefined ? Effect.void : options.onInserted(run),
            ),
          ),
      )
      .pipe(Effect.catchTags({ SqlError: storageError }));

  /** Settles a remote run that never reached its computer, or that its computer gave up on. */
  const settleRemote = Effect.fnUntraced(function* (run: BotRun, settled: Partial<BotRun>) {
    const next: BotRun = { ...run, ...settled };
    yield* store.saveRun(next).pipe(Effect.ignore({ log: true }));
    if (isTerminalBotRunStatus(next.status)) {
      if (next.modelSelection !== undefined && next.modelSelection !== run.modelSelection)
        yield* store
          .applyRemoteModel(next.id, next.modelSelection)
          .pipe(Effect.ignore({ log: true }));
      yield* pruneRuns(next.botId);
      const delivered = yield* deliver(next);
      yield* publish({ _tag: "run", run: delivered });
      return delivered;
    }
    yield* publish({ _tag: "run", run: next });
    return next;
  });

  /**
   * Records a run for another computer and hands it to the Library. It takes no permit here; the
   * other computer applies its own limits, and this bot's budget still counts the run. That
   * computer runs only the Library revision sent, not a pinned version, so the run is recorded and
   * sent as `permitBot`, the bot as it stands now.
   */
  const startRemote = Effect.fnUntraced(function* (
    bot: BotDefinition,
    values: BotRun["inputs"],
    input: BotsRunInput,
    caller: BotCaller,
    permitBot: BotDefinition,
    options: StartOptions,
    ranOn: BotRunComputer,
  ) {
    if (permitBot.library == null)
      return yield* fail(
        "invalid",
        `Share ${bot.name} through the Library to run it on another computer.`,
      );
    if (bot.workspace.type === "project" && bot.workspace.checkout === "caller")
      return yield* fail(
        "invalid",
        `${bot.name} runs in the checkout that holds the work, which only this computer has.`,
      );
    if (options.modelSelection !== undefined)
      return yield* fail(
        "invalid",
        "A run on another computer uses the model that computer has for the bot.",
      );
    const hooks = yield* requireHooks("Running on another computer needs a connected Library.");
    const runId = yield* randomUuidV4;
    const run: BotRun = {
      id: runId,
      botId: bot.id,
      botVersion: permitBot.version,
      botName: bot.name,
      threadId: botRunThreadId(runId),
      projectId: remoteProject(bot, input, caller),
      inputs: values,
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
      ...(options.retryOf === undefined ? {} : { retryOf: options.retryOf }),
      ...(options.triggerId === undefined ? {} : { triggerId: options.triggerId }),
      ...(options.replayId === undefined ? {} : { replayId: options.replayId }),
      ...(options.pipelineRunId === undefined ? {} : { pipelineRunId: options.pipelineRunId }),
      modelSelection: bot.modelSelection,
      ranOn,
    };
    yield* permitBot.budget === undefined
      ? insertRun(run, options)
      : checkBudget(permitBot).pipe(
          Effect.andThen(insertRun(run, options)),
          budgetPermit.withPermits(1),
        );
    yield* publish({ _tag: "run", run });
    return yield* hooks.submit(run, permitBot, untrustedInputs(options, values)).pipe(
      Effect.as(run),
      Effect.catch((error) =>
        settleRemote(run, { status: "failed", finishedAt: run.createdAt, error: error.message }),
      ),
    );
  });

  /** Applies what the computer running a remote run reported. Updates for an ended run are dropped. */
  const applyRemoteUpdate = Effect.fn("BotsService.applyRemoteUpdate")(function* (
    runId: string,
    update: BotRemoteUpdate,
  ) {
    const run = yield* store.getRun(runId).pipe(Effect.catch(storageError));
    if (run === null || run.ranOn == null || isTerminalBotRunStatus(run.status)) return run;
    if (update._tag === "started")
      return run.status === "queued"
        ? yield* settleRemote(run, { status: "running", startedAt: update.startedAt })
        : run;
    return yield* settleRemote(run, {
      status: isTerminalBotRunStatus(update.status) ? update.status : "failed",
      startedAt: update.startedAt ?? run.startedAt,
      finishedAt: update.finishedAt,
      result: update.result,
      resultTruncated: update.resultTruncated,
      error: update.error,
      ...(update.verdict === null ? {} : { verdict: update.verdict }),
      ...(update.usage === null ? {} : { usage: update.usage }),
      ...(update.modelSelection === null ? {} : { modelSelection: update.modelSelection }),
    });
  });

  /** Points a bot at its shared Library record, or makes it local again with null. */
  const setLibraryLink = Effect.fn("BotsService.setLibraryLink")(function* (
    botId: string,
    link: BotLibraryLink | null,
  ) {
    const bot = yield* requireBot(botId);
    yield* store.setLibraryLink(botId, link).pipe(Effect.catch(storageError));
    const { library: _library, ...rest } = bot;
    const next: BotDefinition = link === null ? rest : { ...rest, library: link };
    yield* publish({ _tag: "bot", bot: next });
    return next;
  }, definitionPermit.withPermits(1));

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
    const target = input.target ?? { type: "here" };
    const ranOn =
      target.type === "here"
        ? null
        : yield* requireHooks("Running on another computer needs a connected Library.").pipe(
            Effect.flatMap((hooks) =>
              hooks.resolveTarget(bot, target, remoteProject(bot, input, caller)),
            ),
          );
    if (ranOn !== null)
      return yield* startRemote(bot, checked.values, input, caller, permitBot, options, ranOn);
    const checkout = yield* resolveCheckout(bot, input, caller);
    const projectId = checkout?.projectId ?? (yield* resolveProject(bot, input, caller));
    const vaultLines =
      (bot.vaultSlots?.length ?? 0) === 0
        ? []
        : yield* requireHooks("Loom is still loading Vault bindings. Try again shortly.").pipe(
            Effect.flatMap((hooks) => hooks.vaultLines(bot)),
          );
    const runId = options.remote?.runId ?? (yield* randomUuidV4);
    const modelSelection = options.modelSelection ?? bot.modelSelection;
    const untrusted = untrustedInputs(options, checked.values);

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
        ...(options.retryOf === undefined ? {} : { retryOf: options.retryOf }),
        ...(options.triggerId === undefined ? {} : { triggerId: options.triggerId }),
        ...(options.replayId === undefined ? {} : { replayId: options.replayId }),
        ...(options.pipelineRunId === undefined ? {} : { pipelineRunId: options.pipelineRunId }),
        modelSelection,
        checkoutThreadId: checkout?.threadId ?? null,
        ...(options.remote === undefined ? {} : { requestedBy: options.remote.requestedBy }),
      },
      fiber: null,
      started: false,
      cancelRequested: false,
      launched: false,
      threadRunId: null,
      output: bot.output ?? "text",
    };
    // The stored definition's budget, so a batch pinned to an older version still honours it.
    yield* permitBot.budget === undefined
      ? insertRun(entry.run, options)
      : checkBudget(permitBot).pipe(
          Effect.andThen(insertRun(entry.run, options)),
          budgetPermit.withPermits(1),
        );
    live.set(runId, entry);
    yield* publish({ _tag: "run", run: entry.run });
    entry.fiber = yield* execute(
      entry,
      bot,
      {
        projectId,
        title: bot.name,
        generateTitle: false,
        modelSelection,
        runtimeMode: bot.runtimeMode,
        interactionMode: bot.interactionMode,
        workspaceStrategy,
        initialMessage: {
          text: [
            renderPrompt(
              bot,
              checked.values,
              untrusted === undefined
                ? undefined
                : { ...untrusted, frameId: runId.replaceAll("-", "") },
            ),
            // Standalone lines, the form Vault reads as a launch requirement.
            ...(vaultLines.length === 0 ? [] : [vaultLines.join("\n")]),
          ].join("\n\n"),
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
   * Records a run that never started, as failed with `reason`, so it reaches the inbox and can be
   * retried. It does not count against the bot's budget.
   */
  const recordUnstarted = Effect.fn("BotsService.recordUnstarted")(function* (
    definition: BotDefinition,
    input: BotsRunInput,
    caller: BotCaller,
    reason: string,
    options: StartOptions,
  ) {
    const runId = options.remote?.runId ?? (yield* randomUuidV4);
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
      error: reason,
      ...(options.batchId === undefined ? {} : { batchId: options.batchId }),
      ...(options.triggerId === undefined ? {} : { triggerId: options.triggerId }),
      ...(options.replayId === undefined ? {} : { replayId: options.replayId }),
      ...(options.pipelineRunId === undefined ? {} : { pipelineRunId: options.pipelineRunId }),
      ...(input.checkoutThreadId === undefined ? {} : { checkoutThreadId: input.checkoutThreadId }),
      ...(options.remote === undefined ? {} : { requestedBy: options.remote.requestedBy }),
    };
    yield* insertRun(failed, options);
    yield* publish({ _tag: "run", run: failed });
    return failed;
  });

  /**
   * Starts a run of a pinned definition for a batch item or a trigger. The bot must still exist
   * and be active; its stored limit, not the pinned one, holds the run back. A run that cannot
   * start is recorded as failed, so the item or trigger shows why and can be retried.
   */
  const startRunWith = Effect.fn("BotsService.startRunWith")(function* (
    definition: BotDefinition,
    input: BotsRunInput,
    caller: BotCaller,
    options: StartOptions,
  ) {
    const current = yield* requireBot(definition.id);
    if (current.archivedAt !== null)
      return yield* fail("archived", `${current.name} is archived. Restore it to run it.`);
    return yield* start(definition, input, caller, current, options).pipe(
      // A budget refusal is not recorded: the batch waits for the budget instead.
      Effect.catchIf(
        (error) => error.reason === "invalid" && error.retryAt === undefined,
        (error) => recordUnstarted(definition, input, caller, error.message, options),
      ),
    );
  });

  const getRun = Effect.fn("BotsService.getRun")(function* (runId: string) {
    const current =
      live.get(runId)?.run ?? (yield* store.getRun(runId).pipe(Effect.catch(storageError)));
    if (current === null) return yield* fail("not_found", "The bot run was not found.");
    return current;
  });

  /** Records whether a finished run was good, with an optional note; null clears either. */
  const rateRun = Effect.fn("BotsService.rateRun")(function* (input: BotsRateRunInput) {
    const run = yield* getRun(input.runId);
    if (!isTerminalBotRunStatus(run.status))
      return yield* fail("invalid", "Rate a run once it ends.");
    const note = input.note?.trim() === "" ? null : input.note;
    yield* store
      .rateRun(
        run.id,
        input.rating,
        note,
        input.rating === null && note === null ? null : yield* nowIso,
      )
      .pipe(Effect.catch(storageError));
    const { rating: _rating, note: _note, ...rest } = run;
    const rated: BotRun = {
      ...rest,
      ...(input.rating === null ? {} : { rating: input.rating }),
      ...(note === null ? {} : { note }),
    };
    yield* publish({ _tag: "run", run: rated });
    return rated;
  });

  /** A bot's runs rated `rating`, most recently rated first. */
  const ratedRuns = (botId: string, rating: BotRunRating, limit: number) =>
    store.listRatedRuns(botId, rating, limit).pipe(Effect.catch(storageError));

  /** Marks the finished run that stopped its pipeline, its one inbox item, or clears the mark. */
  const setPipelineStopped = Effect.fn("BotsService.setPipelineStopped")(function* (
    runId: string,
    stopped: boolean,
  ) {
    const run = yield* getRun(runId);
    yield* store.setPipelineStopped(runId, stopped).pipe(Effect.catch(storageError));
    const { pipelineStopped: _pipelineStopped, ...rest } = run;
    const next: BotRun = stopped ? { ...rest, pipelineStopped: true } : rest;
    yield* publish({ _tag: "run", run: next });
    return next;
  });

  const cancel = Effect.fn("BotsService.cancel")(function* (runId: string) {
    let entry = live.get(runId);
    if (entry === undefined) {
      const run = yield* getRun(runId);
      // After a restart an unfinished run is live only once recovery reaches it.
      if (run.ranOn == null && !isTerminalBotRunStatus(run.status)) {
        yield* Deferred.await(recovered);
        entry = live.get(runId);
      }
    }
    if (entry === undefined) {
      const run = yield* getRun(runId);
      // The other computer reports the cancelled run back like any other ending.
      if (
        run.ranOn != null &&
        !isTerminalBotRunStatus(run.status) &&
        anywhere !== null &&
        (yield* anywhere.cancel(run))
      )
        return yield* settleRemote(run, { status: "cancelled", finishedAt: yield* nowIso });
      return run;
    }
    entry.cancelRequested = true;
    if (!entry.started && entry.fiber !== null) yield* Fiber.interrupt(entry.fiber);
    // Before launch returns there is no thread yet; the launch path interrupts it after.
    else if (entry.launched) yield* interruptThread(entry, "The bot run was cancelled.");
    return entry.run;
  });

  const inbox = (input: BotsInboxInput) =>
    store
      .inbox({ dismissed: input.dismissed === true, before: input.before, limit: input.limit })
      .pipe(Effect.catch(storageError));

  /**
   * Reruns an inbox run with the bot as saved now, from where the old run started: its project,
   * checkout and calling thread. The old run leaves the inbox, and a batch item follows the retry.
   * Serialized, so two retries of one run cannot both pass the check.
   */
  const retry = Effect.fn("BotsService.retry")(function* (
    input: BotsRetryInput,
    caller: BotCaller,
  ) {
    return yield* Effect.gen(function* () {
      const old = yield* getRun(input.runId);
      if (old.pipelineRunId != null)
        return yield* fail(
          "invalid",
          "This run belongs to a pipeline. Resume the pipeline instead.",
        );
      if (old.retriedBy != null)
        return yield* fail("invalid", "This run was already retried; retry the newer run.");
      if (!isBotInboxRun(old))
        return yield* fail(
          "invalid",
          "Only a failed, timed out or undecided run in the inbox can be retried.",
        );
      yield* checkCaller({ botId: old.botId, inputs: old.inputs }, caller);
      const bot = yield* requireBot(old.botId);
      yield* checkRunnable(bot, caller);
      const { batchId } = old;
      // A restart requeues an item whose run never started; its batch reruns it, not a retry.
      if (
        batchId != null &&
        (yield* store.batchRerunsWithout(batchId, old.id).pipe(Effect.catch(storageError)))
      )
        return yield* fail("invalid", BATCH_RERUNS_ITEM);
      return yield* start(
        bot,
        {
          botId: old.botId,
          inputs: old.inputs,
          ...(old.projectId === null ? {} : { projectId: old.projectId }),
          ...(old.checkoutThreadId == null ? {} : { checkoutThreadId: old.checkoutThreadId }),
          ...(old.notify === true ? { notify: true } : {}),
          ...(old.ranOn == null
            ? {}
            : { target: { type: "environment", environmentId: old.ranOn.environmentId } }),
        },
        { ...caller, threadId: old.callerThreadId, projectId: old.projectId },
        bot,
        {
          batchId: batchId ?? undefined,
          triggerId: old.triggerId ?? undefined,
          modelSelection: input.modelSelection,
          retryOf: old.id,
          onInserted: (inserted) =>
            store.setRetriedBy(old.id, inserted.id).pipe(
              Effect.andThen(
                batchId == null
                  ? Effect.void
                  : store.replaceBatchItemRun(batchId, old.id, inserted.id).pipe(
                      // The batch requeued the item since the check; rolls the retry back.
                      Effect.andThen(store.batchRerunsWithout(batchId, inserted.id)),
                      Effect.flatMap((reruns) =>
                        reruns ? Effect.fail(fail("invalid", BATCH_RERUNS_ITEM)) : Effect.void,
                      ),
                    ),
              ),
            ),
        },
      ).pipe(Effect.tap((next) => publish({ _tag: "run", run: { ...old, retriedBy: next.id } })));
    }).pipe(retryPermit.withPermits(1));
  });

  /** Takes finished runs out of the inbox, or puts them back. */
  const dismiss = Effect.fn("BotsService.dismiss")(function* (input: BotsDismissInput) {
    const runs = yield* Effect.forEach([...new Set(input.runIds)], getRun);
    if (runs.some((run) => !isTerminalBotRunStatus(run.status)))
      return yield* fail("invalid", "A run that is still going cannot be dismissed.");
    const dismissedAt = input.dismissed ? yield* nowIso : null;
    yield* store
      .setDismissed(
        runs.map((run) => run.id),
        dismissedAt,
      )
      .pipe(Effect.catch(storageError));
    const updated = runs.map((run): BotRun => ({ ...run, dismissedAt }));
    for (const run of updated) yield* publish({ _tag: "run", run });
    return updated;
  });

  /**
   * Forks a finished run into an ordinary thread to continue it. The command id makes a repeated
   * request the same fork; a thread deleted since is opened again under a new id.
   */
  const promote = Effect.fn("BotsService.promote")(function* (runId: string, caller: BotCaller) {
    const run = yield* getRun(runId);
    if (!isTerminalBotRunStatus(run.status))
      return yield* fail("invalid", "Open a run as a thread once it ends, or cancel it first.");
    const previous = run.promotedThreadId ?? null;
    if (previous !== null) {
      const shell = yield* threads.getThreadShell(previous).pipe(Effect.orElseSucceed(() => null));
      if (shell !== null && shell.deletedAt === null)
        return { threadId: previous, created: false } satisfies BotsPromoteResult;
    }
    const suffix = previous === null ? "" : `-${(yield* randomUuidV4).slice(0, 8)}`;
    // Not the run prefix, so every list that hides bot runs shows this thread.
    const threadId = ThreadId.make(`bot-open-${run.id}${suffix}`);
    yield* threads
      .dispatch({
        type: "thread.fork",
        commandId: CommandId.make(`bot-promote:${run.id}${suffix}`),
        sourceThreadId: run.threadId,
        targetThreadId: threadId,
        sourcePoint: { type: "latest_stable" },
        title: promotedTitle(run),
        createdBy: caller.actor,
        creationSource: "server",
      })
      .pipe(
        Effect.mapError((error) =>
          fail("launch", `Loom could not open the run as a thread: ${errorMessage(error)}`),
        ),
      );
    yield* store.setPromotedThread(run.id, threadId).pipe(Effect.catch(storageError));
    yield* publish({ _tag: "run", run: { ...run, promotedThreadId: threadId } });
    return { threadId, created: true } satisfies BotsPromoteResult;
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
      const current = yield* store
        .getDefinition(stored.botId)
        .pipe(Effect.orElseSucceed(() => null));
      const version = yield* store
        .getVersion(stored.botId, stored.botVersion)
        .pipe(Effect.orElseSucceed(() => null));
      const definition = version?.definition ?? current;
      const entry: LiveRun = {
        run: stored,
        fiber: null,
        started: stored.status === "running",
        cancelRequested: false,
        launched: stored.status === "running",
        threadRunId: null,
        output: definition?.output ?? "text",
      };
      if (stored.status === "queued") {
        yield* finish(entry, {
          status: "failed",
          error: RESTARTED_BEFORE_START,
        });
        continue;
      }
      live.set(stored.id, entry);
      yield* accountRecovered(stored.botId, 1);
      const limitMs = (definition?.timeoutMinutes ?? FALLBACK_TIMEOUT_MINUTES) * 60_000;
      const startedMs = stored.startedAt === null ? nowMs : Date.parse(stored.startedAt);
      const remainingMs = Math.max(1, limitMs - (nowMs - startedMs));
      entry.fiber = yield* awaitThread(entry, remainingMs).pipe(
        Effect.catch(recordFailure(entry)),
        Effect.catchDefect(recordFailure(entry)),
        Effect.ensuring(accountRecovered(stored.botId, -1)),
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

  /** Runs, outcomes, durations and tokens per bot for a window, and every budget as it stands. */
  const usage = Effect.fn("BotsService.usage")(function* (input: BotsUsageInput) {
    const since = Date.parse(input.since);
    const until = Date.parse(input.until);
    if (Number.isNaN(since) || Number.isNaN(until) || since >= until)
      return yield* fail("invalid", "Choose a window whose start is before its end.");
    if (until - since > BOTS_USAGE_MAX_DAYS * BUDGET_WINDOW_MS)
      return yield* fail("invalid", `Choose a window of at most ${BOTS_USAGE_MAX_DAYS} days.`);
    const bots = yield* list();
    const runs = yield* store
      .listRunsCreatedBetween({
        since: isoAt(since),
        until: isoAt(until),
        botId: input.botId,
      })
      .pipe(Effect.catch(storageError));
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const budgeted = bots.filter(
      (bot) => bot.budget !== undefined && (input.botId === undefined || bot.id === input.botId),
    );
    const budgets: Record<string, BotsUsageResult["budgets"][string]> = {};
    for (const bot of budgeted) budgets[bot.id] = yield* budgetFor(bot, nowMs);
    // A pipeline spans several bots, so a view of one bot leaves pipelines out.
    const pipelineRuns =
      input.botId === undefined
        ? yield* store
            .listPipelineRunsCreatedBetween({ since: isoAt(since), until: isoAt(until) })
            .pipe(Effect.catch(storageError))
        : [];
    const pipelines = summarizePipelineUsage(
      pipelineRuns.map((row) => ({
        id: row.id,
        pipelineId: row.pipeline_id,
        pipelineName: row.pipeline_name,
        status: row.status,
      })),
      runs,
    );
    return {
      ...summarizeUsage(runs, bots),
      budgets,
      ...(pipelines.length === 0 ? {} : { pipelines }),
    } satisfies BotsUsageResult;
  });

  return {
    list,
    get: requireBot,
    save,
    definitionAt,
    versions,
    version,
    setStable,
    restoreVersion,
    rateRun,
    ratedRuns,
    archive,
    delete: remove,
    run,
    startRunWith,
    setPipelineStopped,
    recordUnstarted,
    applyRemoteUpdate,
    setLibraryLink,
    /** Saves what the Library has for a shared bot, without publishing it back. */
    writeFromLibrary: (definition: BotDefinitionInput, link: BotLibraryLink, caller: BotCaller) =>
      write(definition, caller, { library: link, savedBy: "user" }),
    setAnywhereHooks: (hooks: BotsAnywhereHooks) =>
      Effect.sync(() => {
        anywhere = hooks;
      }),
    checkCaller,
    checkRunnable,
    threadCaller,
    cancel,
    getRun,
    listRuns,
    inbox,
    retry,
    dismiss,
    promote,
    usage,
    checkBudget,
    budgetNow,
    checkDefinition,
    awaitRun,
    activeRunCount,
    /** Runs holding or waiting for a permit on this computer, across every bot. */
    activeRuns: Effect.sync(() => live.size),
    recover,
    /** Marks recovery done, whatever its outcome, so work that depends on it can go ahead. */
    markRecovered: Deferred.succeed(recovered, undefined).pipe(Effect.asVoid),
    whenRecovered: Deferred.await(recovered),
    /** Marks starter seeding done, whatever its outcome. */
    markSeeded: Deferred.succeed(seeded, undefined).pipe(Effect.asVoid),
    whenSeeded: Deferred.await(seeded),
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
          bots.seedStarters().pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Seeding starter bots failed", { cause }),
            ),
            Effect.ensuring(bots.markSeeded),
          ),
        ),
      ),
    );
  }),
);
