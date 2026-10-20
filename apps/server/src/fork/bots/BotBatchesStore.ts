import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  BotBatchSource,
  BotDefinition,
  BotInputs,
  BotRunId,
  type BotBatch,
  type BotBatchCounts,
  type BotBatchItem,
  type BotBatchItemState,
  type BotBatchStatus,
  type BotCreator,
  type BotRun,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { toRun, type RunRow } from "./BotsStore.ts";

/** Batches kept per bot; older finished batches lose their item rows, never their runs. */
export const BATCHES_KEPT_PER_BOT = 50;

interface BatchRow {
  readonly id: string;
  readonly bot_id: string;
  readonly bot_version: number;
  readonly bot_name: string;
  readonly definition_json: string;
  readonly project_id: string | null;
  readonly checkout_thread_id: string | null;
  readonly source_json: string;
  readonly source_summary: string;
  readonly item_parameter: string | null;
  readonly shared_inputs_json: string;
  readonly status: string;
  readonly note: string | null;
  readonly started_by: string;
  readonly caller_thread_id: string | null;
  readonly created_at: string;
  readonly finished_at: string | null;
}

interface ItemRow {
  readonly batch_id: string;
  readonly item_index: number;
  readonly label: string;
  readonly inputs_json: string;
  readonly state: string;
  readonly run_id: string | null;
  readonly previous_run_ids_json: string;
}

/** What the store holds about a batch beyond what clients see. */
export interface StoredBatch {
  readonly batch: Omit<BotBatch, "total" | "counts">;
  /** The definition as it was when the batch started, or after a retry with the latest. */
  readonly definition: BotDefinition;
  readonly source: BotBatchSource;
  readonly checkoutThreadId: ThreadId | null;
}

export interface NewBatchItem {
  readonly label: string;
  readonly inputs: BotInputs;
}

const definitionJson = Schema.fromJsonString(BotDefinition);
const sourceJson = Schema.fromJsonString(BotBatchSource);
const inputsJson = Schema.fromJsonString(BotInputs);
const runIdsJson = Schema.fromJsonString(Schema.Array(BotRunId));
const decodeDefinition = Schema.decodeUnknownOption(definitionJson);
const decodeSource = Schema.decodeUnknownOption(sourceJson);
const decodeInputs = Schema.decodeUnknownOption(inputsJson);
const decodeRunIds = Schema.decodeUnknownOption(runIdsJson);
const encodeDefinition = Schema.encodeSync(definitionJson);
const encodeSource = Schema.encodeSync(sourceJson);
const encodeInputs = Schema.encodeSync(inputsJson);
const encodeRunIds = Schema.encodeSync(runIdsJson);
const isStatus = Schema.is(Schema.Literals(["running", "finished", "cancelled"]));
const isItemState = Schema.is(Schema.Literals(["pending", "started", "skipped"]));

const creator = (value: string): BotCreator => (value === "agent" ? "agent" : "user");

// A row written by a future version this one cannot read is skipped, not fatal.
const toStoredBatch = (row: BatchRow): StoredBatch | null => {
  const definition = decodeDefinition(row.definition_json);
  const source = decodeSource(row.source_json);
  const sharedInputs = decodeInputs(row.shared_inputs_json);
  const { status } = row;
  if (
    Option.isNone(definition) ||
    Option.isNone(source) ||
    Option.isNone(sharedInputs) ||
    !isStatus(status)
  )
    return null;
  return {
    batch: {
      id: row.id,
      botId: row.bot_id,
      botVersion: Number(row.bot_version),
      botName: row.bot_name,
      projectId: row.project_id === null ? null : ProjectId.make(row.project_id),
      sourceType: source.value.type,
      sourceSummary: row.source_summary,
      itemParameter: row.item_parameter,
      sharedInputs: sharedInputs.value,
      status,
      note: row.note,
      startedBy: creator(row.started_by),
      callerThreadId: row.caller_thread_id === null ? null : ThreadId.make(row.caller_thread_id),
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    },
    definition: definition.value,
    source: source.value,
    checkoutThreadId:
      row.checkout_thread_id === null ? null : ThreadId.make(row.checkout_thread_id),
  };
};

const toItem = (row: ItemRow, runs: ReadonlyMap<string, BotRun>): BotBatchItem | null => {
  const inputs = decodeInputs(row.inputs_json);
  const previous = decodeRunIds(row.previous_run_ids_json);
  const { state } = row;
  if (Option.isNone(inputs) || !isItemState(state)) return null;
  return {
    index: Number(row.item_index),
    label: row.label,
    inputs: inputs.value,
    state,
    runId: row.run_id,
    previousRunIds: Option.getOrElse(previous, () => []),
    run: row.run_id === null ? null : (runs.get(row.run_id) ?? null),
  };
};

const EMPTY_COUNTS: BotBatchCounts = {
  pending: 0,
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  timedOut: 0,
  cancelled: 0,
  skipped: 0,
  pass: 0,
  fail: 0,
  needsAttention: 0,
};

/** Counted from items and their current runs, so they never drift from what the items show. */
export const countItems = (items: ReadonlyArray<BotBatchItem>): BotBatchCounts => {
  const counts = { ...EMPTY_COUNTS };
  for (const item of items) {
    if (item.state === "pending") counts.pending += 1;
    else if (item.state === "skipped") counts.skipped += 1;
    else if (item.run === null) counts.failed += 1;
    else {
      const { run } = item;
      if (run.status === "queued") counts.queued += 1;
      else if (run.status === "running") counts.running += 1;
      else if (run.status === "failed") counts.failed += 1;
      else if (run.status === "timed_out") counts.timedOut += 1;
      else if (run.status === "cancelled") counts.cancelled += 1;
      else {
        counts.completed += 1;
        const verdict = run.verdict?.verdict;
        if (verdict === "pass") counts.pass += 1;
        else if (verdict === "fail") counts.fail += 1;
        else if (verdict === "needs_attention") counts.needsAttention += 1;
      }
    }
  }
  return counts;
};

export const makeBotBatchesStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const runsOf = Effect.fnUntraced(function* (batchId: string) {
    const rows = yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE batch_id = ${batchId}`;
    return new Map(rows.flatMap((row) => toRun(row) ?? []).map((run) => [run.id, run]));
  });

  const getItems = Effect.fn("BotBatchesStore.getItems")(function* (batchId: string) {
    const rows =
      yield* sql<ItemRow>`SELECT * FROM fork_bots_batch_items WHERE batch_id = ${batchId} ORDER BY item_index`;
    const runs = yield* runsOf(batchId);
    return rows.flatMap((row) => toItem(row, runs) ?? []);
  });

  const getItem = Effect.fn("BotBatchesStore.getItem")(function* (batchId: string, index: number) {
    const rows =
      yield* sql<ItemRow>`SELECT * FROM fork_bots_batch_items WHERE batch_id = ${batchId} AND item_index = ${index}`;
    const row = rows[0];
    if (row === undefined) return null;
    const runRows =
      row.run_id === null
        ? []
        : yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE id = ${row.run_id}`;
    const runs = new Map(
      runRows.flatMap((runRow) => toRun(runRow) ?? []).map((run) => [run.id, run]),
    );
    return toItem(row, runs);
  });

  const getBatch = Effect.fn("BotBatchesStore.getBatch")(function* (id: string) {
    const rows = yield* sql<BatchRow>`SELECT * FROM fork_bots_batches WHERE id = ${id}`;
    return rows[0] ? toStoredBatch(rows[0]) : null;
  });

  return {
    withTransaction: sql.withTransaction,
    getBatch,
    getItems,
    getItem,

    /** Writes the batch and every item as pending, in one transaction. */
    insertBatch: Effect.fn("BotBatchesStore.insertBatch")(function* (
      stored: StoredBatch,
      items: ReadonlyArray<NewBatchItem>,
    ) {
      const { batch } = stored;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`INSERT INTO fork_bots_batches (id,bot_id,bot_version,bot_name,definition_json,project_id,checkout_thread_id,source_json,source_summary,item_parameter,shared_inputs_json,status,note,started_by,caller_thread_id,created_at,finished_at) VALUES (${batch.id},${batch.botId},${batch.botVersion},${batch.botName},${encodeDefinition(stored.definition)},${batch.projectId},${stored.checkoutThreadId},${encodeSource(stored.source)},${batch.sourceSummary},${batch.itemParameter},${encodeInputs(batch.sharedInputs)},${batch.status},${batch.note},${batch.startedBy},${batch.callerThreadId},${batch.createdAt},${batch.finishedAt})`;
          for (const [index, item] of items.entries())
            yield* sql`INSERT INTO fork_bots_batch_items (batch_id,item_index,label,inputs_json,state,run_id,previous_run_ids_json) VALUES (${batch.id},${index},${item.label},${encodeInputs(item.inputs)},'pending',NULL,'[]')`;
        }),
      );
    }),

    setStatus: Effect.fn("BotBatchesStore.setStatus")(function* (
      id: string,
      status: BotBatchStatus,
      finishedAt: string | null,
      note: string | null,
    ) {
      yield* sql`UPDATE fork_bots_batches SET status = ${status}, finished_at = ${finishedAt}, note = ${note} WHERE id = ${id}`;
    }),

    /** A retry with the latest bot reruns that version from then on. */
    setDefinition: Effect.fn("BotBatchesStore.setDefinition")(function* (
      id: string,
      definition: BotDefinition,
    ) {
      yield* sql`UPDATE fork_bots_batches SET definition_json = ${encodeDefinition(definition)}, bot_version = ${definition.version}, bot_name = ${definition.name} WHERE id = ${id}`;
    }),

    setItemState: Effect.fn("BotBatchesStore.setItemState")(function* (
      batchId: string,
      index: number,
      state: BotBatchItemState,
      runId: string | null,
    ) {
      yield* sql`UPDATE fork_bots_batch_items SET state = ${state}, run_id = ${runId} WHERE batch_id = ${batchId} AND item_index = ${index}`;
    }),

    /** Sends an item back to wait, keeping its earlier runs. */
    requeueItem: Effect.fn("BotBatchesStore.requeueItem")(function* (
      batchId: string,
      index: number,
      previousRunIds: ReadonlyArray<string>,
    ) {
      yield* sql`UPDATE fork_bots_batch_items SET state = 'pending', run_id = NULL, previous_run_ids_json = ${encodeRunIds(previousRunIds)} WHERE batch_id = ${batchId} AND item_index = ${index}`;
    }),

    skipPending: Effect.fn("BotBatchesStore.skipPending")(function* (batchId: string) {
      yield* sql`UPDATE fork_bots_batch_items SET state = 'skipped' WHERE batch_id = ${batchId} AND state = 'pending'`;
    }),

    /** Newest first. Fetches one extra row to report whether more exist. */
    listBatches: Effect.fn("BotBatchesStore.listBatches")(function* (input: {
      readonly botId?: string | undefined;
      readonly before?: string | undefined;
      readonly limit: number;
    }) {
      const conditions = [
        ...(input.botId === undefined ? [] : [sql`bot_id = ${input.botId}`]),
        ...(input.before === undefined ? [] : [sql`created_at < ${input.before}`]),
      ];
      const rows =
        yield* sql<BatchRow>`SELECT * FROM fork_bots_batches ${conditions.length === 0 ? sql`` : sql`WHERE ${sql.and(conditions)}`} ORDER BY created_at DESC, id DESC LIMIT ${input.limit + 1}`;
      return {
        batches: rows.slice(0, input.limit).flatMap((row) => toStoredBatch(row) ?? []),
        hasMore: rows.length > input.limit,
      };
    }),

    listRunningBatches: Effect.fn("BotBatchesStore.listRunningBatches")(function* () {
      const rows =
        yield* sql<BatchRow>`SELECT * FROM fork_bots_batches WHERE status = 'running' ORDER BY created_at`;
      return rows.flatMap((row) => toStoredBatch(row) ?? []);
    }),

    /** The batch and item an item's run belongs to, for runs started by a batch. */
    itemIndexForRun: Effect.fn("BotBatchesStore.itemIndexForRun")(function* (
      batchId: string,
      runId: string,
    ) {
      const rows = yield* sql<{
        item_index: number;
      }>`SELECT item_index FROM fork_bots_batch_items WHERE batch_id = ${batchId} AND run_id = ${runId}`;
      return rows[0] === undefined ? null : Number(rows[0].item_index);
    }),

    /** Deletes finished batches beyond the newest `keep` of a bot, with their items. */
    pruneBatches: Effect.fn("BotBatchesStore.pruneBatches")(function* (
      botId: string,
      keep: number,
    ) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const stale = sql`SELECT id FROM fork_bots_batches WHERE bot_id = ${botId} AND status != 'running' AND id NOT IN (SELECT id FROM fork_bots_batches WHERE bot_id = ${botId} ORDER BY created_at DESC, id DESC LIMIT ${keep})`;
          yield* sql`DELETE FROM fork_bots_batch_items WHERE batch_id IN (${stale})`;
          yield* sql`DELETE FROM fork_bots_batches WHERE id IN (${stale})`;
        }),
      );
    }),
  };
});

export type BotBatchesStore = Effect.Success<typeof makeBotBatchesStore>;
