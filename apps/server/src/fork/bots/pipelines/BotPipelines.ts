import {
  BOTS_MAX_ACTIVE_PIPELINES,
  BotsError,
  isActiveBotPipelineRunStatus,
  type BotDefinition,
  type BotPipeline,
  type BotPipelineChange,
  type BotPipelineInput,
  type BotPipelineProblem,
  type BotPipelineRun,
  type BotPipelineRunDetail,
  type BotRun,
  type BotsListPipelineRunsInput,
  type BotsRunPipelineInput,
  type BotsSavePipelineInput,
} from "@t3tools/contracts/fork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { forkParked } from "../../../serverActivation.ts";
import { BotBatches, PIPELINE_ITEM_ORIGIN } from "../BotBatches.ts";
import type { NewBatchItem } from "../BotBatchesStore.ts";
import {
  BotsService,
  RESTARTED_BEFORE_START,
  USER_CALLER,
  type BotCaller,
} from "../BotsService.ts";
import { validateInputs } from "../render.ts";
import { checkPipeline } from "./check.ts";
import { decide, fanOutOutput, faultRunId, type Decision } from "./decide.ts";
import {
  makePipelinesStore,
  PIPELINE_RUNS_KEPT,
  type RunUpdate,
  type StoredAttempt,
  type StoredPipelineRun,
} from "./PipelinesStore.ts";
import { renderPipelineReport, type ReportStep } from "./report.ts";
import {
  FIXER_DEFINITION,
  PIPELINE_STARTER_ID,
  PIPELINE_STARTER_REVISION,
  REVIEW_FIX_VERIFY,
} from "./starter.ts";
import {
  fanOutItems,
  itemLabel,
  OUTPUT_RESULT_MAX,
  renderStepInputs,
  stepLabel,
  type StepOutput,
  type TemplateContext,
} from "./templates.ts";

/** A triggered run's inputs came from an event, and its later steps read earlier ones. */
const TRIGGERED_ORIGIN = "the event that started this run's pipeline, or an earlier step of it";
const CANCELLED = "The pipeline was cancelled.";

const fail = (reason: BotsError["reason"], message: string) => new BotsError({ reason, message });

const storageError = (cause: unknown) =>
  Effect.logWarning("Bot pipeline storage failed", { cause }).pipe(
    Effect.andThen(Effect.fail(fail("storage", "Loom could not read or write bot pipelines."))),
  );

/** "Fix: Fixer has no input named file." */
export const problemMessage = (problem: BotPipelineProblem) =>
  problem.stepId === null ? problem.message : `${stepLabel(problem.stepId)}: ${problem.message}`;

const firstError = (problems: ReadonlyArray<BotPipelineProblem>) =>
  problems.find((problem) => problem.severity === "error");

const endedOutput = (status: StepOutput["status"], error: string): StepOutput => ({
  status,
  verdict: null,
  summary: null,
  findings: [],
  result: null,
  error,
});

/** What a skipped step hands on: nothing, and no verdict to gate on. */
const NOTHING_RAN: StepOutput = {
  status: "completed",
  verdict: null,
  summary: null,
  findings: [],
  result: null,
  error: null,
};

const runOutput = (run: BotRun): StepOutput => ({
  status: run.status,
  verdict: run.verdict?.verdict ?? null,
  summary: run.verdict?.summary ?? null,
  findings: run.verdict?.findings ?? [],
  result: run.result === null ? null : run.result.slice(0, OUTPUT_RESULT_MAX),
  error: run.error,
});

const toUpdate = (run: BotPipelineRun): RunUpdate => ({
  status: run.status,
  retryAt: run.retryAt,
  cursorStepId: run.cursorStepId,
  finalVerdict: run.finalVerdict,
  stoppedRunId: run.stoppedRunId,
  error: run.error,
  finishedAt: run.finishedAt,
});

const callerOf = (stored: StoredPipelineRun): BotCaller => ({
  actor: stored.run.startedBy,
  threadId: stored.run.callerThreadId,
  projectId: stored.run.projectId,
  runtimeMode: stored.callerRuntimeMode,
});

/** The latest finished output of each step, which is what later templates read. */
const latestOutputs = (attempts: ReadonlyArray<StoredAttempt>) => {
  const outputs = new Map<string, StepOutput>();
  for (const { attempt, output } of attempts)
    if (attempt.state === "done" && output !== null) outputs.set(attempt.stepId, output);
  return outputs;
};

interface Driver {
  fiber: Fiber.Fiber<void> | null;
}

export const make = Effect.gen(function* () {
  const store = yield* makePipelinesStore;
  const bots = yield* BotsService;
  const batches = yield* BotBatches;
  const serviceScope = yield* Effect.scope;
  const changes = yield* PubSub.unbounded<BotPipelineChange>();
  const drivers = new Map<string, Driver>();
  /** Counting active runs and writing a new one happen together. */
  const startPermit = yield* Semaphore.make(1);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const publish = (change: BotPipelineChange) =>
    PubSub.publish(changes, change).pipe(Effect.asVoid);

  const requirePipeline = Effect.fnUntraced(function* (pipelineId: string) {
    const pipeline = yield* store.getPipeline(pipelineId).pipe(Effect.catch(storageError));
    if (pipeline === null)
      return yield* fail("not_found", `There is no pipeline named ${pipelineId}.`);
    return pipeline;
  });

  const load = Effect.fnUntraced(function* (pipelineRunId: string) {
    const stored = yield* store.getRun(pipelineRunId).pipe(Effect.catch(storageError));
    if (stored === null) return yield* fail("not_found", "The pipeline run was not found.");
    const attempts = yield* store.getAttempts(pipelineRunId).pipe(Effect.catch(storageError));
    return { stored, attempts };
  });

  const publishAttempts = Effect.fnUntraced(function* (pipelineRunId: string, fromSeq: number) {
    const attempts = yield* store.getAttempts(pipelineRunId).pipe(Effect.catch(storageError));
    for (const { attempt } of attempts)
      if (attempt.seq >= fromSeq)
        yield* publish({ _tag: "pipeline-attempt", pipelineRunId, attempt });
  });

  const setRun = Effect.fnUntraced(function* (next: BotPipelineRun) {
    yield* store.updateRun(next.id, toUpdate(next)).pipe(Effect.catch(storageError));
    yield* publish({ _tag: "pipeline-run", run: next });
    return next;
  });

  // Definitions

  const list = () => store.listPipelines().pipe(Effect.catch(storageError));

  const check = Effect.fn("BotPipelines.check")(function* (pipeline: BotPipelineInput) {
    const all = yield* bots.list();
    const known = new Set<string>();
    for (const step of pipeline.steps)
      if (typeof step.version === "number") {
        const found = yield* bots
          .version({ botId: step.botId, version: step.version })
          .pipe(Effect.option);
        if (Option.isSome(found)) known.add(`${step.botId}@${step.version}`);
      }
    return checkPipeline(pipeline, {
      bots: new Map(all.map((bot) => [bot.id, bot])),
      versionExists: (botId, version) => known.has(`${botId}@${version}`),
    });
  });

  const write = Effect.fnUntraced(function* (
    input: BotPipelineInput,
    caller: BotCaller,
    expectedVersion: number | undefined,
  ) {
    const problem = firstError(yield* check(input));
    if (problem !== undefined) return yield* fail("invalid", problemMessage(problem));
    const existing = yield* store.getPipeline(input.id).pipe(Effect.catch(storageError));
    if (existing === null && (yield* store.hasPipeline(input.id).pipe(Effect.catch(storageError))))
      return yield* fail(
        "invalid",
        "A newer version of Loom saved this pipeline; update to edit it.",
      );
    if (expectedVersion !== undefined && (existing?.version ?? 0) !== expectedVersion)
      return yield* fail(
        "invalid",
        "This pipeline changed since it was opened. Reload it and apply your edits again.",
      );
    const now = yield* nowIso;
    const pipeline: BotPipeline = {
      ...input,
      // Past the runs of a deleted pipeline with this id, so a version never names two texts.
      version:
        Math.max(
          existing?.version ?? 0,
          yield* store.maxRunVersion(input.id).pipe(Effect.catch(storageError)),
        ) + 1,
      createdBy: existing?.createdBy ?? caller.actor,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    yield* store.putPipeline(pipeline).pipe(Effect.catch(storageError));
    yield* publish({ _tag: "pipeline", pipeline });
    return pipeline;
  });

  const save = Effect.fn("BotPipelines.save")(function* (
    input: BotsSavePipelineInput,
    caller: BotCaller,
  ) {
    return yield* write(input.pipeline, caller, input.expectedVersion);
  });

  /** Keeps the pipeline's past runs; refuses while one is active. */
  const remove = Effect.fn("BotPipelines.delete")(function* (pipelineId: string) {
    yield* requirePipeline(pipelineId);
    const active = yield* store.activeRunCount(pipelineId).pipe(Effect.catch(storageError));
    if (active > 0)
      return yield* fail("invalid", "Cancel this pipeline's running runs before deleting it.");
    yield* store.deletePipeline(pipelineId).pipe(Effect.catch(storageError));
    yield* publish({ _tag: "pipeline-deleted", pipelineId });
  });

  // Driving a run

  /**
   * Ends the attempt and moves the run on, in one transaction: the next attempt is written as
   * pending, or the run ends. A stopping run marks the bot run at fault for the inbox.
   */
  const settle = Effect.fnUntraced(function* (
    stored: StoredPipelineRun,
    entry: StoredAttempt,
    ended: {
      readonly state: "done" | "skipped";
      readonly output: StepOutput | null;
      readonly notes: ReadonlyArray<string>;
    },
    decision: Decision,
    faultRun: string | null,
  ) {
    const { run } = stored;
    const { attempt } = entry;
    const now = yield* nowIso;
    const verdict =
      stored.bots[attempt.stepId]?.output === "verdict" ? (ended.output?.verdict ?? null) : null;
    const finalVerdict = verdict ?? run.finalVerdict;
    const next: BotPipelineRun =
      decision.kind === "next"
        ? { ...run, status: "running", retryAt: null, cursorStepId: decision.stepId, finalVerdict }
        : decision.kind === "completed"
          ? { ...run, status: "completed", retryAt: null, finalVerdict, finishedAt: now }
          : {
              ...run,
              status: decision.kind,
              retryAt: null,
              finalVerdict,
              error: decision.message,
              stoppedRunId: faultRun,
              finishedAt: now,
            };
    yield* store
      .withTransaction(
        Effect.gen(function* () {
          yield* store.endAttempt(run.id, attempt.seq, { ...ended, finishedAt: now });
          if (decision.kind === "next")
            yield* store.insertAttempt(run.id, {
              seq: attempt.seq + 1,
              stepId: decision.stepId,
              round: decision.round,
            });
          yield* store.updateRun(run.id, toUpdate(next));
        }),
      )
      .pipe(Effect.catch(storageError), Effect.uninterruptible);
    if (next.stoppedRunId !== null && next.stoppedRunId !== run.stoppedRunId)
      yield* bots.setPipelineStopped(next.stoppedRunId, true).pipe(Effect.ignore({ log: true }));
    yield* publishAttempts(run.id, attempt.seq);
    yield* publish({ _tag: "pipeline-run", run: next });
  });

  /** Ends the attempt as failed before anything ran, which fails the run. */
  const failAttempt = (stored: StoredPipelineRun, entry: StoredAttempt, message: string) =>
    settle(
      stored,
      entry,
      { state: "done", output: endedOutput("failed", message), notes: entry.attempt.notes },
      { kind: "failed", message },
      null,
    );

  /** Holds a step back until its bot's budget has room, showing the run as waiting meanwhile. */
  const waitForBudget = Effect.fnUntraced(function* (stored: StoredPipelineRun, retryAt: string) {
    if (stored.run.status !== "waiting" || stored.run.retryAt !== retryAt)
      yield* setRun({ ...stored.run, status: "waiting", retryAt });
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    yield* Effect.sleep(Duration.millis(Math.max(0, Date.parse(retryAt) - nowMs)));
  });

  /** Renders a pending attempt's inputs and starts its run or batch. */
  const begin = Effect.fnUntraced(function* (
    stored: StoredPipelineRun,
    attempts: ReadonlyArray<StoredAttempt>,
    entry: StoredAttempt,
  ) {
    const { run, pipeline } = stored;
    const { attempt } = entry;
    const step = pipeline.steps.find((candidate) => candidate.id === attempt.stepId);
    const bot = stored.bots[attempt.stepId];
    if (step === undefined || bot === undefined)
      return yield* failAttempt(stored, entry, `The pipeline has no step ${attempt.stepId}.`);
    const label = stepLabel(step.id);
    const context: TemplateContext = {
      inputs: run.inputs,
      outputs: latestOutputs(attempts),
      item: null,
      round: attempt.round,
      inputsUntrusted: stored.triggerId !== null,
    };
    const caller = callerOf(stored);
    const startedAt = yield* nowIso;

    if (step.forEach !== undefined) {
      const fanOut = fanOutItems(step.forEach.from, context);
      if (fanOut.items.length === 0)
        return yield* settle(
          stored,
          entry,
          {
            state: "skipped",
            output: null,
            notes: [...fanOut.notes, "There were no items to run."],
          },
          decide(pipeline.steps, step.id, attempt.round, NOTHING_RAN),
          null,
        );
      const notes = new Set(fanOut.notes);
      const items: Array<NewBatchItem> = [];
      for (const item of fanOut.items) {
        const rendered = renderStepInputs(step, bot.parameters, { ...context, item });
        for (const note of rendered.notes) notes.add(note);
        const itemName = itemLabel(step, item, context);
        const checked = validateInputs(bot, rendered.values);
        if (!checked.ok)
          return yield* failAttempt(stored, entry, `${label}, ${itemName}: ${checked.message}`);
        items.push({ label: itemName, inputs: checked.values });
      }
      const started = yield* batches
        .startItems({
          definition:
            step.modelSelection === undefined
              ? bot
              : { ...bot, modelSelection: step.modelSelection },
          items,
          projectId: run.projectId,
          checkoutThreadId: run.checkoutThreadId,
          target: step.target ?? null,
          caller,
          pipelineRunId: run.id,
          onInserted: (batchId) =>
            store.startAttempt(run.id, attempt.seq, {
              botVersion: bot.version,
              runId: null,
              batchId,
              notes: [...notes],
              startedAt,
            }),
        })
        .pipe(
          Effect.uninterruptible,
          Effect.map(() => null),
          Effect.catch((error) => Effect.succeed(error.message)),
        );
      if (started !== null) return yield* failAttempt(stored, entry, `${label}: ${started}`);
    } else {
      const rendered = renderStepInputs(step, bot.parameters, context);
      const checked = validateInputs(bot, rendered.values);
      if (!checked.ok) return yield* failAttempt(stored, entry, `${label}: ${checked.message}`);
      const started = yield* bots
        .startRunWith(
          bot,
          {
            botId: bot.id,
            inputs: checked.values,
            ...(run.projectId === null ? {} : { projectId: run.projectId }),
            ...(run.checkoutThreadId === null ? {} : { checkoutThreadId: run.checkoutThreadId }),
            ...(step.target === undefined ? {} : { target: step.target }),
          },
          caller,
          {
            pipelineRunId: run.id,
            modelSelection: step.modelSelection,
            untrusted:
              rendered.untrusted.length === 0
                ? undefined
                : {
                    names: rendered.untrusted,
                    origin: stored.triggerId === null ? PIPELINE_ITEM_ORIGIN : TRIGGERED_ORIGIN,
                  },
            onInserted: (inserted) =>
              store.startAttempt(run.id, attempt.seq, {
                botVersion: bot.version,
                runId: inserted.id,
                batchId: null,
                notes: rendered.notes,
                startedAt: inserted.createdAt,
              }),
          },
        )
        .pipe(
          Effect.uninterruptible,
          Effect.map(() => ({ retryAt: null, message: null })),
          Effect.catch((error) =>
            Effect.succeed({ retryAt: error.retryAt ?? null, message: error.message }),
          ),
        );
      if (started.retryAt !== null) return yield* waitForBudget(stored, started.retryAt);
      if (started.message !== null)
        return yield* failAttempt(stored, entry, `${label}: ${started.message}`);
    }
    if (run.status === "waiting") yield* setRun({ ...run, status: "running", retryAt: null });
    yield* publishAttempts(run.id, attempt.seq);
  });

  /** Waits for a started attempt's run or batch and decides where the pipeline goes. */
  const conclude = Effect.fnUntraced(function* (stored: StoredPipelineRun, entry: StoredAttempt) {
    const { attempt } = entry;
    let output: StepOutput;
    let fault: string | null;
    if (attempt.runId !== null) {
      const finished = yield* bots.awaitRun(attempt.runId);
      output = runOutput(finished);
      fault = finished.id;
    } else if (attempt.batchId !== null) {
      yield* batches.awaitBatch(attempt.batchId);
      const { batch, items } = yield* batches.get(attempt.batchId);
      const report = yield* batches.report(attempt.batchId);
      output = fanOutOutput(batch, items, report.markdown);
      fault = faultRunId(items);
    } else return yield* failAttempt(stored, entry, "The step lost track of its run.");
    const decision = decide(stored.pipeline.steps, attempt.stepId, attempt.round, output);
    yield* settle(
      stored,
      entry,
      { state: "done", output, notes: attempt.notes },
      decision,
      decision.kind === "stopped" || decision.kind === "failed" ? fault : null,
    );
  });

  const drive = Effect.fnUntraced(function* (pipelineRunId: string, self: Driver) {
    while (drivers.get(pipelineRunId) === self) {
      const { stored, attempts } = yield* load(pipelineRunId);
      if (!isActiveBotPipelineRunStatus(stored.run.status)) return;
      const entry = attempts.at(-1);
      if (entry === undefined) return yield* fail("invalid", "The pipeline run has no steps.");
      switch (entry.attempt.state) {
        case "pending":
          yield* begin(stored, attempts, entry);
          break;
        case "started":
          yield* conclude(stored, entry);
          break;
        default:
          // The next attempt is written with the end of this one, so this cannot happen.
          return yield* fail("invalid", "The pipeline run lost its place.");
      }
    }
  });

  const failRun = Effect.fnUntraced(function* (pipelineRunId: string, message: string) {
    const { stored } = yield* load(pipelineRunId);
    if (!isActiveBotPipelineRunStatus(stored.run.status)) return;
    yield* setRun({
      ...stored.run,
      status: "failed",
      retryAt: null,
      error: message,
      finishedAt: yield* nowIso,
    });
  });

  const startDriver = Effect.fnUntraced(function* (pipelineRunId: string) {
    const self: Driver = { fiber: null };
    // Registered before it runs, so its own cleanup never races the registration.
    const registered = yield* Deferred.make<void>();
    drivers.set(pipelineRunId, self);
    self.fiber = yield* Deferred.await(registered).pipe(
      Effect.andThen(drive(pipelineRunId, self)),
      Effect.catch((error) =>
        Effect.logWarning("Bot pipeline stopped", { pipelineRunId, error }).pipe(
          Effect.andThen(failRun(pipelineRunId, error.message)),
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Bot pipeline driver failed", { pipelineRunId, cause }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (drivers.get(pipelineRunId) === self) drivers.delete(pipelineRunId);
        }),
      ),
      Effect.forkIn(serviceScope),
    );
    yield* Deferred.succeed(registered, undefined);
  });

  /** Stops the driver and waits for it, so nothing it was writing lands afterwards. */
  const stopDriver = Effect.fnUntraced(function* (pipelineRunId: string) {
    const fiber = drivers.get(pipelineRunId)?.fiber;
    drivers.delete(pipelineRunId);
    if (fiber != null) yield* Fiber.interrupt(fiber);
  });

  /** Refuses the start when the environment already runs as many pipelines as it allows. */
  const underActiveLimit = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const active = yield* store.activeRunCount().pipe(Effect.catch(storageError));
      if (active >= BOTS_MAX_ACTIVE_PIPELINES)
        return yield* fail(
          "invalid",
          `${active} pipeline runs are already running. Wait for one to finish.`,
        );
      return yield* effect;
    }).pipe(startPermit.withPermits(1));

  /** Each step's bot as the run will use it, refusing any the caller could not run itself. */
  const resolveBots = Effect.fnUntraced(function* (pipeline: BotPipeline, caller: BotCaller) {
    const resolved: Record<string, BotDefinition> = {};
    for (const step of pipeline.steps) {
      const bot = yield* bots.definitionAt(step.botId, step.version ?? "latest");
      yield* bots.checkRunnable(bot, caller);
      resolved[step.id] = bot;
    }
    return resolved;
  });

  const run = Effect.fn("BotPipelines.run")(function* (
    input: BotsRunPipelineInput,
    caller: BotCaller,
    options: { readonly triggerId?: string | undefined } = {},
  ) {
    const pipeline = yield* requirePipeline(input.pipelineId);
    const [first] = pipeline.steps;
    if (first === undefined) return yield* fail("invalid", "The pipeline has no steps.");
    yield* bots.checkCaller({ botId: first.botId, inputs: {} }, caller);
    const checked = validateInputs(pipeline, input.inputs);
    if (!checked.ok) return yield* fail("invalid", checked.message);
    const resolved = yield* resolveBots(pipeline, caller);
    // Bots can change after the pipeline was saved; catch what no longer fits before a step runs.
    const problem = firstError(
      checkPipeline(pipeline, {
        bots: new Map(Object.values(resolved).map((bot) => [bot.id, bot])),
        versionExists: () => true,
      }),
    );
    if (problem !== undefined) return yield* fail("invalid", problemMessage(problem));
    const stored: StoredPipelineRun = {
      run: {
        id: yield* randomUuidV4,
        pipelineId: pipeline.id,
        pipelineVersion: pipeline.version,
        pipelineName: pipeline.name,
        inputs: checked.values,
        projectId: input.projectId ?? caller.projectId,
        checkoutThreadId: input.checkoutThreadId ?? null,
        status: "running",
        retryAt: null,
        cursorStepId: first.id,
        finalVerdict: null,
        stoppedRunId: null,
        error: null,
        startedBy: caller.actor,
        callerThreadId: caller.threadId,
        createdAt: yield* nowIso,
        finishedAt: null,
      },
      pipeline,
      bots: resolved,
      callerRuntimeMode: caller.runtimeMode,
      triggerId: options.triggerId ?? null,
    };
    yield* underActiveLimit(store.insertRun(stored, first.id).pipe(Effect.catch(storageError)));
    yield* store.pruneRuns(pipeline.id, PIPELINE_RUNS_KEPT).pipe(Effect.ignore({ log: true }));
    yield* publish({ _tag: "pipeline-run", run: stored.run });
    yield* publishAttempts(stored.run.id, 1);
    yield* startDriver(stored.run.id);
    return stored.run;
  });

  const cancel = Effect.fn("BotPipelines.cancel")(function* (pipelineRunId: string) {
    if (!isActiveBotPipelineRunStatus((yield* load(pipelineRunId)).stored.run.status))
      return (yield* load(pipelineRunId)).stored.run;
    yield* stopDriver(pipelineRunId);
    const { stored, attempts } = yield* load(pipelineRunId);
    const { run } = stored;
    if (!isActiveBotPipelineRunStatus(run.status)) return run;
    const entry = attempts.at(-1);
    if (entry?.attempt.state === "started") {
      if (entry.attempt.runId !== null)
        yield* bots.cancel(entry.attempt.runId).pipe(Effect.ignore({ log: true }));
      if (entry.attempt.batchId !== null)
        yield* batches.cancel(entry.attempt.batchId).pipe(Effect.ignore({ log: true }));
    }
    const now = yield* nowIso;
    const next: BotPipelineRun = { ...run, status: "cancelled", retryAt: null, finishedAt: now };
    yield* store
      .withTransaction(
        Effect.gen(function* () {
          if (
            entry !== undefined &&
            (entry.attempt.state === "pending" || entry.attempt.state === "started")
          )
            yield* store.endAttempt(run.id, entry.attempt.seq, {
              state: "done",
              output: endedOutput("cancelled", CANCELLED),
              notes: entry.attempt.notes,
              finishedAt: now,
            });
          yield* store.updateRun(run.id, toUpdate(next));
        }),
      )
      .pipe(Effect.catch(storageError));
    if (entry !== undefined) yield* publishAttempts(run.id, entry.attempt.seq);
    yield* publish({ _tag: "pipeline-run", run: next });
    return next;
  });

  /** Runs the step that stopped the run again, in the same round, with the run's pinned bots. */
  const resume = Effect.fn("BotPipelines.resume")(function* (
    pipelineRunId: string,
    caller: BotCaller,
  ) {
    const { stored, attempts } = yield* load(pipelineRunId);
    const { run } = stored;
    if (run.status !== "stopped" && run.status !== "failed")
      return yield* fail("invalid", "Only a stopped or failed pipeline run can be resumed.");
    const last = attempts.at(-1);
    const [first] = stored.pipeline.steps;
    if (last === undefined || first === undefined)
      return yield* fail("invalid", "The pipeline run has no steps.");
    yield* bots.checkCaller({ botId: first.botId, inputs: {} }, caller);
    for (const step of stored.pipeline.steps) {
      const pinned = stored.bots[step.id];
      if (pinned === undefined) continue;
      const current = yield* bots.get(step.botId);
      yield* bots.checkRunnable({ ...pinned, archivedAt: current.archivedAt }, caller);
    }
    // A driver that just ended the run may still be on its way out.
    const old = drivers.get(pipelineRunId)?.fiber;
    if (old != null) yield* Fiber.await(old);
    const next: BotPipelineRun = {
      ...run,
      status: "running",
      retryAt: null,
      cursorStepId: last.attempt.stepId,
      stoppedRunId: null,
      error: null,
      finishedAt: null,
    };
    yield* underActiveLimit(
      store
        .withTransaction(
          Effect.gen(function* () {
            yield* store.insertAttempt(run.id, {
              seq: last.attempt.seq + 1,
              stepId: last.attempt.stepId,
              round: last.attempt.round,
            });
            yield* store.updateRun(run.id, toUpdate(next));
          }),
        )
        .pipe(Effect.catch(storageError)),
    );
    if (run.stoppedRunId !== null)
      yield* bots.setPipelineStopped(run.stoppedRunId, false).pipe(Effect.ignore({ log: true }));
    yield* publish({ _tag: "pipeline-run", run: next });
    yield* publishAttempts(run.id, last.attempt.seq + 1);
    yield* startDriver(run.id);
    return next;
  });

  const listRuns = (input: BotsListPipelineRunsInput) =>
    store.listRuns(input).pipe(Effect.catch(storageError));

  const getRun = Effect.fn("BotPipelines.getRun")(function* (pipelineRunId: string) {
    const { stored, attempts } = yield* load(pipelineRunId);
    const steps = new Map<string, ReportStep>();
    for (const step of stored.pipeline.steps) {
      const bot = stored.bots[step.id];
      if (bot !== undefined)
        steps.set(step.id, {
          botName: bot.name,
          model: (step.modelSelection ?? bot.modelSelection).model,
        });
    }
    return {
      run: stored.run,
      attempts: attempts.map((entry) => entry.attempt),
      report: renderPipelineReport(stored.run, attempts, steps),
    } satisfies BotPipelineRunDetail;
  });

  /** Waits, up to `timeoutMs` when given, for the run to stop being active, and returns it. */
  const awaitRun = (pipelineRunId: string, timeoutMs?: number) =>
    Effect.scoped(
      Effect.gen(function* () {
        // Subscribe before reading so a finish between the two is not missed.
        const subscription = yield* PubSub.subscribe(changes);
        const { stored } = yield* load(pipelineRunId);
        if (!isActiveBotPipelineRunStatus(stored.run.status)) return stored.run;
        yield* Effect.gen(function* () {
          while (true) {
            const change = yield* PubSub.take(subscription);
            if (
              change._tag === "pipeline-run" &&
              change.run.id === pipelineRunId &&
              !isActiveBotPipelineRunStatus(change.run.status)
            )
              return;
          }
        }).pipe(timeoutMs === undefined ? Effect.asSome : Effect.timeoutOption(timeoutMs));
        return (yield* load(pipelineRunId)).stored.run;
      }),
    );

  /**
   * After bot run recovery: an attempt whose run never started goes back to wait, and each active
   * run gets a new driver. A fan-out step's batch recovers on its own; the driver waits for it.
   */
  const recover = Effect.fn("BotPipelines.recover")(function* () {
    yield* bots.whenRecovered;
    const active = yield* store.listActiveRuns().pipe(Effect.catch(storageError));
    for (const stored of active) {
      if (drivers.has(stored.run.id)) continue;
      const attempts = yield* store.getAttempts(stored.run.id).pipe(Effect.catch(storageError));
      const last = attempts.at(-1)?.attempt;
      if (last?.state === "started" && last.runId !== null) {
        const botRun = yield* bots.getRun(last.runId).pipe(Effect.option);
        if (
          Option.isSome(botRun) &&
          botRun.value.status === "failed" &&
          botRun.value.error === RESTARTED_BEFORE_START
        )
          yield* store.resetAttempt(stored.run.id, last.seq).pipe(Effect.catch(storageError));
      }
      yield* startDriver(stored.run.id);
    }
  });

  /**
   * Offers the review, fix, verify pipeline once, with a fixer bot it needs, after the starter
   * reviewer and verifier exist. Until they do, nothing is recorded and the next start tries again.
   */
  const seedStarter = Effect.fn("BotPipelines.seedStarter")(function* () {
    yield* bots.whenSeeded;
    if (yield* store.hasStarter(PIPELINE_STARTER_ID).pipe(Effect.catch(storageError))) return;
    const all = new Map((yield* bots.list()).map((bot) => [bot.id, bot]));
    const reviewer = all.get("reviewer");
    const verifier = all.get("verifier");
    if (reviewer?.origin?.starterId !== "reviewer" || verifier?.origin?.starterId !== "verifier")
      return;
    if (!all.has(FIXER_DEFINITION.id))
      all.set(
        FIXER_DEFINITION.id,
        yield* bots.save(
          { ...FIXER_DEFINITION, modelSelection: reviewer.modelSelection },
          USER_CALLER,
        ),
      );
    const taken = yield* store.hasPipeline(REVIEW_FIX_VERIFY.id).pipe(Effect.catch(storageError));
    // A person's own bot named fixer may not fit; the pipeline is then not offered.
    const fits =
      firstError(checkPipeline(REVIEW_FIX_VERIFY, { bots: all, versionExists: () => true })) ===
      undefined;
    if (!taken && fits) yield* write(REVIEW_FIX_VERIFY, USER_CALLER, undefined);
    yield* store
      .recordStarter(PIPELINE_STARTER_ID, PIPELINE_STARTER_REVISION, yield* nowIso)
      .pipe(Effect.catch(storageError));
  });

  return {
    list,
    get: requirePipeline,
    check,
    save,
    delete: remove,
    run,
    cancel,
    resume,
    listRuns,
    getRun,
    awaitRun,
    recover,
    seedStarter,
    changes: Stream.fromPubSub(changes),
  };
});

export class BotPipelines extends Context.Service<BotPipelines, Effect.Success<typeof make>>()(
  "t3/fork/bots/pipelines/BotPipelines",
) {}

export const layer = Layer.effect(BotPipelines, make);

/** Resumes runs the previous server left active, then offers the starter pipeline. */
export const BotPipelinesRecoveryLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const pipelines = yield* BotPipelines;
    yield* forkParked(
      pipelines.recover().pipe(
        Effect.catchCause((cause) => Effect.logWarning("Bot pipeline recovery failed", { cause })),
        Effect.andThen(
          pipelines
            .seedStarter()
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Seeding the starter pipeline failed", { cause }),
              ),
            ),
        ),
      ),
    );
  }),
);
