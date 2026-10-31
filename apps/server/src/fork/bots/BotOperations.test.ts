import { describe, expect, it } from "@effect/vitest";
import { BotsError, DEFAULT_BOT_BADGE_PREFERENCES } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { BotsMigrations } from "./migrations.ts";
import { makeBotOperationState } from "./BotOperationState.ts";
import * as Operations from "./BotOperations.ts";
import * as Bots from "./BotsService.ts";
import * as Batches from "./BotBatches.ts";
import * as Pipelines from "./pipelines/BotPipelines.ts";
import { makeBotsStore } from "./BotsStore.ts";
import { testRun } from "./testing/fixtures.ts";

const withDatabase = <A, E>(program: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  runForkMigrationSet(BotsMigrations).pipe(Effect.andThen(program), Effect.provide(layerMemory));

describe("BotOperations", () => {
  it.effect("streams badge preferences after durable saves and result-delivery invalidation", () =>
    withDatabase(
      Effect.gen(function* () {
        const dependencies = Layer.mergeAll(
          Layer.mock(Bots.BotsService)({ activeRunCount: () => 0 }),
          Layer.mock(Batches.BotBatches)({}),
          Layer.mock(Pipelines.BotPipelines)({}),
        );
        yield* Effect.gen(function* () {
          const operations = yield* Operations.BotOperations;
          const updates = yield* Queue.unbounded<boolean>();
          const watcher = yield* operations.badgeChanges.pipe(
            Stream.runForEach((preferences) => Queue.offer(updates, preferences.enabled)),
            Effect.forkChild,
          );
          expect(yield* Queue.take(updates)).toBe(true);
          yield* operations.setBadgePreferences({
            ...DEFAULT_BOT_BADGE_PREFERENCES,
            enabled: false,
          });
          expect(yield* Queue.take(updates)).toBe(false);
          expect(yield* operations.badgePreferences()).toMatchObject({ enabled: false });
          yield* operations.notifyBadgeChange();
          expect(yield* Queue.take(updates)).toBe(false);
          yield* Fiber.interrupt(watcher);
        }).pipe(Effect.provide(Operations.layer.pipe(Layer.provide(dependencies))));
      }),
    ),
  );

  it.effect("does not report a remote cancellation request as a confirmed stop", () =>
    withDatabase(
      Effect.gen(function* () {
        const store = yield* makeBotsStore;
        const run = testRun("unconfirmed", "2026-10-20T00:00:00Z", {
          status: "running",
          finishedAt: null,
        });
        yield* store.insertRun(run);
        const dependencies = Layer.mergeAll(
          Layer.mock(Bots.BotsService)({
            activeRunCount: () => 0,
            cancel: () => Effect.succeed(run),
          }),
          Layer.mock(Batches.BotBatches)({}),
          Layer.mock(Pipelines.BotPipelines)({}),
        );
        const result = yield* Effect.gen(function* () {
          return yield* (yield* Operations.BotOperations).stopAll();
        }).pipe(Effect.provide(Operations.layer.pipe(Layer.provide(dependencies))));
        expect(result.cancelled.runs).toBe(0);
        expect(result.failures).toMatchObject([{ kind: "run", id: "unconfirmed" }]);
        expect(yield* (yield* makeBotOperationState).getMode()).toBe("paused");
      }),
    ),
  );

  it.effect("defaults to manual, gates trigger admissions, and persists every mode", () =>
    withDatabase(
      Effect.gen(function* () {
        const operations = yield* makeBotOperationState;
        expect(yield* operations.getMode()).toBe("manual");
        yield* operations.checkAdmission(false);
        expect(yield* operations.checkAdmission(true).pipe(Effect.flip)).toMatchObject({
          reason: "invalid",
        });
        yield* operations.setMode("automatic");
        yield* operations.checkAdmission(true);
        yield* operations.setMode("paused");
        const restarted = yield* makeBotOperationState;
        expect(yield* restarted.getMode()).toBe("paused");
        expect(yield* restarted.checkAdmission(false).pipe(Effect.flip)).toMatchObject({
          reason: "invalid",
        });
        expect(yield* restarted.checkAdmission(true).pipe(Effect.flip)).toMatchObject({
          reason: "invalid",
        });
      }),
    ),
  );

  it.effect(
    "pauses before cancellation and reports every failed local, remote, batch and pipeline stop",
    () =>
      withDatabase(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const store = yield* makeBotsStore;
          yield* store.insertRun(
            testRun("local", "2026-10-20T00:00:00Z", { status: "running", finishedAt: null }),
          );
          yield* store.insertRun(
            testRun("remote", "2026-10-20T00:00:00Z", { status: "queued", finishedAt: null }),
          );
          yield* sql`UPDATE fork_bots_runs SET target_environment_id = 'other-computer' WHERE id = 'remote'`;
          yield* sql`INSERT INTO fork_bots_batches (id,bot_id,bot_version,bot_name,definition_json,source_json,source_summary,shared_inputs_json,status,started_by,created_at) VALUES ('batch','reviewer',1,'Reviewer','{}','{}','test','{}','running','user','2026-10-20T00:00:00Z')`;
          yield* sql`INSERT INTO fork_bots_pipeline_runs (id,pipeline_id,pipeline_version,pipeline_name,definition_json,versions_json,inputs_json,status,started_by,created_at) VALUES ('pipeline','review-fix',1,'Review','{}','{}','{}','waiting','user','2026-10-20T00:00:00Z')`;
          const mode = yield* makeBotOperationState;
          const stopped: string[] = [];
          const refuse = (kind: string, id: string) =>
            Effect.gen(function* () {
              expect(yield* mode.getMode()).toBe("paused");
              stopped.push(`${kind}:${id}`);
              if (kind === "pipeline")
                yield* store
                  .insertRun(
                    testRun("late", "2026-10-20T00:00:00Z", {
                      status: "running",
                      finishedAt: null,
                    }),
                  )
                  .pipe(Effect.orDie);
              return yield* new BotsError({
                reason: "launch",
                message: "The computer did not acknowledge cancellation.",
              });
            });
          const dependencies = Layer.mergeAll(
            Layer.mock(Bots.BotsService)({
              activeRunCount: () => 0,
              cancel: (id) => refuse("run", id),
            }),
            Layer.mock(Batches.BotBatches)({ cancel: (id) => refuse("batch", id) }),
            Layer.mock(Pipelines.BotPipelines)({ cancel: (id) => refuse("pipeline", id) }),
          );
          const result = yield* Effect.gen(function* () {
            return yield* (yield* Operations.BotOperations).stopAll();
          }).pipe(Effect.provide(Operations.layer.pipe(Layer.provide(dependencies))));
          expect(stopped.slice(0, 2)).toEqual(["pipeline:pipeline", "batch:batch"]);
          expect(stopped.slice(2).sort()).toEqual(["run:late", "run:local", "run:remote"]);
          expect(result).toMatchObject({
            mode: "paused",
            cancelled: { runs: 0, batches: 0, pipelines: 0 },
          });
          expect(result.failures.map((failure) => `${failure.kind}:${failure.id}`).sort()).toEqual(
            [...stopped].sort(),
          );
          expect(yield* mode.getMode()).toBe("paused");
          expect((yield* store.listRuns({ limit: 10 })).runs).toHaveLength(3);
        }),
      ),
  );
});
