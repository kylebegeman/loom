import type { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  BOTS_BATCH_MAX_ATTEMPTS,
  BOTS_MAX_ACTIVE_RUNS,
  BotsError,
  isTerminalBotRunStatus,
  type BotBatch,
  type BotBatchChange,
  type BotBatchItem,
  type BotBatchPreview,
  type BotBatchRetryResult,
  type BotDefinition,
  type BotTarget,
  type BotInputs,
  type BotsBatchInput,
  type BotsChange,
  type BotsListBatchesInput,
  type BotsRetryBatchInput,
} from "@t3tools/contracts/fork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import type { SqlError } from "effect/sql/SqlError";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../../serverActivation.ts";
import {
  BATCHES_KEPT_PER_BOT,
  countItems,
  makeBotBatchesStore,
  type NewBatchItem,
  type StoredBatch,
} from "./BotBatchesStore.ts";
import { BotsService, RESTARTED_BEFORE_START, type BotCaller } from "./BotsService.ts";
import { renderBatchReport } from "./batchReport.ts";
import { cutLabel, makeBatchSources, type SourceCheckout } from "./batchSources.ts";
import { validateInputs } from "./render.ts";

const PREVIEW_ITEMS = 20;
/** A fan-out step's items come from an earlier step's output, so every input is framed. */
export const PIPELINE_ITEM_ORIGIN = "an earlier step of this run's pipeline";
const PREVIEW_INVALID = 5;

const fail = (reason: BotsError["reason"], message: string) => new BotsError({ reason, message });

const storageError = (cause: unknown) =>
  Effect.logWarning("Bot batch storage failed", { cause }).pipe(
    Effect.andThen(Effect.fail(fail("storage", "Loom could not read or write bot batches."))),
  );

const isRetryable = (item: BotBatchItem, includeAttention: boolean) => {
  const run = item.run;
  if (item.state !== "started" || run === null) return false;
  if (run.status === "failed" || run.status === "timed_out") return true;
  return (
    run.status === "completed" &&
    (run.verdict?.verdict === "fail" ||
      (includeAttention && run.verdict?.verdict === "needs_attention"))
  );
};

const isInFlight = (item: BotBatchItem) =>
  item.state === "started" && item.run !== null && !isTerminalBotRunStatus(item.run.status);

interface Prepared {
  readonly bot: BotDefinition;
  readonly projectId: ProjectId | null;
  readonly checkoutThreadId: ThreadId | null;
  readonly summary: string;
  readonly note: string | null;
  readonly valid: ReadonlyArray<NewBatchItem>;
  readonly invalid: ReadonlyArray<{ readonly label: string; readonly message: string }>;
}

export const make = Effect.gen(function* () {
  const store = yield* makeBotBatchesStore;
  const bots = yield* BotsService;
  const sources = yield* makeBatchSources;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serviceScope = yield* Effect.scope;
  const changes = yield* PubSub.unbounded<BotBatchChange>();
  const feeders = new Map<string, Fiber.Fiber<void>>();
  /** Batches their bot's budget holds back, until when; only a running feeder sets one. */
  const pausedUntil = new Map<string, string>();

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const publish = (change: BotBatchChange) => PubSub.publish(changes, change).pipe(Effect.asVoid);

  const summarize = (stored: StoredBatch, items: ReadonlyArray<BotBatchItem>): BotBatch => {
    const paused = pausedUntil.get(stored.batch.id);
    return {
      ...stored.batch,
      total: items.length,
      counts: countItems(items),
      ...(paused === undefined ? {} : { pausedUntil: paused }),
    };
  };

  const requireStored = Effect.fnUntraced(function* (batchId: string) {
    const stored = yield* store.getBatch(batchId).pipe(Effect.catch(storageError));
    if (stored === null) return yield* fail("not_found", "The bot batch was not found.");
    return stored;
  });

  const load = Effect.fnUntraced(function* (batchId: string) {
    const stored = yield* requireStored(batchId);
    const items = yield* store.getItems(batchId).pipe(Effect.catch(storageError));
    return { stored, items, batch: summarize(stored, items) };
  });

  const publishSummary = (batchId: string) =>
    load(batchId).pipe(
      Effect.flatMap(({ batch }) => publish({ _tag: "batch", batch })),
      Effect.ignore({ log: true }),
    );

  /** The project a batch runs in, the same way a single run picks it. Null for a scratch bot. */
  const resolveProjectId = (bot: BotDefinition, input: BotsBatchInput, caller: BotCaller) => {
    const chosen = input.projectId ?? caller.projectId;
    if (bot.workspace.type === "scratch") return Effect.succeed(chosen ?? null);
    const projectId = bot.workspace.projectId ?? chosen ?? bot.scopeProjectId;
    if (bot.scopeProjectId !== null && projectId !== null && projectId !== bot.scopeProjectId)
      return Effect.fail(fail("invalid", `${bot.name} belongs to another project.`));
    return Effect.succeed(projectId);
  };

  /**
   * The checkout file sources read: the chosen thread's, else the calling thread's when it is in
   * the same project, else the project root. Runs of a `caller` checkout bot use the same one.
   */
  const resolveCheckout = Effect.fnUntraced(function* (
    projectId: ProjectId,
    chosenThreadId: ThreadId | undefined,
    caller: BotCaller,
  ) {
    const project = yield* projects.get(projectId).pipe(
      Effect.mapError(() => fail("storage", "Loom could not read the project.")),
      Effect.map(Option.getOrNull),
    );
    if (project === null || project.deletedAt !== null)
      return yield* fail("invalid", "The project for this batch no longer exists.");
    const threadId = chosenThreadId ?? caller.threadId;
    if (threadId === null)
      return { checkoutThreadId: null, cwd: project.workspaceRoot, root: true };
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => fail("invalid", "Loom could not read the thread to run in.")));
    const usable = shell !== null && shell.deletedAt === null && shell.projectId === projectId;
    if (!usable) {
      if (chosenThreadId === undefined)
        return { checkoutThreadId: null, cwd: project.workspaceRoot, root: true };
      return yield* fail("invalid", "The chosen checkout belongs to another project.");
    }
    return {
      checkoutThreadId: threadId,
      cwd: shell.worktreePath ?? project.workspaceRoot,
      root: shell.worktreePath === null,
    };
  });

  /** Resolves the source and checks every item, without writing anything. */
  const prepare = Effect.fnUntraced(function* (input: BotsBatchInput, caller: BotCaller) {
    yield* bots.checkCaller({ botId: input.botId, inputs: {} }, caller);
    const bot = yield* bots.get(input.botId);
    yield* bots.checkRunnable(bot, caller);
    const { source } = input;
    const itemParameter = input.itemParameter;
    if (itemParameter === undefined && source.type !== "inputs")
      return yield* fail("invalid", "Choose the input each item fills.");
    if (
      itemParameter !== undefined &&
      !bot.parameters.some((parameter) => parameter.name === itemParameter)
    )
      return yield* fail("invalid", `${bot.name} has no input named ${itemParameter}.`);

    const projectId = yield* resolveProjectId(bot, input, caller);
    const chosenThreadId =
      source.type === "glob" || source.type === "conflicts" || source.type === "search"
        ? source.checkoutThreadId
        : undefined;
    const checkout =
      projectId === null ? null : yield* resolveCheckout(projectId, chosenThreadId, caller);
    if (source.type === "conflicts" && checkout !== null) {
      // The runs must open the same checkout, or they would find nothing to resolve.
      const sameCheckout =
        bot.workspace.type === "project" &&
        !bot.workspace.worktree &&
        (bot.workspace.checkout === "caller" || checkout.root);
      if (!sameCheckout)
        return yield* fail(
          "invalid",
          "This bot runs in its own worktree, so it would not see these conflicts.",
        );
    }

    const shared: BotInputs = input.sharedInputs ?? {};
    const resolved =
      source.type === "inputs"
        ? {
            items: source.items.map((item, index) => {
              const inputs = { ...shared, ...item };
              const value =
                itemParameter === undefined ? Object.values(item)[0] : inputs[itemParameter];
              return {
                label: cutLabel(value === undefined ? `Item ${index + 1}` : String(value)),
                inputs,
              };
            }),
            summary: `Listed inputs, ${source.items.length} item${source.items.length === 1 ? "" : "s"}`,
            note: null,
          }
        : yield* sources
            .resolve(
              source,
              projectId === null || checkout === null
                ? null
                : ({ projectId, cwd: checkout.cwd } satisfies SourceCheckout),
            )
            .pipe(
              Effect.map((found) => ({
                ...found,
                items: found.items.map((item) => ({
                  label: item.label,
                  inputs: { ...shared, [itemParameter ?? ""]: item.value },
                })),
              })),
            );

    const valid: Array<NewBatchItem> = [];
    const invalid: Array<{ label: string; message: string }> = [];
    for (const item of resolved.items) {
      const checked = validateInputs(bot, item.inputs);
      if (checked.ok) valid.push({ label: item.label, inputs: checked.values });
      else invalid.push({ label: item.label, message: checked.message });
    }
    return {
      bot,
      projectId,
      checkoutThreadId: checkout?.checkoutThreadId ?? null,
      summary: resolved.summary,
      note: resolved.note,
      valid,
      invalid,
    } satisfies Prepared;
  });

  const preview = Effect.fn("BotBatches.preview")(function* (
    input: BotsBatchInput,
    caller: BotCaller,
  ) {
    const prepared = yield* prepare(input, caller);
    return {
      total: prepared.valid.length + prepared.invalid.length,
      items: prepared.valid.slice(0, PREVIEW_ITEMS),
      invalid: prepared.invalid.slice(0, PREVIEW_INVALID),
      sourceSummary: prepared.summary,
      note: prepared.note,
    } satisfies BotBatchPreview;
  });

  const callerOf = (stored: StoredBatch): BotCaller => ({
    actor: stored.batch.startedBy,
    threadId: stored.batch.callerThreadId,
    projectId: stored.batch.projectId,
    runtimeMode: null,
  });

  /**
   * Starts one item; its row turns `started` in the run's own insert, so a crash cannot split them.
   * While the bot's budget refuses, the item stays pending and the batch waits until the budget
   * allows a run, then asks again; a restart in between starts a feeder that asks again.
   */
  const feedItem = Effect.fnUntraced(function* (stored: StoredBatch, item: BotBatchItem) {
    const batchId = stored.batch.id;
    const start = bots
      .startRunWith(
        stored.definition,
        {
          botId: stored.batch.botId,
          inputs: item.inputs,
          ...(stored.batch.projectId === null ? {} : { projectId: stored.batch.projectId }),
          ...(stored.checkoutThreadId === null
            ? {}
            : { checkoutThreadId: stored.checkoutThreadId }),
          ...(stored.target === null ? {} : { target: stored.target }),
        },
        callerOf(stored),
        {
          batchId,
          ...(stored.triggerId === undefined ? {} : { triggerId: stored.triggerId }),
          ...(stored.batch.pipelineRunId == null
            ? {}
            : {
                pipelineRunId: stored.batch.pipelineRunId,
                untrusted: { names: Object.keys(item.inputs), origin: PIPELINE_ITEM_ORIGIN },
              }),
          onInserted: (inserted) => store.setItemState(batchId, item.index, "started", inserted.id),
        },
      )
      .pipe(Effect.uninterruptible);
    while (true) {
      const started = yield* start.pipe(
        Effect.map((run) => ({ run, retryAt: undefined })),
        Effect.catchIf(
          (error) => error.retryAt !== undefined,
          (error) => Effect.succeed({ run: null, retryAt: error.retryAt }),
        ),
      );
      if (started.run !== null) {
        if (pausedUntil.delete(batchId)) yield* publishSummary(batchId);
        return yield* bots.awaitRun(started.run.id).pipe(Effect.ignore({ log: true }));
      }
      const retryAt = started.retryAt ?? (yield* nowIso);
      if (pausedUntil.get(batchId) !== retryAt) {
        pausedUntil.set(batchId, retryAt);
        yield* publishSummary(batchId);
      }
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      yield* Effect.sleep(Duration.millis(Math.max(0, Date.parse(retryAt) - nowMs)));
    }
  });

  /**
   * Cancels a running batch: waiting items are skipped and runs in flight are cancelled. The
   * caller stops the feeder first, unless it is the feeder.
   */
  const close = Effect.fnUntraced(function* (batchId: string, note: string | null) {
    const stored = yield* requireStored(batchId);
    if (stored.batch.status !== "running") return;
    const now = yield* nowIso;
    yield* store
      .withTransaction(
        store
          .setStatus(batchId, "cancelled", now, note)
          .pipe(Effect.andThen(store.skipPending(batchId))),
      )
      .pipe(Effect.catch(storageError));
    const items = yield* store.getItems(batchId).pipe(Effect.catch(storageError));
    for (const item of items) {
      if (item.state === "skipped") yield* publish({ _tag: "batch-item", batchId, item });
      else if (isInFlight(item) && item.runId !== null)
        yield* bots.cancel(item.runId).pipe(Effect.ignore({ log: true }));
    }
    yield* publishSummary(batchId);
  });

  /** Feeds waiting items through a window, waits for every run, then marks the batch finished. */
  const feed = Effect.fnUntraced(function* (batchId: string) {
    const stored = yield* requireStored(batchId);
    if (stored.batch.status !== "running") return;
    const current = yield* bots.get(stored.batch.botId);
    if (current.archivedAt !== null) return yield* fail("archived", "The bot was archived.");
    // The live limit, so lowering it slows a batch already under way.
    const window = Math.min(current.maxConcurrentRuns, BOTS_MAX_ACTIVE_RUNS);
    const items = yield* store.getItems(batchId).pipe(Effect.catch(storageError));
    yield* Effect.all(
      [
        Effect.forEach(
          items.filter(isInFlight),
          (item) => bots.awaitRun(item.runId ?? "").pipe(Effect.ignore({ log: true })),
          { concurrency: "unbounded", discard: true },
        ),
        Effect.forEach(
          items.filter((item) => item.state === "pending"),
          (item) => feedItem(stored, item),
          { concurrency: window, discard: true },
        ),
      ],
      { concurrency: 2, discard: true },
    );
    yield* store
      .setStatus(batchId, "finished", yield* nowIso, stored.batch.note)
      .pipe(Effect.catch(storageError));
    yield* publishSummary(batchId);
  });

  const startFeeder = Effect.fnUntraced(function* (batchId: string) {
    // Registered before it runs, so its own cleanup never races the registration.
    const registered = yield* Deferred.make<void>();
    const fiber = yield* Deferred.await(registered).pipe(
      Effect.andThen(feed(batchId)),
      Effect.catch((error) =>
        Effect.logWarning("Bot batch stopped", { batchId, error }).pipe(
          Effect.andThen(close(batchId, error.message)),
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Bot batch feeder failed", { batchId, cause }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          feeders.delete(batchId);
          pausedUntil.delete(batchId);
        }),
      ),
      Effect.forkIn(serviceScope),
    );
    feeders.set(batchId, fiber);
    yield* Deferred.succeed(registered, undefined);
  });

  const stopFeeder = Effect.fnUntraced(function* (batchId: string) {
    const fiber = feeders.get(batchId);
    if (fiber !== undefined) yield* Fiber.interrupt(fiber);
  });

  const runBatch = Effect.fn("BotBatches.runBatch")(function* (
    input: BotsBatchInput,
    caller: BotCaller,
    options: { readonly triggerId?: string } = {},
  ) {
    const prepared = yield* prepare(input, caller);
    const firstInvalid = prepared.invalid[0];
    if (firstInvalid !== undefined)
      return yield* fail(
        "invalid",
        `${prepared.invalid.length} item${prepared.invalid.length === 1 ? " is" : "s are"} not valid. ${firstInvalid.label}: ${firstInvalid.message}`,
      );
    const { bot } = prepared;
    const stored: StoredBatch = {
      batch: {
        id: yield* randomUuidV4,
        botId: bot.id,
        botVersion: bot.version,
        botName: bot.name,
        projectId: prepared.projectId,
        sourceType: input.source.type,
        sourceSummary: prepared.summary,
        itemParameter: input.itemParameter ?? null,
        sharedInputs: input.sharedInputs ?? {},
        status: "running",
        note: prepared.note,
        startedBy: caller.actor,
        callerThreadId: caller.threadId,
        createdAt: yield* nowIso,
        finishedAt: null,
      },
      definition: bot,
      source: input.source,
      checkoutThreadId: prepared.checkoutThreadId,
      target: input.target ?? null,
      ...(options.triggerId === undefined ? {} : { triggerId: options.triggerId }),
    };
    yield* store.insertBatch(stored, prepared.valid).pipe(Effect.catch(storageError));
    yield* store.pruneBatches(bot.id, BATCHES_KEPT_PER_BOT).pipe(Effect.ignore({ log: true }));
    const { batch } = yield* load(stored.batch.id);
    yield* publish({ _tag: "batch", batch });
    yield* startFeeder(batch.id);
    return batch;
  });

  /**
   * Starts a batch over items a pipeline step already rendered and checked, with the definition
   * the pipeline pinned. `onInserted` runs in the batch row's transaction.
   */
  const startItems = Effect.fn("BotBatches.startItems")(function* (input: {
    readonly definition: BotDefinition;
    readonly items: ReadonlyArray<NewBatchItem>;
    readonly projectId: ProjectId | null;
    readonly checkoutThreadId: ThreadId | null;
    readonly target: BotTarget | null;
    readonly caller: BotCaller;
    readonly pipelineRunId: string;
    readonly onInserted: (batchId: string) => Effect.Effect<void, SqlError>;
  }) {
    const { definition } = input;
    const stored: StoredBatch = {
      batch: {
        id: yield* randomUuidV4,
        botId: definition.id,
        botVersion: definition.version,
        botName: definition.name,
        projectId: input.projectId,
        sourceType: "inputs",
        sourceSummary: `Pipeline step, ${input.items.length} item${input.items.length === 1 ? "" : "s"}`,
        itemParameter: null,
        sharedInputs: {},
        status: "running",
        note: null,
        startedBy: input.caller.actor,
        callerThreadId: input.caller.threadId,
        createdAt: yield* nowIso,
        finishedAt: null,
        pipelineRunId: input.pipelineRunId,
      },
      definition,
      source: { type: "inputs", items: input.items.map((item) => item.inputs) },
      checkoutThreadId: input.checkoutThreadId,
      target: input.target,
    };
    yield* store
      .withTransaction(
        store
          .insertBatch(stored, input.items)
          .pipe(Effect.andThen(input.onInserted(stored.batch.id))),
      )
      .pipe(Effect.catch(storageError));
    yield* store
      .pruneBatches(definition.id, BATCHES_KEPT_PER_BOT)
      .pipe(Effect.ignore({ log: true }));
    const { batch } = yield* load(stored.batch.id);
    yield* publish({ _tag: "batch", batch });
    yield* startFeeder(batch.id);
    return batch;
  });

  const cancel = Effect.fn("BotBatches.cancel")(function* (batchId: string) {
    const stored = yield* requireStored(batchId);
    if (stored.batch.status === "running") {
      yield* stopFeeder(batchId);
      yield* close(batchId, null);
    }
    return (yield* load(batchId)).batch;
  });

  const retry = Effect.fn("BotBatches.retry")(function* (
    input: BotsRetryBatchInput,
    caller: BotCaller,
  ) {
    const { stored, items } = yield* load(input.batchId);
    if (stored.batch.status === "running")
      return yield* fail("invalid", "Wait for this batch to finish before retrying.");
    yield* bots.checkCaller({ botId: stored.batch.botId, inputs: {} }, caller);
    const current = yield* bots.get(stored.batch.botId);
    yield* bots.checkRunnable(current, caller);
    const selected = items.filter((item) =>
      isRetryable(item, input.include === "failed_and_attention"),
    );
    const exhausted = selected.filter(
      (item) => item.previousRunIds.length + 1 >= BOTS_BATCH_MAX_ATTEMPTS,
    );
    const retried = selected.filter((item) => !exhausted.includes(item));
    if (retried.length === 0)
      return yield* fail(
        "invalid",
        exhausted.length > 0
          ? `Every item to retry has run ${BOTS_BATCH_MAX_ATTEMPTS} times already.`
          : "Nothing in this batch needs a retry.",
      );
    const batchId = stored.batch.id;
    yield* store
      .withTransaction(
        Effect.gen(function* () {
          for (const item of retried)
            yield* store.requeueItem(
              batchId,
              item.index,
              [...item.previousRunIds, ...(item.runId === null ? [] : [item.runId])],
              item.runId,
            );
          if (input.useLatest === true) yield* store.setDefinition(batchId, current);
          yield* store.setStatus(batchId, "running", null, null);
        }),
      )
      .pipe(Effect.catch(storageError));
    const reloaded = yield* load(batchId);
    for (const item of reloaded.items)
      if (retried.some((selectedItem) => selectedItem.index === item.index))
        yield* publish({ _tag: "batch-item", batchId, item });
    yield* publish({ _tag: "batch", batch: reloaded.batch });
    yield* startFeeder(batchId);
    return {
      batch: reloaded.batch,
      retried: retried.length,
      exhausted: exhausted.map((item) => item.label),
    } satisfies BotBatchRetryResult;
  });

  const list = Effect.fn("BotBatches.list")(function* (input: BotsListBatchesInput) {
    const page = yield* store.listBatches(input).pipe(Effect.catch(storageError));
    const batches = yield* Effect.forEach(page.batches, (stored) =>
      store.getItems(stored.batch.id).pipe(
        Effect.map((items) => summarize(stored, items)),
        Effect.catch(storageError),
      ),
    );
    return { batches, hasMore: page.hasMore };
  });

  const get = Effect.fn("BotBatches.get")(function* (batchId: string) {
    const { batch, items } = yield* load(batchId);
    return { batch, items };
  });

  const report = Effect.fn("BotBatches.report")(function* (batchId: string) {
    const { batch, items } = yield* load(batchId);
    return renderBatchReport(batch, items);
  });

  /** Waits, up to `timeoutMs` when given, for the batch to stop running, and returns it. */
  const awaitBatch = (batchId: string, timeoutMs?: number) =>
    Effect.scoped(
      Effect.gen(function* () {
        // Subscribe before reading so a finish between the two is not missed.
        const subscription = yield* PubSub.subscribe(changes);
        const { batch } = yield* load(batchId);
        if (batch.status !== "running") return batch;
        yield* Effect.gen(function* () {
          while (true) {
            const change = yield* PubSub.take(subscription);
            if (
              change._tag === "batch" &&
              change.batch.id === batchId &&
              change.batch.status !== "running"
            )
              return;
          }
        }).pipe(timeoutMs === undefined ? Effect.asSome : Effect.timeoutOption(timeoutMs));
        return (yield* load(batchId)).batch;
      }),
    );

  const cancelBotBatches = Effect.fnUntraced(function* (botId: string, note: string) {
    const running = yield* store.listRunningBatches().pipe(Effect.catch(storageError));
    for (const stored of running) {
      if (stored.batch.botId !== botId) continue;
      yield* stopFeeder(stored.batch.id);
      yield* close(stored.batch.id, note);
    }
  });

  /** Keeps batch views current from run changes, and stops batches whose bot goes away. */
  const onBotsChange = Effect.fn("BotBatches.onBotsChange")(
    function* (change: BotsChange) {
      switch (change._tag) {
        case "run": {
          const batchId = change.run.batchId;
          if (batchId == null) return;
          const index = yield* store.itemIndexForRun(batchId, change.run.id);
          if (index === null) return;
          const item = yield* store.getItem(batchId, index);
          if (item === null) return;
          yield* publish({ _tag: "batch-item", batchId, item: { ...item, run: change.run } });
          return yield* publishSummary(batchId);
        }
        case "bot":
          if (change.bot.archivedAt !== null)
            yield* cancelBotBatches(change.bot.id, "The bot was archived.");
          return;
        case "bot-deleted":
          return yield* cancelBotBatches(change.botId, "The bot was deleted.");
      }
    },
    Effect.catchCause((cause) => Effect.logWarning("Bot batch update failed", { cause })),
  );

  yield* bots.changes.pipe(Stream.runForEach(onBotsChange), Effect.forkIn(serviceScope));

  /**
   * After bot run recovery: items whose run never started go back to wait, and each running
   * batch gets a new feeder that also waits on its runs still in flight. The run that never
   * started leaves the inbox, since the feeder reruns its item and a retry would run it twice.
   */
  const recover = Effect.fn("BotBatches.recover")(function* () {
    yield* bots.whenRecovered;
    const running = yield* store.listRunningBatches().pipe(Effect.catch(storageError));
    for (const stored of running) {
      if (feeders.has(stored.batch.id)) continue;
      const items = yield* store.getItems(stored.batch.id).pipe(Effect.catch(storageError));
      for (const item of items)
        if (
          item.state === "started" &&
          item.run?.status === "failed" &&
          item.run.error === RESTARTED_BEFORE_START
        ) {
          // Dismissed first, so a restart in between still finds the item to requeue.
          yield* bots
            .dismiss({ runIds: [item.run.id], dismissed: true })
            .pipe(Effect.ignore({ log: true }));
          yield* store
            .requeueItem(stored.batch.id, item.index, item.previousRunIds, item.run.id)
            .pipe(Effect.catch(storageError));
        }
      yield* startFeeder(stored.batch.id);
    }
  });

  return {
    preview,
    runBatch,
    startItems,
    list,
    get,
    cancel,
    retry,
    report,
    awaitBatch,
    recover,
    changes: Stream.fromPubSub(changes),
  };
});

export class BotBatches extends Context.Service<BotBatches, Effect.Success<typeof make>>()(
  "t3/fork/bots/BotBatches",
) {}

export const layer = Layer.effect(BotBatches, make);

/** Resumes batches the previous server left running, once bot runs are recovered. */
export const BotBatchesRecoveryLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const batches = yield* BotBatches;
    yield* forkParked(
      batches
        .recover()
        .pipe(
          Effect.catchCause((cause) => Effect.logWarning("Bot batch recovery failed", { cause })),
        ),
    );
  }),
);
