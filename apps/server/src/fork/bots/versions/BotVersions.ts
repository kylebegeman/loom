import {
  BOT_DRAFT_VERSION,
  BotsError,
  isTerminalBotRunStatus,
  type BotDefinition,
  type BotDraftResult,
  type BotReplay,
  type BotReplayItem,
  type BotRun,
  type BotsChange,
  type BotsReplayInput,
  type BotsRunInput,
  type BotsSuggestEditInput,
} from "@t3tools/contracts/fork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { forkParked } from "../../../serverActivation.ts";
import { isoAt } from "../BotBudgets.ts";
import {
  BotsService,
  RESTARTED_BEFORE_START,
  versionInput,
  type BotCaller,
} from "../BotsService.ts";
import {
  makeDraftingThread,
  mergeRefinement,
  UNUSABLE_REFINEMENT,
} from "../fromThread/BotDrafts.ts";
import { validateInputs } from "../render.ts";
import {
  makeBotReplaysStore,
  REPLAY_KEPT_DAYS,
  REPLAYS_KEPT_PER_BOT,
  type StoredReplay,
} from "./BotReplaysStore.ts";
import { compareRuns, sameValue, summarizeItems } from "./compare.ts";
import { SUGGEST_DOWN_RUNS, SUGGEST_UP_RUNS, suggestEditPrompt } from "./suggestEdit.ts";

/** Replay runs at once, below the bot's own limit, so a replay leaves room for real work. */
export const REPLAY_MAX_CONCURRENCY = 5;
const DAY_MS = 86_400_000;

const fail = (reason: BotsError["reason"], message: string) => new BotsError({ reason, message });

const storageError = (cause: unknown) =>
  Effect.logWarning("Bot replay storage failed", { cause }).pipe(
    Effect.andThen(Effect.fail(fail("storage", "Loom could not read or write bot replays."))),
  );

const isWaiting = (item: BotReplayItem) =>
  item.replayRunId === null && item.comparison === "pending";
const isInFlight = (item: BotReplayItem) =>
  item.replayRunId !== null && item.comparison === "pending";

/** The run a replay item repeats, with the same inputs and the same project and checkout. */
const rerunInput = (original: BotRun): BotsRunInput => ({
  botId: original.botId,
  inputs: original.inputs,
  ...(original.projectId === null ? {} : { projectId: original.projectId }),
  ...(original.checkoutThreadId == null ? {} : { checkoutThreadId: original.checkoutThreadId }),
});

export const make = Effect.gen(function* () {
  const store = yield* makeBotReplaysStore;
  const bots = yield* BotsService;
  const drafting = yield* makeDraftingThread;
  const serviceScope = yield* Effect.scope;
  const feeders = new Map<string, Fiber.Fiber<void>>();

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const requireStored = Effect.fnUntraced(function* (replayId: string) {
    const stored = yield* store.getReplay(replayId).pipe(Effect.catch(storageError));
    if (stored === null) return yield* fail("not_found", "The bot replay was not found.");
    return stored;
  });

  const load = Effect.fnUntraced(function* (replayId: string) {
    const stored = yield* requireStored(replayId);
    const items = yield* store.getItems(replayId).pipe(Effect.catch(storageError));
    return {
      stored,
      items,
      replay: { ...stored.replay, items, summary: summarizeItems(items) } satisfies BotReplay,
    };
  });

  // Replay runs never post anywhere, so they carry no calling thread.
  const callerOf = (stored: StoredReplay): BotCaller => ({
    actor: stored.startedBy,
    threadId: null,
    projectId: null,
    runtimeMode: null,
  });

  /** Records how a finished replay run compares with its original. Safe to repeat. */
  const settle = Effect.fnUntraced(function* (
    replayId: string,
    originalRunId: string,
    replayRun: BotRun,
  ) {
    if (!isTerminalBotRunStatus(replayRun.status)) return;
    const original = yield* bots.getRun(originalRunId).pipe(Effect.option);
    const comparison = original._tag === "Some" ? compareRuns(original.value, replayRun) : "failed";
    const reason =
      comparison !== "failed"
        ? null
        : original._tag === "None"
          ? "The original run is no longer stored."
          : replayRun.error;
    yield* store
      .setItemResult(replayId, originalRunId, comparison, reason)
      .pipe(Effect.catch(storageError));
  });

  const feedItem = Effect.fnUntraced(function* (
    stored: StoredReplay,
    definition: BotDefinition,
    item: BotReplayItem,
  ) {
    const replayId = stored.replay.id;
    const original = yield* bots.getRun(item.originalRunId).pipe(Effect.option);
    if (original._tag === "None")
      return yield* store
        .setItemResult(
          replayId,
          item.originalRunId,
          "failed",
          "The original run is no longer stored.",
        )
        .pipe(Effect.catch(storageError));
    const started = yield* bots
      .startRunWith(definition, rerunInput(original.value), callerOf(stored), {
        replayId,
        onInserted: (run) => store.setItemRun(replayId, item.originalRunId, run.id),
      })
      .pipe(
        Effect.uninterruptible,
        // A replay is a test, so it does not wait out a budget; the item fails and says why.
        Effect.catch((error) =>
          store
            .setItemResult(replayId, item.originalRunId, "failed", error.message)
            .pipe(Effect.catch(storageError), Effect.as(null)),
        ),
      );
    if (started === null) return;
    const finished = yield* bots.awaitRun(started.id);
    yield* settle(replayId, item.originalRunId, finished);
  });

  /** Waiting items fail with `reason` and runs in flight are cancelled. */
  const close = Effect.fnUntraced(function* (replayId: string, reason: string) {
    const stored = yield* requireStored(replayId);
    if (stored.replay.status !== "running") return;
    yield* store
      .withTransaction(
        store
          .setStatus(replayId, "cancelled", yield* nowIso)
          .pipe(Effect.andThen(store.failWaiting(replayId, reason))),
      )
      .pipe(Effect.catch(storageError));
    const items = yield* store.getItems(replayId).pipe(Effect.catch(storageError));
    for (const item of items)
      if (isInFlight(item) && item.replayRunId !== null)
        yield* bots.cancel(item.replayRunId).pipe(Effect.ignore({ log: true }));
  });

  const feed = Effect.fnUntraced(function* (replayId: string) {
    const stored = yield* requireStored(replayId);
    if (stored.replay.status !== "running") return;
    const { source } = stored.replay;
    const definition =
      stored.draft ??
      (yield* bots.definitionAt(
        stored.replay.botId,
        source.kind === "version" ? source.version : "latest",
      ));
    const current = yield* bots.get(stored.replay.botId);
    const window = Math.min(current.maxConcurrentRuns, REPLAY_MAX_CONCURRENCY);
    const items = yield* store.getItems(replayId).pipe(Effect.catch(storageError));
    yield* Effect.all(
      [
        Effect.forEach(
          items.filter(isInFlight),
          (item) =>
            bots
              .awaitRun(item.replayRunId ?? "")
              .pipe(Effect.flatMap((run) => settle(replayId, item.originalRunId, run))),
          { concurrency: "unbounded", discard: true },
        ),
        Effect.forEach(items.filter(isWaiting), (item) => feedItem(stored, definition, item), {
          concurrency: window,
          discard: true,
        }),
      ],
      { concurrency: 2, discard: true },
    );
    yield* store.setStatus(replayId, "done", yield* nowIso).pipe(Effect.catch(storageError));
  });

  const startFeeder = Effect.fnUntraced(function* (replayId: string) {
    // Registered before it runs, so its own cleanup never races the registration.
    const registered = yield* Deferred.make<void>();
    const fiber = yield* Deferred.await(registered).pipe(
      Effect.andThen(feed(replayId)),
      Effect.catch((error) =>
        Effect.logWarning("Bot replay stopped", { replayId, error }).pipe(
          Effect.andThen(close(replayId, error.message)),
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Bot replay feeder failed", { replayId, cause }),
      ),
      Effect.ensuring(Effect.sync(() => feeders.delete(replayId))),
      Effect.forkIn(serviceScope),
    );
    feeders.set(replayId, fiber);
    yield* Deferred.succeed(registered, undefined);
  });

  const stopFeeder = Effect.fnUntraced(function* (replayId: string) {
    const fiber = feeders.get(replayId);
    if (fiber !== undefined) yield* Fiber.interrupt(fiber);
  });

  /**
   * Runs chosen runs again with a draft or a saved version. Every run must fit the bot's daily run
   * budget up front, since a replay that stops halfway compares nothing useful.
   */
  const replay = Effect.fn("BotVersions.replay")(function* (
    input: BotsReplayInput,
    caller: BotCaller,
  ) {
    if ((input.draft === undefined) === (input.version === undefined))
      return yield* fail("invalid", "Replay either a draft or a saved version.");
    yield* bots.checkCaller({ botId: input.botId, inputs: {} }, caller);
    const current = yield* bots.get(input.botId);
    yield* bots.checkRunnable(current, caller);
    let definition: BotDefinition;
    if (input.draft === undefined) {
      definition = yield* bots.definitionAt(current.id, input.version ?? current.version);
    } else {
      if (input.draft.id !== current.id)
        return yield* fail("invalid", "The draft belongs to another bot.");
      yield* bots.checkDefinition(input.draft, caller);
      definition = { ...current, ...input.draft, version: BOT_DRAFT_VERSION };
    }
    yield* bots.checkRunnable(definition, caller);

    const originals = yield* Effect.forEach([...new Set(input.runIds)], (runId) =>
      bots.getRun(runId),
    );
    for (const run of originals) {
      if (run.botId !== current.id)
        return yield* fail("invalid", `Replay only runs of ${current.name}.`);
      if (!isTerminalBotRunStatus(run.status))
        return yield* fail("invalid", "Replay runs once they end.");
      if (run.replayId != null) return yield* fail("invalid", "A replay run cannot be replayed.");
    }
    const items = originals.map((run): BotReplayItem => {
      const checked = validateInputs(definition, run.inputs);
      return {
        originalRunId: run.id,
        replayRunId: null,
        comparison: checked.ok ? "pending" : "failed",
        reason: checked.ok ? null : checked.message,
      };
    });
    const needed = items.filter(isWaiting).length;
    const runsPerDay = current.budget?.runsPerDay;
    if (runsPerDay !== undefined) {
      const room = Math.max(0, runsPerDay - (yield* bots.budgetNow(current)).runsInWindow);
      if (needed > room)
        return yield* fail(
          "invalid",
          `${current.name} has room for ${room} more run${room === 1 ? "" : "s"} today; this replay needs ${needed}.`,
        );
    }

    const now = yield* nowIso;
    const stored: StoredReplay = {
      replay: {
        id: yield* randomUuidV4,
        botId: current.id,
        source:
          input.draft === undefined
            ? { kind: "version", version: definition.version }
            : { kind: "draft" },
        baseVersion: current.version,
        createdAt: now,
        finishedAt: needed === 0 ? now : null,
        status: needed === 0 ? "done" : "running",
      },
      draft: input.draft === undefined ? null : definition,
      startedBy: caller.actor,
    };
    yield* store.insertReplay(stored, items).pipe(Effect.catch(storageError));
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    yield* store
      .pruneReplays(current.id, REPLAYS_KEPT_PER_BOT, isoAt(nowMs - REPLAY_KEPT_DAYS * DAY_MS))
      .pipe(Effect.ignore({ log: true }));
    if (needed > 0) yield* startFeeder(stored.replay.id);
    return (yield* load(stored.replay.id)).replay;
  });

  const get = Effect.fn("BotVersions.getReplay")(function* (replayId: string) {
    return (yield* load(replayId)).replay;
  });

  /** The replay once nothing is feeding it; a cancelled or recovered replay may still settle. */
  const awaitReplay = Effect.fn("BotVersions.awaitReplay")(function* (replayId: string) {
    const fiber = feeders.get(replayId);
    if (fiber !== undefined) yield* Fiber.await(fiber);
    return (yield* load(replayId)).replay;
  });

  const cancel = Effect.fn("BotVersions.cancelReplay")(function* (replayId: string) {
    const stored = yield* requireStored(replayId);
    if (stored.replay.status === "running") {
      yield* stopFeeder(replayId);
      yield* close(replayId, "The replay was cancelled before this run started.");
    }
    return (yield* load(replayId)).replay;
  });

  /** Asks the bot's model for an edit that would avoid what its down-rated runs got wrong. */
  const suggestEdit = Effect.fn("BotVersions.suggestEdit")(function* (input: BotsSuggestEditInput) {
    const current = yield* bots.get(input.botId);
    const down =
      input.runIds === undefined
        ? yield* bots.ratedRuns(current.id, "down", SUGGEST_DOWN_RUNS)
        : yield* Effect.forEach([...new Set(input.runIds)], (runId) => bots.getRun(runId));
    if (down.some((run) => run.botId !== current.id))
      return yield* fail("invalid", `Suggest an edit from runs of ${current.name} only.`);
    const first = down[0];
    if (first === undefined)
      return yield* fail(
        "invalid",
        "Mark a run as bad first, so there is something to learn from.",
      );
    const chosen = new Set(down.map((run) => run.id));
    const up = (yield* bots.ratedRuns(current.id, "up", SUGGEST_UP_RUNS)).filter(
      (run) => !chosen.has(run.id),
    );
    const draft = versionInput(current);
    const reply = yield* drafting.ask({
      title: `Suggest an edit to ${current.name}`,
      modelSelection: current.modelSelection,
      text: suggestEditPrompt(draft, down, up),
    });
    const merged = reply === null ? null : mergeRefinement(draft, reply);
    return {
      draft: merged ?? draft,
      sourceThreadId: first.threadId,
      notes:
        reply === null
          ? ["The model took too long; showing the current version."]
          : merged === null
            ? [UNUSABLE_REFINEMENT]
            : sameValue(merged, draft)
              ? ["The model suggested no change."]
              : [],
    } satisfies BotDraftResult;
  });

  const closeBotReplays = Effect.fnUntraced(function* (botId: string, reason: string) {
    const running = yield* store.listRunning().pipe(Effect.catch(storageError));
    for (const stored of running) {
      if (stored.replay.botId !== botId) continue;
      yield* stopFeeder(stored.replay.id);
      yield* close(stored.replay.id, reason);
    }
  });

  /** Settles items whose run ended after the replay stopped feeding, and stops a gone bot's. */
  const onBotsChange = (change: BotsChange) =>
    Effect.gen(function* () {
      switch (change._tag) {
        case "run": {
          const replayId = change.run.replayId;
          if (replayId == null || !isTerminalBotRunStatus(change.run.status)) return;
          const originalRunId = yield* store
            .originalForRun(replayId, change.run.id)
            .pipe(Effect.catch(storageError));
          if (originalRunId !== null) yield* settle(replayId, originalRunId, change.run);
          return;
        }
        case "bot":
          if (change.bot.archivedAt !== null)
            yield* closeBotReplays(change.bot.id, "The bot was archived.");
          return;
        case "bot-deleted":
          yield* closeBotReplays(change.botId, "The bot was deleted.");
          // Nothing can show a deleted bot's replays, so they go with it.
          yield* store.pruneReplays(change.botId, 0, "9999").pipe(Effect.catch(storageError));
          return;
      }
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("Bot replay update failed", { cause })));

  yield* bots.changes.pipe(Stream.runForEach(onBotsChange), Effect.forkIn(serviceScope));

  /** After bot run recovery: runs that never started go back to wait, and feeding resumes. */
  const recover = Effect.fn("BotVersions.recover")(function* () {
    yield* bots.whenRecovered;
    const running = yield* store.listRunning().pipe(Effect.catch(storageError));
    for (const stored of running) {
      if (feeders.has(stored.replay.id)) continue;
      const items = yield* store.getItems(stored.replay.id).pipe(Effect.catch(storageError));
      for (const item of items) {
        if (item.replayRunId === null) continue;
        const run = yield* bots.getRun(item.replayRunId).pipe(Effect.option);
        if (
          run._tag === "None" ||
          (run.value.status === "failed" && run.value.error === RESTARTED_BEFORE_START)
        )
          yield* store
            .requeueItem(stored.replay.id, item.originalRunId)
            .pipe(Effect.catch(storageError));
      }
      yield* startFeeder(stored.replay.id);
    }
  });

  return { replay, get, awaitReplay, cancel, suggestEdit, recover };
});

export class BotVersions extends Context.Service<BotVersions, Effect.Success<typeof make>>()(
  "t3/fork/bots/versions/BotVersions",
) {}

export const layer = Layer.effect(BotVersions, make);

/** Resumes replays the previous server left running, once bot runs are recovered. */
export const BotVersionsRecoveryLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const versions = yield* BotVersions;
    yield* forkParked(
      versions
        .recover()
        .pipe(
          Effect.catchCause((cause) => Effect.logWarning("Bot replay recovery failed", { cause })),
        ),
    );
  }),
);
