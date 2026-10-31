import {
  BotsError,
  isTerminalBotRunStatus,
  isActiveBotPipelineRunStatus,
  type BotBadgePreferences,
  type BotOperationMode,
  type BotOperationState,
  type BotStopAllResult,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as Bots from "./BotsService.ts";
import * as Batches from "./BotBatches.ts";
import * as Pipelines from "./pipelines/BotPipelines.ts";
import { makeBotOperationState } from "./BotOperationState.ts";
import { makeBotBadgePreferences } from "./BotBadgePreferences.ts";

export class BotOperations extends Context.Service<
  BotOperations,
  {
    readonly badgePreferences: () => Effect.Effect<BotBadgePreferences, BotsError>;
    readonly setBadgePreferences: (
      preferences: BotBadgePreferences,
    ) => Effect.Effect<BotBadgePreferences, BotsError>;
    readonly badgeChanges: Stream.Stream<BotBadgePreferences, BotsError>;
    readonly notifyBadgeChange: () => Effect.Effect<void, BotsError>;
    readonly state: () => Effect.Effect<BotOperationState, BotsError>;
    readonly setMode: (mode: BotOperationMode) => Effect.Effect<BotOperationState, BotsError>;
    readonly stopAll: () => Effect.Effect<BotStopAllResult, BotsError>;
    readonly changes: Stream.Stream<BotOperationState, BotsError>;
  }
>()("t3/fork/bots/BotOperations") {}

const make = Effect.gen(function* () {
  const operations = yield* makeBotOperationState;
  const badgePreferences = yield* makeBotBadgePreferences;
  const badgeChanges = yield* PubSub.unbounded<BotBadgePreferences>();
  const bots = yield* Bots.BotsService;
  const batches = yield* Batches.BotBatches;
  const pipelines = yield* Pipelines.BotPipelines;
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<BotOperationState>();
  const permit = yield* Semaphore.make(1);
  const badgePermit = yield* Semaphore.make(1);
  const state = Effect.fn("BotOperations.state")(function* () {
    return { mode: yield* operations.getMode() };
  });
  const saveMode = Effect.fn("BotOperations.saveMode")(function* (mode: BotOperationMode) {
    const next = { mode: yield* operations.setMode(mode) };
    yield* PubSub.publish(changes, next);
    return next;
  });
  const setMode = Effect.fn("BotOperations.setMode")(
    (mode: BotOperationMode) => saveMode(mode),
    permit.withPermits(1),
  );
  const stopAll = Effect.fn("BotOperations.stopAll")(function* () {
    yield* saveMode("paused");
    const targets = yield* Effect.gen(function* () {
      const pipeline = yield* sql<{
        id: string;
      }>`SELECT id FROM fork_bots_pipeline_runs WHERE status IN ('running', 'waiting')`;
      const batch = yield* sql<{
        id: string;
      }>`SELECT id FROM fork_bots_batches WHERE status = 'running'`;
      return { pipeline, batch };
    }).pipe(
      Effect.mapError(
        () =>
          new BotsError({
            reason: "storage",
            message: "Bots are paused, but Loom could not read the jobs that still need stopping.",
          }),
      ),
    );
    const cancelled = { runs: 0, batches: 0, pipelines: 0 };
    const failures: Array<BotStopAllResult["failures"][number]> = [];
    for (const { id } of targets.pipeline) {
      const result = yield* pipelines.cancel(id).pipe(Effect.result);
      if (result._tag === "Failure")
        failures.push({ kind: "pipeline", id, message: result.failure.message });
      else if (isActiveBotPipelineRunStatus(result.success.status))
        failures.push({
          kind: "pipeline",
          id,
          message: "Cancellation was requested, but the pipeline has not confirmed it stopped.",
        });
      else cancelled.pipelines++;
    }
    for (const { id } of targets.batch) {
      const result = yield* batches.cancel(id).pipe(Effect.result);
      if (result._tag === "Failure")
        failures.push({ kind: "batch", id, message: result.failure.message });
      else if (result.success.status === "running")
        failures.push({
          kind: "batch",
          id,
          message: "Cancellation was requested, but the batch has not confirmed it stopped.",
        });
      else cancelled.batches++;
    }
    const activeRuns = yield* sql<{
      id: string;
    }>`SELECT id FROM fork_bots_runs WHERE status IN ('queued', 'running')`.pipe(
      Effect.mapError(
        () =>
          new BotsError({
            reason: "storage",
            message: "Bots are paused, but Loom could not read the remaining runs to stop.",
          }),
      ),
    );
    for (const { id } of activeRuns) {
      const result = yield* bots.cancel(id).pipe(Effect.result);
      if (result._tag === "Failure")
        failures.push({ kind: "run", id, message: result.failure.message });
      else if (!isTerminalBotRunStatus(result.success.status))
        failures.push({
          kind: "run",
          id,
          message:
            "Cancellation was requested, but the execution computer has not confirmed the run stopped.",
        });
      else cancelled.runs++;
    }
    return { mode: "paused" as const, cancelled, failures };
  }, permit.withPermits(1));
  return BotOperations.of({
    badgePreferences: badgePreferences.get,
    notifyBadgeChange: Effect.fn("BotOperations.notifyBadgeChange")(function* () {
      yield* PubSub.publish(badgeChanges, yield* badgePreferences.get());
    }, badgePermit.withPermits(1)),
    setBadgePreferences: Effect.fn("BotOperations.setBadgePreferences")(function* (
      preferences: BotBadgePreferences,
    ) {
      const saved = yield* badgePreferences.set(preferences);
      yield* PubSub.publish(badgeChanges, saved);
      return saved;
    }, badgePermit.withPermits(1)),
    badgeChanges: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(badgeChanges);
        return Stream.concat(
          Stream.fromEffect(badgePreferences.get()),
          Stream.fromSubscription(subscription),
        );
      }),
    ),
    state,
    setMode,
    stopAll,
    changes: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(Stream.fromEffect(state()), Stream.fromSubscription(subscription));
      }),
    ),
  });
});

export const layer = Layer.effect(BotOperations, make);
