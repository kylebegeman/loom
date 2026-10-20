import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  BotDefinitionInput,
  BotInputs,
  BotOrigin,
  BotRunStatus,
  BotVerdict,
  type BotDefinition,
  type BotRun,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** Runs kept per bot; older finished runs are pruned when a run finishes. */
export const RUNS_KEPT_PER_BOT = 500;

interface DefinitionRow {
  readonly id: string;
  readonly version: number;
  readonly definition_json: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

interface RunRow {
  readonly id: string;
  readonly bot_id: string;
  readonly bot_version: number;
  readonly bot_name: string;
  readonly thread_id: string;
  readonly project_id: string | null;
  readonly inputs_json: string;
  readonly status: string;
  readonly started_by: string;
  readonly caller_thread_id: string | null;
  readonly created_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly result: string | null;
  readonly result_truncated: number;
  readonly error: string | null;
  readonly notify: number;
  readonly verdict_json: string | null;
}

/** The definition as stored: what a client may send, plus the server-owned origin. */
const StoredDefinition = Schema.Struct({
  ...BotDefinitionInput.fields,
  origin: Schema.optionalKey(BotOrigin),
});
type StoredDefinition = typeof StoredDefinition.Type;

const definitionJson = Schema.fromJsonString(StoredDefinition);
const inputsJson = Schema.fromJsonString(BotInputs);
const decodeDefinition = Schema.decodeUnknownOption(definitionJson);
const decodeInputs = Schema.decodeUnknownOption(inputsJson);
const encodeDefinition = Schema.encodeSync(definitionJson);
const encodeInputs = Schema.encodeSync(inputsJson);
const verdictJson = Schema.fromJsonString(BotVerdict);
const decodeVerdict = Schema.decodeUnknownOption(verdictJson);
const encodeVerdict = Schema.encodeSync(verdictJson);
const isStatus = Schema.is(BotRunStatus);

// A row written by a future version this one cannot read is skipped, not fatal.
const toDefinition = (row: DefinitionRow): BotDefinition | null => {
  const input = decodeDefinition(row.definition_json);
  if (Option.isNone(input)) return null;
  return {
    ...input.value,
    version: Number(row.version),
    createdBy: row.created_by === "agent" ? "agent" : "user",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
};

const toRun = (row: RunRow): BotRun | null => {
  const inputs = decodeInputs(row.inputs_json);
  const { status } = row;
  if (Option.isNone(inputs) || !isStatus(status)) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    botVersion: Number(row.bot_version),
    botName: row.bot_name,
    threadId: ThreadId.make(row.thread_id),
    projectId: row.project_id === null ? null : ProjectId.make(row.project_id),
    inputs: inputs.value,
    status,
    startedBy: row.started_by === "agent" ? "agent" : "user",
    callerThreadId: row.caller_thread_id === null ? null : ThreadId.make(row.caller_thread_id),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result,
    resultTruncated: Number(row.result_truncated) === 1,
    error: row.error,
    ...(Number(row.notify) === 1 ? { notify: true } : {}),
    // A verdict this version cannot read leaves the run without one; the run itself still stands.
    ...(row.verdict_json === null
      ? {}
      : { verdict: Option.getOrNull(decodeVerdict(row.verdict_json)) }),
  };
};

const definitionFields = ({
  version: _version,
  createdBy: _createdBy,
  createdAt: _createdAt,
  updatedAt: _updatedAt,
  archivedAt: _archivedAt,
  ...input
}: BotDefinition): StoredDefinition => input;

export interface StarterRow {
  readonly starterId: string;
  readonly revision: number;
}

export const makeBotsStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return {
    listDefinitions: Effect.fn("BotsStore.listDefinitions")(function* () {
      const rows =
        yield* sql<DefinitionRow>`SELECT * FROM fork_bots_definitions ORDER BY created_at, id`;
      return rows.flatMap((row) => toDefinition(row) ?? []);
    }),

    getDefinition: Effect.fn("BotsStore.getDefinition")(function* (id: string) {
      const rows = yield* sql<DefinitionRow>`SELECT * FROM fork_bots_definitions WHERE id = ${id}`;
      return rows[0] ? toDefinition(rows[0]) : null;
    }),

    /** Whether a row exists, including one this version cannot read. */
    hasDefinition: Effect.fn("BotsStore.hasDefinition")(function* (id: string) {
      const rows = yield* sql<{
        id: string;
      }>`SELECT id FROM fork_bots_definitions WHERE id = ${id}`;
      return rows.length > 0;
    }),

    putDefinition: Effect.fn("BotsStore.putDefinition")(function* (bot: BotDefinition) {
      yield* sql`INSERT INTO fork_bots_definitions (id,version,definition_json,scope_project_id,created_by,created_at,updated_at,archived_at) VALUES (${bot.id},${bot.version},${encodeDefinition(definitionFields(bot))},${bot.scopeProjectId},${bot.createdBy},${bot.createdAt},${bot.updatedAt},${bot.archivedAt}) ON CONFLICT(id) DO UPDATE SET version = excluded.version, definition_json = excluded.definition_json, scope_project_id = excluded.scope_project_id, updated_at = excluded.updated_at, archived_at = excluded.archived_at`;
    }),

    /** The highest version any run recorded, so a recreated bot never reuses a version. */
    maxRunVersion: Effect.fn("BotsStore.maxRunVersion")(function* (botId: string) {
      const rows = yield* sql<{
        version: number | null;
      }>`SELECT MAX(bot_version) AS version FROM fork_bots_runs WHERE bot_id = ${botId}`;
      return Number(rows[0]?.version ?? 0);
    }),

    listStarterRows: Effect.fn("BotsStore.listStarterRows")(function* () {
      const rows = yield* sql<{
        starter_id: string;
        revision: number;
      }>`SELECT starter_id, revision FROM fork_bots_starters`;
      return rows.map((row): StarterRow => ({
        starterId: row.starter_id,
        revision: Number(row.revision),
      }));
    }),

    recordStarter: Effect.fn("BotsStore.recordStarter")(function* (
      starterId: string,
      revision: number,
      at: string,
    ) {
      yield* sql`INSERT INTO fork_bots_starters (starter_id, revision, seeded_at) VALUES (${starterId}, ${revision}, ${at}) ON CONFLICT(starter_id) DO UPDATE SET revision = excluded.revision`;
    }),

    withTransaction: sql.withTransaction,

    deleteDefinition: Effect.fn("BotsStore.deleteDefinition")(function* (id: string) {
      yield* sql`DELETE FROM fork_bots_definitions WHERE id = ${id}`;
    }),

    insertRun: Effect.fn("BotsStore.insertRun")(function* (run: BotRun) {
      yield* sql`INSERT INTO fork_bots_runs (id,bot_id,bot_version,bot_name,thread_id,project_id,inputs_json,status,started_by,caller_thread_id,created_at,started_at,finished_at,result,result_truncated,error,notify) VALUES (${run.id},${run.botId},${run.botVersion},${run.botName},${run.threadId},${run.projectId},${encodeInputs(run.inputs)},${run.status},${run.startedBy},${run.callerThreadId},${run.createdAt},${run.startedAt},${run.finishedAt},${run.result},${run.resultTruncated ? 1 : 0},${run.error},${run.notify === true ? 1 : 0})`;
    }),

    /** Writes a run's progress; who started it, with what inputs, never changes. */
    saveRun: Effect.fn("BotsStore.saveRun")(function* (run: BotRun) {
      yield* sql`UPDATE fork_bots_runs SET project_id = ${run.projectId}, status = ${run.status}, started_at = ${run.startedAt}, finished_at = ${run.finishedAt}, result = ${run.result}, result_truncated = ${run.resultTruncated ? 1 : 0}, error = ${run.error}, verdict = ${run.verdict?.verdict ?? null}, verdict_json = ${run.verdict == null ? null : encodeVerdict(run.verdict)} WHERE id = ${run.id}`;
    }),

    /** Records that the result was posted, or why it was not, so it is attempted once. */
    markNotified: Effect.fn("BotsStore.markNotified")(function* (
      id: string,
      at: string,
      error: string | null,
    ) {
      yield* sql`UPDATE fork_bots_runs SET notified_at = ${at}, error = ${error} WHERE id = ${id}`;
    }),

    /** Finished runs that asked for their result to be posted and were never delivered. */
    listUndeliveredRuns: Effect.fn("BotsStore.listUndeliveredRuns")(function* () {
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE notify = 1 AND notified_at IS NULL AND finished_at IS NOT NULL ORDER BY created_at`;
      return rows.flatMap((row) => toRun(row) ?? []);
    }),

    getRun: Effect.fn("BotsStore.getRun")(function* (id: string) {
      const rows = yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE id = ${id}`;
      return rows[0] ? toRun(rows[0]) : null;
    }),

    /** Newest first. Fetches one extra row to report whether more exist. */
    listRuns: Effect.fn("BotsStore.listRuns")(function* (input: {
      readonly botId?: string | undefined;
      readonly before?: string | undefined;
      readonly verdict?: string | undefined;
      readonly limit: number;
    }) {
      const conditions = [
        ...(input.botId === undefined ? [] : [sql`bot_id = ${input.botId}`]),
        ...(input.verdict === undefined ? [] : [sql`verdict = ${input.verdict}`]),
        ...(input.before === undefined ? [] : [sql`created_at < ${input.before}`]),
      ];
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_runs ${conditions.length === 0 ? sql`` : sql`WHERE ${sql.and(conditions)}`} ORDER BY created_at DESC, id DESC LIMIT ${input.limit + 1}`;
      return {
        runs: rows.slice(0, input.limit).flatMap((row) => toRun(row) ?? []),
        hasMore: rows.length > input.limit,
      };
    }),

    listUnfinishedRuns: Effect.fn("BotsStore.listUnfinishedRuns")(function* () {
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE status IN ('queued', 'running') ORDER BY created_at`;
      return rows.flatMap((row) => toRun(row) ?? []);
    }),

    /** Deletes finished runs beyond the newest `keep` of a bot. */
    pruneRuns: Effect.fn("BotsStore.pruneRuns")(function* (botId: string, keep: number) {
      yield* sql`DELETE FROM fork_bots_runs WHERE bot_id = ${botId} AND finished_at IS NOT NULL AND id NOT IN (SELECT id FROM fork_bots_runs WHERE bot_id = ${botId} ORDER BY created_at DESC, id DESC LIMIT ${keep})`;
    }),
  };
});

export type BotsStore = Effect.Success<typeof makeBotsStore>;
