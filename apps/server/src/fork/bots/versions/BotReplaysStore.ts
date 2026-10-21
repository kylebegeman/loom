import {
  BotDefinition,
  BotReplayComparison,
  BotReplaySource,
  type BotCreator,
  type BotReplay,
  type BotReplayItem,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** Replays kept per bot, and how long a finished one is kept; their runs are pruned as runs. */
export const REPLAYS_KEPT_PER_BOT = 20;
export const REPLAY_KEPT_DAYS = 30;

interface ReplayRow {
  readonly id: string;
  readonly bot_id: string;
  readonly source_json: string;
  readonly draft_json: string | null;
  readonly base_version: number;
  readonly status: string;
  readonly started_by: string;
  readonly created_at: string;
  readonly finished_at: string | null;
}

interface ItemRow {
  readonly original_run_id: string;
  readonly replay_run_id: string | null;
  readonly comparison: string;
  readonly reason: string | null;
}

/** What the store holds about a replay beyond what clients see. */
export interface StoredReplay {
  readonly replay: Omit<BotReplay, "items" | "summary">;
  /** The unsaved definition a draft replay runs; null for a saved version. */
  readonly draft: BotDefinition | null;
  readonly startedBy: BotCreator;
}

const sourceJson = Schema.fromJsonString(BotReplaySource);
// A draft carries `BOT_DRAFT_VERSION`, below the lowest saved version.
const definitionJson = Schema.fromJsonString(
  BotDefinition.mapFields((fields) => ({ ...fields, version: Schema.Int })),
);
const decodeSource = Schema.decodeUnknownOption(sourceJson);
const decodeDefinition = Schema.decodeUnknownOption(definitionJson);
const encodeSource = Schema.encodeSync(sourceJson);
const encodeDefinition = Schema.encodeSync(definitionJson);
const isStatus = Schema.is(Schema.Literals(["running", "done", "cancelled"]));
const isComparison = Schema.is(BotReplayComparison);

// A row written by a future version this one cannot read is skipped, not fatal.
const toStored = (row: ReplayRow): StoredReplay | null => {
  const source = decodeSource(row.source_json);
  const draft = row.draft_json === null ? null : decodeDefinition(row.draft_json);
  const { status } = row;
  if (Option.isNone(source) || (draft !== null && Option.isNone(draft)) || !isStatus(status))
    return null;
  return {
    replay: {
      id: row.id,
      botId: row.bot_id,
      source: source.value,
      baseVersion: Number(row.base_version),
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      status,
    },
    draft: draft === null ? null : Option.getOrNull(draft),
    startedBy: row.started_by === "agent" ? "agent" : "user",
  };
};

const toItem = (row: ItemRow): BotReplayItem | null =>
  isComparison(row.comparison)
    ? {
        originalRunId: row.original_run_id,
        replayRunId: row.replay_run_id,
        comparison: row.comparison,
        reason: row.reason,
      }
    : null;

export const makeBotReplaysStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return {
    withTransaction: sql.withTransaction,

    getReplay: Effect.fn("BotReplaysStore.getReplay")(function* (id: string) {
      const rows = yield* sql<ReplayRow>`SELECT * FROM fork_bots_replays WHERE id = ${id}`;
      return rows[0] ? toStored(rows[0]) : null;
    }),

    /** In the order the runs were chosen. */
    getItems: Effect.fn("BotReplaysStore.getItems")(function* (replayId: string) {
      const rows =
        yield* sql<ItemRow>`SELECT original_run_id, replay_run_id, comparison, reason FROM fork_bots_replay_items WHERE replay_id = ${replayId} ORDER BY position`;
      return rows.flatMap((row) => toItem(row) ?? []);
    }),

    insertReplay: Effect.fn("BotReplaysStore.insertReplay")(function* (
      stored: StoredReplay,
      items: ReadonlyArray<BotReplayItem>,
    ) {
      const { replay } = stored;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`INSERT INTO fork_bots_replays (id,bot_id,source_json,draft_json,base_version,status,started_by,created_at,finished_at) VALUES (${replay.id},${replay.botId},${encodeSource(replay.source)},${stored.draft === null ? null : encodeDefinition(stored.draft)},${replay.baseVersion},${replay.status},${stored.startedBy},${replay.createdAt},${replay.finishedAt})`;
          for (const [position, item] of items.entries())
            yield* sql`INSERT INTO fork_bots_replay_items (replay_id,original_run_id,position,replay_run_id,comparison,reason) VALUES (${replay.id},${item.originalRunId},${position},${item.replayRunId},${item.comparison},${item.reason})`;
        }),
      );
    }),

    setStatus: Effect.fn("BotReplaysStore.setStatus")(function* (
      id: string,
      status: BotReplay["status"],
      finishedAt: string | null,
    ) {
      yield* sql`UPDATE fork_bots_replays SET status = ${status}, finished_at = ${finishedAt} WHERE id = ${id}`;
    }),

    setItemRun: Effect.fn("BotReplaysStore.setItemRun")(function* (
      replayId: string,
      originalRunId: string,
      runId: string,
    ) {
      yield* sql`UPDATE fork_bots_replay_items SET replay_run_id = ${runId} WHERE replay_id = ${replayId} AND original_run_id = ${originalRunId}`;
    }),

    setItemResult: Effect.fn("BotReplaysStore.setItemResult")(function* (
      replayId: string,
      originalRunId: string,
      comparison: BotReplayComparison,
      reason: string | null,
    ) {
      yield* sql`UPDATE fork_bots_replay_items SET comparison = ${comparison}, reason = ${reason} WHERE replay_id = ${replayId} AND original_run_id = ${originalRunId}`;
    }),

    /** Sends an item whose run never started back to wait. */
    requeueItem: Effect.fn("BotReplaysStore.requeueItem")(function* (
      replayId: string,
      originalRunId: string,
    ) {
      yield* sql`UPDATE fork_bots_replay_items SET replay_run_id = NULL, comparison = 'pending', reason = NULL WHERE replay_id = ${replayId} AND original_run_id = ${originalRunId}`;
    }),

    /** Items still waiting for a run fail with `reason`. */
    failWaiting: Effect.fn("BotReplaysStore.failWaiting")(function* (
      replayId: string,
      reason: string,
    ) {
      yield* sql`UPDATE fork_bots_replay_items SET comparison = 'failed', reason = ${reason} WHERE replay_id = ${replayId} AND replay_run_id IS NULL AND comparison = 'pending'`;
    }),

    originalForRun: Effect.fn("BotReplaysStore.originalForRun")(function* (
      replayId: string,
      runId: string,
    ) {
      const rows = yield* sql<{
        original_run_id: string;
      }>`SELECT original_run_id FROM fork_bots_replay_items WHERE replay_id = ${replayId} AND replay_run_id = ${runId}`;
      return rows[0]?.original_run_id ?? null;
    }),

    listRunning: Effect.fn("BotReplaysStore.listRunning")(function* () {
      const rows =
        yield* sql<ReplayRow>`SELECT * FROM fork_bots_replays WHERE status = 'running' ORDER BY created_at`;
      return rows.flatMap((row) => toStored(row) ?? []);
    }),

    /** Deletes finished replays of a bot beyond the newest `keep` or created before `before`. */
    pruneReplays: Effect.fn("BotReplaysStore.pruneReplays")(function* (
      botId: string,
      keep: number,
      before: string,
    ) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const stale = sql`SELECT id FROM fork_bots_replays WHERE bot_id = ${botId} AND status != 'running' AND (created_at < ${before} OR id NOT IN (SELECT id FROM fork_bots_replays WHERE bot_id = ${botId} ORDER BY created_at DESC, id DESC LIMIT ${keep}))`;
          yield* sql`DELETE FROM fork_bots_replay_items WHERE replay_id IN (${stale})`;
          yield* sql`DELETE FROM fork_bots_replays WHERE id IN (${stale})`;
        }),
      );
    }),
  };
});

export type BotReplaysStore = Effect.Success<typeof makeBotReplaysStore>;
