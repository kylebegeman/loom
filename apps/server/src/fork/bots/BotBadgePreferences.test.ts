import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_BOT_BADGE_PREFERENCES, type BotRun } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { makeBotBadgePreferences } from "./BotBadgePreferences.ts";
import { makeBotsStore } from "./BotsStore.ts";
import { BotsMigrations } from "./migrations.ts";
import { testRun } from "./testing/fixtures.ts";

const at = "2026-10-20T10:00:00.000Z";
const withDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  runForkMigrationSet(BotsMigrations).pipe(Effect.andThen(effect), Effect.provide(layerMemory));

describe("BotBadgePreferences", () => {
  it.effect("counts all matching history beyond the first page and preserves hidden records", () =>
    withDatabase(
      Effect.gen(function* () {
        const store = yield* makeBotsStore;
        const preferences = yield* makeBotBadgePreferences;
        for (let index = 0; index < 60; index++)
          yield* store.insertRun(testRun(`failed-${index}`, at, { status: "failed" }));
        yield* store.insertRun(testRun("muted", at, { status: "failed", botId: "noisy" }));
        yield* store.insertRun(testRun("dismissed", at, { status: "failed" }));
        yield* store.setDismissed(["dismissed"], at);
        yield* store.insertRun(testRun("retried", at, { status: "failed" }));
        yield* store.setRetriedBy("retried", "newer");
        yield* store.insertRun(testRun("replay", at, { status: "failed", replayId: "replay" }));
        yield* store.insertRun(
          testRun("remote-owned", at, {
            status: "failed",
            requestedBy: { environmentId: EnvironmentId.make("other"), label: "Other" },
          }),
        );
        yield* store.insertRun(
          testRun("handled", at, {
            status: "failed",
            startedBy: "agent",
            notify: true,
            callerThreadId: ThreadId.make("caller"),
          }),
        );
        yield* store.markNotified("handled", at, null, true);
        expect(yield* preferences.count([])).toEqual({ count: 61 });
        yield* preferences.set({ ...DEFAULT_BOT_BADGE_PREFERENCES, mutedBotIds: ["noisy"] });
        expect(yield* preferences.count([])).toEqual({ count: 60 });
        yield* preferences.set({ ...DEFAULT_BOT_BADGE_PREFERENCES, failed: false });
        expect(yield* preferences.count([])).toEqual({ count: 0 });
        yield* preferences.set({ ...DEFAULT_BOT_BADGE_PREFERENCES, enabled: false });
        expect(yield* preferences.count([])).toEqual({ count: 0 });
        const sql = yield* SqlClient.SqlClient;
        expect(
          (yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM fork_bots_runs`)[0]?.count,
        ).toBe(66);
        yield* preferences.set(DEFAULT_BOT_BADGE_PREFERENCES);
        expect(yield* preferences.count([])).toEqual({ count: 61 });
      }),
    ),
  );

  it.effect(
    "filters approval, question, terminal, pipeline and result-delivery categories independently",
    () =>
      withDatabase(
        Effect.gen(function* () {
          const store = yield* makeBotsStore;
          const preferences = yield* makeBotBadgePreferences;
          yield* store.insertRun(testRun("timeout", at, { status: "timed_out" }));
          const undecided = testRun("undecided", at, {
            verdict: {
              verdict: "needs_attention",
              summary: "Check this",
              findings: [],
              findingsTruncated: false,
              source: "decoded",
            },
          });
          yield* store.insertRun(undecided);
          yield* store.saveRun(undecided);
          yield* store.insertRun(
            testRun("pipeline", at, { status: "failed", pipelineRunId: "pipeline" }),
          );
          yield* store.setPipelineStopped("pipeline", true);
          yield* store.insertRun(
            testRun("delivery", at, {
              notify: true,
              callerThreadId: ThreadId.make("caller"),
              error: "Result delivery failed: unavailable.",
            }),
          );
          const waiting: BotRun[] = ["approval", "question"].map((kind) =>
            testRun(kind, at, {
              status: "running",
              finishedAt: null,
              attention: {
                kind: kind as "approval" | "question",
                requestId: kind,
                since: at,
                timeoutPolicy: "wall-clock",
              },
            }),
          );
          expect(yield* preferences.count(waiting)).toEqual({ count: 6 });
          yield* preferences.set({
            ...DEFAULT_BOT_BADGE_PREFERENCES,
            approvals: false,
            timedOut: false,
            stoppedPipelines: false,
          });
          expect(yield* preferences.count(waiting)).toEqual({ count: 3 });
          yield* preferences.set({
            ...DEFAULT_BOT_BADGE_PREFERENCES,
            questions: false,
            needsAttention: false,
            deliveryFailures: false,
          });
          expect(yield* preferences.count(waiting)).toEqual({ count: 3 });
          yield* preferences.set({ ...DEFAULT_BOT_BADGE_PREFERENCES, mutedBotIds: ["reviewer"] });
          expect(yield* preferences.count(waiting)).toEqual({ count: 0 });
        }),
      ),
  );

  it.effect(
    "deduplicates failed runs and external deliveries, honoring job bots and acknowledgements",
    () =>
      withDatabase(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const store = yield* makeBotsStore;
          const preferences = yield* makeBotBadgePreferences;
          yield* sql`INSERT INTO fork_bots_completion_destinations (id,label,project_id,host,enabled,fingerprint,created_at) VALUES ('destination','Test','project-a','example.com',1,'test',${at})`;
          yield* store.insertRun(testRun("failed", at, { status: "failed" }));
          yield* store.insertRun(testRun("accepted", at));
          yield* sql`INSERT INTO fork_bots_batches (id,bot_id,bot_version,bot_name,definition_json,project_id,source_json,source_summary,shared_inputs_json,status,started_by,created_at) VALUES ('batch','noisy',1,'Noisy','{}','project-a','{}','test','{}','finished','user',${at})`;
          yield* sql`INSERT INTO fork_bots_pipeline_runs (id,pipeline_id,pipeline_version,pipeline_name,definition_json,versions_json,inputs_json,project_id,status,started_by,created_at) VALUES ('pipeline','p',1,'Pipeline','{"steps":[{"botId":"noisy"},{"botId":"quiet"}]}','{}','{}','project-a','completed','user',${at})`;
          for (const [id, kind, status] of [
            ["failed", "run", "needs_attention"],
            ["accepted", "run", "accepted"],
            ["batch", "batch", "failed"],
            ["pipeline", "pipeline", "needs_attention"],
          ] as const)
            yield* sql`INSERT INTO fork_bots_completion_deliveries (id,destination_id,kind,job_id,project_id,status,created_at,updated_at,next_attempt_at) VALUES (${id},'destination',${kind},${id},'project-a',${status},${at},${at},${at})`;
          expect(yield* preferences.count([])).toEqual({ count: 4 });
          yield* preferences.set({
            ...DEFAULT_BOT_BADGE_PREFERENCES,
            mutedBotIds: ["reviewer", "noisy"],
          });
          expect(yield* preferences.count([])).toEqual({ count: 1 });
          yield* sql`UPDATE fork_bots_completion_deliveries SET status='acknowledged',receiver_outcome='completed' WHERE id='pipeline'`;
          expect(yield* preferences.count([])).toEqual({ count: 0 });
          yield* preferences.set({ ...DEFAULT_BOT_BADGE_PREFERENCES, deliveryFailures: false });
          expect(yield* preferences.count([])).toEqual({ count: 1 });
        }),
      ),
  );

  it.effect("persists normalized preferences, rejects corruption and restores defaults", () =>
    withDatabase(
      Effect.gen(function* () {
        const preferences = yield* makeBotBadgePreferences;
        expect(yield* preferences.get()).toEqual(DEFAULT_BOT_BADGE_PREFERENCES);
        yield* preferences.set({
          ...DEFAULT_BOT_BADGE_PREFERENCES,
          enabled: false,
          mutedBotIds: ["noisy", "noisy"],
        });
        expect(yield* (yield* makeBotBadgePreferences).get()).toMatchObject({
          enabled: false,
          mutedBotIds: ["noisy"],
        });
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE fork_bots_settings SET value_json='invalid' WHERE key='badge-preferences'`;
        expect(yield* preferences.get().pipe(Effect.flip)).toMatchObject({ reason: "storage" });
        yield* preferences.set(DEFAULT_BOT_BADGE_PREFERENCES);
        expect(yield* preferences.get()).toEqual(DEFAULT_BOT_BADGE_PREFERENCES);
      }),
    ),
  );
});
