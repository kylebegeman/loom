import { RuntimeMode } from "@t3tools/contracts";
import {
  BotCreator,
  BotTriggerEvent,
  BotTriggerMapping,
  type BotTrigger,
  type BotTriggerFiring,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import type { PullRequestState } from "./matchers.ts";

export const FIRINGS_KEPT_PER_TRIGGER = 500;
/** Pull requests with no update for this long are forgotten. */
export const PR_STATE_IDLE_MS = 90 * 24 * 60 * 60 * 1000;

const Settings = Schema.Struct({
  name: Schema.String,
  event: BotTriggerEvent,
  mapping: BotTriggerMapping,
  cooldownMinutes: Schema.Int,
  dailyLimit: Schema.Int,
  followStable: Schema.optionalKey(Schema.Boolean),
  pipelineId: Schema.optionalKey(Schema.String),
});
const settingsJson = Schema.fromJsonString(Settings);
const decodeSettings = Schema.decodeUnknownOption(settingsJson);
const encodeSettings = Schema.encodeSync(settingsJson);
const decodeCreator = Schema.decodeUnknownOption(BotCreator);
const decodeRuntimeMode = Schema.decodeUnknownOption(RuntimeMode);

interface TriggerRow {
  readonly id: string;
  readonly bot_id: string;
  readonly trigger_json: string;
  readonly enabled: number;
  readonly pinned_version: number;
  readonly follow_latest: number;
  readonly created_by: string;
  readonly creator_runtime_mode: string | null;
  readonly webhook_token: string | null;
  readonly webhook_secret: string | null;
  readonly next_fire_at: string | null;
  readonly last_fired_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface FiringRow {
  readonly id: string;
  readonly trigger_id: string;
  readonly event_key: string;
  readonly event_summary: string;
  readonly fired_at: string;
  readonly outcome: string;
  readonly run_id: string | null;
  readonly reason: string | null;
}

/** A trigger with what never leaves the server: the hook credentials and the creator's mode. */
export interface StoredTrigger {
  /** Without `webhook`, which the service adds per caller. */
  readonly trigger: BotTrigger;
  readonly creatorRuntimeMode: RuntimeMode | null;
  readonly webhookToken: string | null;
  readonly webhookSecret: string | null;
}

const toStored = (row: TriggerRow): StoredTrigger | null => {
  const settings = Option.getOrNull(decodeSettings(row.trigger_json));
  if (settings === null) return null;
  return {
    trigger: {
      id: row.id,
      botId: row.bot_id,
      ...settings,
      enabled: row.enabled === 1,
      pinnedVersion: row.pinned_version,
      followLatest: row.follow_latest === 1,
      createdBy: Option.getOrElse(decodeCreator(row.created_by), () => "user" as const),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastFiredAt: row.last_fired_at,
      ...(settings.event.kind === "schedule" ? { nextFireAt: row.next_fire_at } : {}),
    },
    creatorRuntimeMode:
      row.creator_runtime_mode === null
        ? null
        : Option.getOrNull(decodeRuntimeMode(row.creator_runtime_mode)),
    webhookToken: row.webhook_token,
    webhookSecret: row.webhook_secret,
  };
};

const toFiring = (row: FiringRow): BotTriggerFiring => ({
  id: row.id,
  triggerId: row.trigger_id,
  eventKey: row.event_key,
  eventSummary: row.event_summary,
  firedAt: row.fired_at,
  outcome: row.outcome === "run" ? "run" : "skipped",
  runId: row.run_id,
  reason: row.reason,
});

export const makeBotTriggersStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const list = Effect.fn("BotTriggersStore.list")(function* (botId?: string) {
    const rows =
      botId === undefined
        ? yield* sql<TriggerRow>`SELECT * FROM fork_bots_triggers ORDER BY created_at`
        : yield* sql<TriggerRow>`SELECT * FROM fork_bots_triggers WHERE bot_id = ${botId} ORDER BY created_at`;
    return rows.flatMap((row) => toStored(row) ?? []);
  });

  return {
    withTransaction: sql.withTransaction,
    list,

    get: Effect.fn("BotTriggersStore.get")(function* (id: string) {
      const rows = yield* sql<TriggerRow>`SELECT * FROM fork_bots_triggers WHERE id = ${id}`;
      return rows[0] === undefined ? null : toStored(rows[0]);
    }),

    upsert: Effect.fn("BotTriggersStore.upsert")(function* (stored: StoredTrigger) {
      const { trigger } = stored;
      const json = encodeSettings({
        name: trigger.name,
        event: trigger.event,
        mapping: trigger.mapping,
        cooldownMinutes: trigger.cooldownMinutes,
        dailyLimit: trigger.dailyLimit,
        ...(trigger.followStable === true ? { followStable: true } : {}),
        ...(trigger.pipelineId == null ? {} : { pipelineId: trigger.pipelineId }),
      });
      yield* sql`INSERT INTO fork_bots_triggers (id, bot_id, trigger_json, enabled, pinned_version, follow_latest, created_by, creator_runtime_mode, webhook_token, webhook_secret, next_fire_at, last_fired_at, created_at, updated_at) VALUES (${trigger.id}, ${trigger.botId}, ${json}, ${trigger.enabled ? 1 : 0}, ${trigger.pinnedVersion}, ${trigger.followLatest ? 1 : 0}, ${trigger.createdBy}, ${stored.creatorRuntimeMode}, ${stored.webhookToken}, ${stored.webhookSecret}, ${trigger.nextFireAt ?? null}, ${trigger.lastFiredAt}, ${trigger.createdAt}, ${trigger.updatedAt}) ON CONFLICT(id) DO UPDATE SET trigger_json = excluded.trigger_json, enabled = excluded.enabled, pinned_version = excluded.pinned_version, follow_latest = excluded.follow_latest, webhook_token = excluded.webhook_token, webhook_secret = excluded.webhook_secret, next_fire_at = excluded.next_fire_at, updated_at = excluded.updated_at`;
    }),

    /** Deletes triggers and their firings. */
    delete: Effect.fn("BotTriggersStore.delete")(function* (ids: ReadonlyArray<string>) {
      if (ids.length === 0) return;
      yield* sql`DELETE FROM fork_bots_trigger_firings WHERE trigger_id IN ${sql.in(ids)}`;
      yield* sql`DELETE FROM fork_bots_triggers WHERE id IN ${sql.in(ids)}`;
    }),

    setLastFired: Effect.fn("BotTriggersStore.setLastFired")(function* (id: string, at: string) {
      yield* sql`UPDATE fork_bots_triggers SET last_fired_at = ${at} WHERE id = ${id}`;
    }),

    setNextFire: Effect.fn("BotTriggersStore.setNextFire")(function* (
      id: string,
      at: string | null,
    ) {
      yield* sql`UPDATE fork_bots_triggers SET next_fire_at = ${at} WHERE id = ${id}`;
    }),

    /** False when the trigger already fired for this event key. */
    insertFiring: Effect.fn("BotTriggersStore.insertFiring")(function* (firing: BotTriggerFiring) {
      const rows = yield* sql<{
        id: string;
      }>`INSERT INTO fork_bots_trigger_firings (id, trigger_id, event_key, event_summary, fired_at, outcome, run_id, reason) VALUES (${firing.id}, ${firing.triggerId}, ${firing.eventKey}, ${firing.eventSummary}, ${firing.firedAt}, ${firing.outcome}, ${firing.runId}, ${firing.reason}) ON CONFLICT(trigger_id, event_key) DO NOTHING RETURNING id`;
      return rows.length > 0;
    }),

    updateFiring: Effect.fn("BotTriggersStore.updateFiring")(function* (firing: BotTriggerFiring) {
      yield* sql`UPDATE fork_bots_trigger_firings SET outcome = ${firing.outcome}, run_id = ${firing.runId}, reason = ${firing.reason} WHERE id = ${firing.id}`;
    }),

    firings: Effect.fn("BotTriggersStore.firings")(function* (
      triggerId: string,
      before: string | undefined,
      limit: number,
    ) {
      const rows =
        before === undefined
          ? yield* sql<FiringRow>`SELECT * FROM fork_bots_trigger_firings WHERE trigger_id = ${triggerId} ORDER BY fired_at DESC, id DESC LIMIT ${limit + 1}`
          : yield* sql<FiringRow>`SELECT * FROM fork_bots_trigger_firings WHERE trigger_id = ${triggerId} AND fired_at < ${before} ORDER BY fired_at DESC, id DESC LIMIT ${limit + 1}`;
      return { firings: rows.slice(0, limit).map(toFiring), hasMore: rows.length > limit };
    }),

    /** The last firing that started a run, and how many did since `since`. */
    runFirings: Effect.fn("BotTriggersStore.runFirings")(function* (
      triggerId: string,
      since: string,
    ) {
      const rows = yield* sql<{
        last: string | null;
        count: number;
      }>`SELECT (SELECT MAX(fired_at) FROM fork_bots_trigger_firings WHERE trigger_id = ${triggerId} AND outcome = 'run') AS last, (SELECT COUNT(*) FROM fork_bots_trigger_firings WHERE trigger_id = ${triggerId} AND outcome = 'run' AND fired_at >= ${since}) AS count`;
      return { lastRunAt: rows[0]?.last ?? null, count: rows[0]?.count ?? 0 };
    }),

    pruneFirings: Effect.fn("BotTriggersStore.pruneFirings")(function* (triggerId: string) {
      yield* sql`DELETE FROM fork_bots_trigger_firings WHERE id IN (SELECT id FROM fork_bots_trigger_firings WHERE trigger_id = ${triggerId} ORDER BY fired_at DESC, id DESC LIMIT -1 OFFSET ${FIRINGS_KEPT_PER_TRIGGER})`;
    }),

    getCursor: Effect.fn("BotTriggersStore.getCursor")(function* (eventType: string) {
      const rows = yield* sql<{
        after_sequence: number;
      }>`SELECT after_sequence FROM fork_bots_trigger_cursors WHERE event_type = ${eventType}`;
      return rows[0]?.after_sequence ?? null;
    }),

    setCursor: Effect.fn("BotTriggersStore.setCursor")(function* (
      eventType: string,
      afterSequence: number,
    ) {
      yield* sql`INSERT INTO fork_bots_trigger_cursors (event_type, after_sequence) VALUES (${eventType}, ${afterSequence}) ON CONFLICT(event_type) DO UPDATE SET after_sequence = excluded.after_sequence`;
    }),

    getPullRequest: Effect.fn("BotTriggersStore.getPullRequest")(function* (key: string) {
      const rows = yield* sql<{
        checks_state: string | null;
        head_sha: string | null;
        seen_open: number;
      }>`SELECT checks_state, head_sha, seen_open FROM fork_bots_trigger_pr_state WHERE pr_key = ${key}`;
      const row = rows[0];
      return row === undefined
        ? null
        : ({
            checksState: row.checks_state,
            headSha: row.head_sha,
            seenOpen: row.seen_open === 1,
          } satisfies PullRequestState);
    }),

    setPullRequest: Effect.fn("BotTriggersStore.setPullRequest")(function* (
      key: string,
      state: PullRequestState,
      at: string,
    ) {
      yield* sql`INSERT INTO fork_bots_trigger_pr_state (pr_key, checks_state, head_sha, seen_open, updated_at) VALUES (${key}, ${state.checksState}, ${state.headSha}, ${state.seenOpen ? 1 : 0}, ${at}) ON CONFLICT(pr_key) DO UPDATE SET checks_state = excluded.checks_state, head_sha = excluded.head_sha, seen_open = excluded.seen_open, updated_at = excluded.updated_at`;
    }),

    prunePullRequests: Effect.fn("BotTriggersStore.prunePullRequests")(function* (before: string) {
      yield* sql`DELETE FROM fork_bots_trigger_pr_state WHERE updated_at < ${before}`;
    }),
  };
});

export type BotTriggersStore = Effect.Success<typeof makeBotTriggersStore>;
