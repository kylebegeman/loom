import {
  BotBadgePreferences,
  DEFAULT_BOT_BADGE_PREFERENCES,
  BotsError,
  type BotRun,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const preferencesJson = Schema.fromJsonString(BotBadgePreferences);
const decodePreferences = Schema.decodeUnknownEffect(preferencesJson);
const validatePreferences = Schema.decodeUnknownEffect(BotBadgePreferences);
const encodePreferences = Schema.encodeSync(preferencesJson);
const storageError = () =>
  new BotsError({
    reason: "storage",
    message: "Loom could not read or save bot badge preferences.",
  });

export const makeBotBadgePreferences = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const get = Effect.fn("BotBadgePreferences.get")(function* () {
    const rows = yield* sql<{
      value_json: string;
    }>`SELECT value_json FROM fork_bots_settings WHERE key = 'badge-preferences'`;
    return rows[0] === undefined
      ? DEFAULT_BOT_BADGE_PREFERENCES
      : yield* decodePreferences(rows[0].value_json);
  }, Effect.mapError(storageError));
  const set = Effect.fn("BotBadgePreferences.set")(function* (input: BotBadgePreferences) {
    const valid = yield* validatePreferences(input).pipe(
      Effect.mapError(
        () =>
          new BotsError({
            reason: "invalid",
            message: "Choose valid bot badge preferences and at most 200 muted bots.",
          }),
      ),
    );
    const preferences = { ...valid, mutedBotIds: [...new Set(valid.mutedBotIds)].sort() };
    yield* sql`INSERT INTO fork_bots_settings (key,value_json) VALUES ('badge-preferences',${encodePreferences(preferences)}) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`.pipe(
      Effect.mapError(storageError),
    );
    return preferences;
  });
  const count = Effect.fn("BotBadgePreferences.count")(function* (waiting: ReadonlyArray<BotRun>) {
    const preferences = yield* get();
    if (!preferences.enabled) return { count: 0 };
    const muted = new Set(preferences.mutedBotIds);
    const unmutedRun = muted.size === 0 ? sql`1 = 1` : sql`r.bot_id NOT IN ${sql.in([...muted])}`;
    const rows = yield* sql<{ id: string; pipeline_run_id: string | null }>`
      SELECT r.id,r.pipeline_run_id FROM fork_bots_runs r
      WHERE r.dismissed_at IS NULL AND r.retried_by IS NULL AND r.replay_id IS NULL AND r.requested_by_json IS NULL
        AND NOT (r.started_by = 'agent' AND r.notify = 1 AND r.caller_thread_id IS NOT NULL AND r.delivered_at IS NOT NULL)
        AND ${unmutedRun}
        AND (
          (r.pipeline_run_id IS NULL AND (
            (${preferences.failed} AND r.status = 'failed') OR
            (${preferences.timedOut} AND r.status = 'timed_out') OR
            (${preferences.needsAttention} AND r.status = 'completed' AND r.verdict = 'needs_attention')
          )) OR
          (${preferences.stoppedPipelines} AND r.pipeline_run_id IS NOT NULL AND r.pipeline_stopped = 1) OR
          (${preferences.deliveryFailures} AND r.notify = 1 AND r.delivered_at IS NULL AND instr(r.error,'Result delivery failed:') > 0)
        )
    `.pipe(Effect.mapError(storageError));
    const identities = new Set(
      rows.map((row) =>
        row.pipeline_run_id === null ? `run:${row.id}` : `pipeline:${row.pipeline_run_id}`,
      ),
    );
    for (const run of waiting) {
      if (
        muted.has(run.botId) ||
        run.dismissedAt != null ||
        run.retriedBy != null ||
        run.replayId != null ||
        run.requestedBy != null
      )
        continue;
      if (
        (run.attention?.kind === "approval" && preferences.approvals) ||
        (run.attention?.kind === "question" && preferences.questions)
      )
        identities.add(`run:${run.id}`);
    }
    if (preferences.deliveryFailures) {
      const unmutedJob =
        muted.size === 0
          ? sql`1 = 1`
          : sql`(
        (r.id IS NOT NULL AND r.bot_id NOT IN ${sql.in([...muted])}) OR
        (b.id IS NOT NULL AND b.bot_id NOT IN ${sql.in([...muted])}) OR
        (p.id IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM json_each(p.definition_json,'$.steps')) OR EXISTS (
          SELECT 1 FROM json_each(p.definition_json,'$.steps') step WHERE json_extract(step.value,'$.botId') NOT IN ${sql.in([...muted])}
        ))) OR (r.id IS NULL AND b.id IS NULL AND p.id IS NULL)
      )`;
      const deliveries = yield* sql<{ kind: string; job_id: string }>`
        SELECT delivery.kind,delivery.job_id FROM fork_bots_completion_deliveries delivery
        JOIN fork_bots_completion_destinations destination ON destination.id = delivery.destination_id AND destination.project_id = delivery.project_id AND destination.deleted_at IS NULL
        LEFT JOIN fork_bots_runs r ON delivery.kind = 'run' AND r.id = delivery.job_id AND r.project_id = delivery.project_id
        LEFT JOIN fork_bots_batches b ON delivery.kind = 'batch' AND b.id = delivery.job_id AND b.project_id = delivery.project_id
        LEFT JOIN fork_bots_pipeline_runs p ON delivery.kind = 'pipeline' AND p.id = delivery.job_id AND p.project_id = delivery.project_id
        WHERE (delivery.status IN ('accepted','failed','needs_attention') OR (delivery.status = 'acknowledged' AND delivery.receiver_outcome = 'failed'))
          AND (r.id IS NULL OR (r.dismissed_at IS NULL AND r.retried_by IS NULL AND r.replay_id IS NULL AND r.requested_by_json IS NULL
            AND NOT (r.started_by = 'agent' AND r.notify = 1 AND r.caller_thread_id IS NOT NULL AND r.delivered_at IS NOT NULL)))
          AND ${unmutedJob}
      `.pipe(Effect.mapError(storageError));
      for (const delivery of deliveries) identities.add(`${delivery.kind}:${delivery.job_id}`);
    }
    return { count: identities.size };
  });
  return { get, set, count };
});
