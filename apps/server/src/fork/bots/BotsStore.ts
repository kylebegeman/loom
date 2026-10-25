import {
  ModelSelection,
  OrchestrationV2ProviderFailureClass,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  BotDefinitionInput,
  BotLibraryLink,
  BotRemoteSettings,
  BotRunComputer,
  DEFAULT_BOT_REMOTE_SETTINGS,
  BotInputs,
  BotOrigin,
  BotRunRating,
  BotRunStatus,
  BotRunUsage,
  BotVerdict,
  BotVersionSavedBy,
  type BotDefinition,
  type BotRun,
  type BotVersion,
  type BotVersionSummary,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { BUDGET_WINDOW_MS, isoAt } from "./BotBudgets.ts";

/**
 * Runs kept per bot; older finished runs are pruned when a run finishes, except started runs the
 * budget window still counts.
 */
export const RUNS_KEPT_PER_BOT = 500;
/** Versions kept per bot, besides the current, stable, pinned and run-referenced ones. */
export const VERSIONS_KEPT_PER_BOT = 200;

interface DefinitionRow {
  readonly id: string;
  readonly version: number;
  readonly definition_json: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
  readonly stable_version: number | null;
  readonly library_json?: string | null;
}

interface VersionRow {
  readonly bot_id: string;
  readonly version: number;
  readonly definition_json: string;
  readonly saved_by: string;
  readonly saved_at: string;
  readonly changed_json: string;
  readonly restored_from: number | null;
}

export interface RunRow {
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
  readonly batch_id: string | null;
  readonly dismissed_at: string | null;
  readonly retry_of: string | null;
  readonly retried_by: string | null;
  readonly promoted_thread_id: string | null;
  readonly model_selection_json: string | null;
  readonly checkout_thread_id: string | null;
  readonly input_tokens: number | null;
  readonly cached_input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly usage_status: string | null;
  readonly trigger_id: string | null;
  readonly replay_id: string | null;
  readonly rating: string | null;
  readonly note: string | null;
  readonly pipeline_run_id?: string | null;
  readonly pipeline_stopped?: number;
  readonly target_environment_id?: string | null;
  readonly remote_request_id?: string | null;
  readonly ran_on_json?: string | null;
  readonly requested_by_json?: string | null;
  readonly delivered_at?: string | null;
  readonly failure_class?: string | null;
}

/** The definition as stored: what a client may send, plus the server-owned origin. */
const StoredDefinition = Schema.Struct({
  ...BotDefinitionInput.fields,
  origin: Schema.optionalKey(BotOrigin),
});
type StoredDefinition = typeof StoredDefinition.Type;

const definitionJson = Schema.fromJsonString(StoredDefinition);
const versionDefinitionJson = Schema.fromJsonString(
  Schema.Struct({
    ...StoredDefinition.fields,
    library: Schema.optionalKey(BotLibraryLink),
  }),
);
const decodeVersionDefinition = Schema.decodeUnknownOption(versionDefinitionJson);
const encodeVersionDefinition = Schema.encodeSync(versionDefinitionJson);
const inputsJson = Schema.fromJsonString(BotInputs);
const decodeDefinition = Schema.decodeUnknownOption(definitionJson);
const decodeInputs = Schema.decodeUnknownOption(inputsJson);
const encodeDefinition = Schema.encodeSync(definitionJson);
const encodeInputs = Schema.encodeSync(inputsJson);
const verdictJson = Schema.fromJsonString(BotVerdict);
const decodeVerdict = Schema.decodeUnknownOption(verdictJson);
const encodeVerdict = Schema.encodeSync(verdictJson);
const modelSelectionJson = Schema.fromJsonString(ModelSelection);
const decodeModelSelection = Schema.decodeUnknownOption(modelSelectionJson);
const encodeModelSelection = Schema.encodeSync(modelSelectionJson);
const changedJson = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeChanged = Schema.decodeUnknownOption(changedJson);
const encodeChanged = Schema.encodeSync(changedJson);
const libraryJson = Schema.fromJsonString(BotLibraryLink);
const decodeLibrary = Schema.decodeUnknownOption(libraryJson);
const encodeLibrary = Schema.encodeSync(libraryJson);
const computerJson = Schema.fromJsonString(BotRunComputer);
const decodeComputer = (json: string | null | undefined) =>
  json == null ? null : Option.getOrNull(Schema.decodeUnknownOption(computerJson)(json));
const encodeComputer = (computer: BotRunComputer | null | undefined) =>
  computer == null ? null : Schema.encodeSync(computerJson)(computer);
const remoteSettingsJson = Schema.fromJsonString(BotRemoteSettings);
const decodeRemoteSettings = Schema.decodeUnknownOption(remoteSettingsJson);
const encodeRemoteSettings = Schema.encodeSync(remoteSettingsJson);
const isSavedBy = Schema.is(BotVersionSavedBy);
const isRating = Schema.is(BotRunRating);
const isStatus = Schema.is(BotRunStatus);
const isUsageStatus = Schema.is(BotRunUsage.fields.status);
const isFailureClass = Schema.is(OrchestrationV2ProviderFailureClass);

const toUsage = (row: RunRow): BotRunUsage | null =>
  isUsageStatus(row.usage_status)
    ? {
        inputTokens: Number(row.input_tokens ?? 0),
        cachedInputTokens: Number(row.cached_input_tokens ?? 0),
        outputTokens: Number(row.output_tokens ?? 0),
        status: row.usage_status,
      }
    : null;

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
    ...(row.stable_version == null ? {} : { stableVersion: Number(row.stable_version) }),
    // A link this version cannot read leaves the bot local rather than hiding it.
    ...Option.match(row.library_json == null ? Option.none() : decodeLibrary(row.library_json), {
      onNone: () => ({}),
      onSome: (library) => ({ library }),
    }),
  };
};

const versionFields = (row: VersionRow) => ({
  botId: row.bot_id,
  version: Number(row.version),
  savedBy: isSavedBy(row.saved_by) ? row.saved_by : ("user" as const),
  savedAt: row.saved_at,
  changed: Option.getOrElse(decodeChanged(row.changed_json), () => []),
  restoredFrom: row.restored_from === null ? null : Number(row.restored_from),
});

const toVersion = (row: VersionRow): BotVersion | null => {
  const decoded = decodeVersionDefinition(row.definition_json);
  if (Option.isNone(decoded)) return null;
  // The origin belongs to the bot; a version keeps its own shared revision.
  const { origin: _origin, library, ...definition } = decoded.value;
  return { ...versionFields(row), definition, ...(library === undefined ? {} : { library }) };
};

const median = (values: ReadonlyArray<number>) => {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};

export const toRun = (row: RunRow): BotRun | null => {
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
    ...(isFailureClass(row.failure_class) ? { failureClass: row.failure_class } : {}),
    ...(Number(row.notify) === 1 ? { notify: true } : {}),
    ...(row.delivered_at == null ? {} : { deliveredAt: row.delivered_at }),
    // A verdict this version cannot read leaves the run without one; the run itself still stands.
    ...(row.verdict_json === null
      ? {}
      : { verdict: Option.getOrNull(decodeVerdict(row.verdict_json)) }),
    ...(row.batch_id == null ? {} : { batchId: row.batch_id }),
    ...(row.dismissed_at == null ? {} : { dismissedAt: row.dismissed_at }),
    ...(row.retry_of == null ? {} : { retryOf: row.retry_of }),
    ...(row.retried_by == null ? {} : { retriedBy: row.retried_by }),
    ...(row.promoted_thread_id == null
      ? {}
      : { promotedThreadId: ThreadId.make(row.promoted_thread_id) }),
    ...Option.match(
      row.model_selection_json == null
        ? Option.none()
        : decodeModelSelection(row.model_selection_json),
      { onNone: () => ({}), onSome: (modelSelection) => ({ modelSelection }) },
    ),
    ...(row.checkout_thread_id == null
      ? {}
      : { checkoutThreadId: ThreadId.make(row.checkout_thread_id) }),
    ...(row.usage_status == null ? {} : { usage: toUsage(row) }),
    ...(row.trigger_id == null ? {} : { triggerId: row.trigger_id }),
    ...(row.replay_id == null ? {} : { replayId: row.replay_id }),
    ...(isRating(row.rating) ? { rating: row.rating } : {}),
    ...(row.note == null ? {} : { note: row.note }),
    ...(row.pipeline_run_id == null ? {} : { pipelineRunId: row.pipeline_run_id }),
    ...(Number(row.pipeline_stopped ?? 0) === 1 ? { pipelineStopped: true } : {}),
    ...withComputer("ranOn", decodeComputer(row.ran_on_json)),
    ...withComputer("requestedBy", decodeComputer(row.requested_by_json)),
  };
};

const withComputer = <K extends "ranOn" | "requestedBy">(key: K, computer: BotRunComputer | null) =>
  (computer === null ? {} : { [key]: computer }) as Partial<Record<K, BotRunComputer>>;

/** `isBotInboxRun` in SQL, so the inbox never loads runs it would drop. */
const inboxCondition = (sql: SqlClient.SqlClient, dismissed: boolean) =>
  sql.and([
    sql`retried_by IS NULL`,
    sql`replay_id IS NULL`,
    sql`requested_by_json IS NULL`,
    dismissed ? sql`dismissed_at IS NOT NULL` : sql`dismissed_at IS NULL`,
    sql`((pipeline_run_id IS NULL AND (status IN ('failed', 'timed_out') OR (status = 'completed' AND verdict = 'needs_attention'))) OR (pipeline_run_id IS NOT NULL AND pipeline_stopped = 1))`,
  ]);

/** `isBotRunHandledByCaller` in SQL. */
const handledCondition = (sql: SqlClient.SqlClient) =>
  sql`started_by = 'agent' AND notify = 1 AND caller_thread_id IS NOT NULL AND delivered_at IS NOT NULL`;

const definitionFields = ({
  version: _version,
  createdBy: _createdBy,
  createdAt: _createdAt,
  updatedAt: _updatedAt,
  archivedAt: _archivedAt,
  stableVersion: _stableVersion,
  library: _library,
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
      yield* sql`INSERT INTO fork_bots_definitions (id,version,definition_json,scope_project_id,created_by,created_at,updated_at,archived_at,library_json) VALUES (${bot.id},${bot.version},${encodeDefinition(definitionFields(bot))},${bot.scopeProjectId},${bot.createdBy},${bot.createdAt},${bot.updatedAt},${bot.archivedAt},${bot.library == null ? null : encodeLibrary(bot.library)}) ON CONFLICT(id) DO UPDATE SET version = excluded.version, definition_json = excluded.definition_json, scope_project_id = excluded.scope_project_id, updated_at = excluded.updated_at, archived_at = excluded.archived_at, library_json = excluded.library_json`;
    }),

    setLibraryLink: Effect.fn("BotsStore.setLibraryLink")(function* (
      id: string,
      link: BotLibraryLink | null,
    ) {
      yield* sql`UPDATE fork_bots_definitions SET library_json = ${link === null ? null : encodeLibrary(link)} WHERE id = ${id}`;
    }),

    stampVersionLibrary: Effect.fn("BotsStore.stampVersionLibrary")(function* (
      bot: BotDefinition,
      library: BotLibraryLink,
    ) {
      const rows =
        yield* sql<VersionRow>`SELECT * FROM fork_bots_versions WHERE bot_id = ${bot.id} AND version = ${bot.version}`;
      const row = rows[0];
      if (row === undefined) return;
      const definition = decodeVersionDefinition(row.definition_json);
      if (Option.isNone(definition)) return;
      yield* sql`UPDATE fork_bots_versions SET definition_json = ${encodeVersionDefinition({ ...definition.value, library })} WHERE bot_id = ${bot.id} AND version = ${bot.version}`;
    }),

    /** The highest version any run recorded, so a recreated bot never reuses a version. */
    maxRunVersion: Effect.fn("BotsStore.maxRunVersion")(function* (botId: string) {
      const rows = yield* sql<{
        version: number | null;
      }>`SELECT MAX(bot_version) AS version FROM fork_bots_runs WHERE bot_id = ${botId}`;
      return Number(rows[0]?.version ?? 0);
    }),

    /** The highest version stored, including versions of a deleted bot. */
    maxVersion: Effect.fn("BotsStore.maxVersion")(function* (botId: string) {
      const rows = yield* sql<{
        version: number | null;
      }>`SELECT MAX(version) AS version FROM fork_bots_versions WHERE bot_id = ${botId}`;
      return Number(rows[0]?.version ?? 0);
    }),

    insertVersion: Effect.fn("BotsStore.insertVersion")(function* (
      bot: BotDefinition,
      saved: Pick<BotVersion, "savedBy" | "savedAt" | "changed" | "restoredFrom">,
    ) {
      yield* sql`INSERT INTO fork_bots_versions (bot_id, version, definition_json, saved_by, saved_at, changed_json, restored_from) VALUES (${bot.id}, ${bot.version}, ${encodeVersionDefinition({ ...definitionFields(bot), ...(bot.library == null ? {} : { library: bot.library }) })}, ${saved.savedBy}, ${saved.savedAt}, ${encodeChanged(saved.changed)}, ${saved.restoredFrom})`;
    }),

    getVersion: Effect.fn("BotsStore.getVersion")(function* (botId: string, version: number) {
      const rows =
        yield* sql<VersionRow>`SELECT * FROM fork_bots_versions WHERE bot_id = ${botId} AND version = ${version}`;
      return rows[0] ? toVersion(rows[0]) : null;
    }),

    /** Newest first, with how each version's kept runs did. Fetches one extra row for more. */
    listVersions: Effect.fn("BotsStore.listVersions")(function* (
      botId: string,
      before: number | undefined,
      limit: number,
    ) {
      const rows =
        yield* sql<VersionRow>`SELECT bot_id, version, '' AS definition_json, saved_by, saved_at, changed_json, restored_from FROM fork_bots_versions WHERE bot_id = ${botId} ${before === undefined ? sql`` : sql`AND version < ${before}`} ORDER BY version DESC LIMIT ${limit + 1}`;
      const page = rows.slice(0, limit);
      const versions = page.map((row) => Number(row.version));
      // An `unavailable` run stores zero tokens it never measured, so only reported usage counts.
      const runs =
        versions.length === 0
          ? []
          : yield* sql<{
              bot_version: number;
              verdict: string | null;
              tokens: number | null;
            }>`SELECT bot_version, verdict, CASE WHEN usage_status IS NULL OR usage_status = 'unavailable' THEN NULL ELSE COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) END AS tokens FROM fork_bots_runs WHERE bot_id = ${botId} AND bot_version IN ${sql.in(versions)} AND finished_at IS NOT NULL`;
      const summaries = page.map((row): BotVersionSummary => {
        const own = runs.filter((run) => Number(run.bot_version) === Number(row.version));
        const judged = own.filter((run) => run.verdict !== null);
        return {
          ...versionFields(row),
          runs: own.length,
          passRate:
            judged.length === 0
              ? null
              : judged.filter((run) => run.verdict === "pass").length / judged.length,
          medianTotalTokens: median(
            own.flatMap((run) => (run.tokens === null ? [] : [Number(run.tokens)])),
          ),
        };
      });
      return { versions: summaries, hasMore: rows.length > limit };
    }),

    setStable: Effect.fn("BotsStore.setStable")(function* (botId: string, version: number | null) {
      yield* sql`UPDATE fork_bots_definitions SET stable_version = ${version} WHERE id = ${botId}`;
    }),

    /**
     * Deletes the oldest versions beyond the newest `keep`, except the current and stable ones
     * and any a trigger pins or a kept run used.
     */
    pruneVersions: Effect.fn("BotsStore.pruneVersions")(function* (botId: string, keep: number) {
      yield* sql`DELETE FROM fork_bots_versions WHERE bot_id = ${botId} AND version NOT IN (SELECT version FROM fork_bots_versions WHERE bot_id = ${botId} ORDER BY version DESC LIMIT ${keep}) AND version NOT IN (SELECT version FROM fork_bots_definitions WHERE id = ${botId}) AND version NOT IN (SELECT stable_version FROM fork_bots_definitions WHERE id = ${botId} AND stable_version IS NOT NULL) AND version NOT IN (SELECT pinned_version FROM fork_bots_triggers WHERE bot_id = ${botId}) AND version NOT IN (SELECT bot_version FROM fork_bots_runs WHERE bot_id = ${botId})`;
    }),

    rateRun: Effect.fn("BotsStore.rateRun")(function* (
      id: string,
      rating: string | null,
      note: string | null,
      at: string | null,
    ) {
      yield* sql`UPDATE fork_bots_runs SET rating = ${rating}, note = ${note}, rated_at = ${at} WHERE id = ${id}`;
    }),

    /** Finished runs of a bot, newest first, rated `rating`. */
    listRatedRuns: Effect.fn("BotsStore.listRatedRuns")(function* (
      botId: string,
      rating: string,
      limit: number,
    ) {
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE bot_id = ${botId} AND rating = ${rating} ORDER BY rated_at DESC, id DESC LIMIT ${limit}`;
      return rows.flatMap((row) => toRun(row) ?? []);
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

    /** Bindings go with the bot, so a later bot reusing its id never inherits its Vault items. */
    deleteDefinition: Effect.fn("BotsStore.deleteDefinition")(function* (id: string) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM fork_bots_vault_bindings WHERE bot_id = ${id}`;
          yield* sql`DELETE FROM fork_bots_definitions WHERE id = ${id}`;
        }),
      );
    }),

    insertRun: Effect.fn("BotsStore.insertRun")(function* (
      run: BotRun,
      remote: { readonly requestId?: string | undefined } = {},
    ) {
      yield* sql`INSERT INTO fork_bots_runs (id,bot_id,bot_version,bot_name,thread_id,project_id,inputs_json,status,started_by,caller_thread_id,created_at,started_at,finished_at,result,result_truncated,error,notify,batch_id,retry_of,model_selection_json,checkout_thread_id,trigger_id,replay_id,pipeline_run_id,target_environment_id,remote_request_id,ran_on_json,requested_by_json) VALUES (${run.id},${run.botId},${run.botVersion},${run.botName},${run.threadId},${run.projectId},${encodeInputs(run.inputs)},${run.status},${run.startedBy},${run.callerThreadId},${run.createdAt},${run.startedAt},${run.finishedAt},${run.result},${run.resultTruncated ? 1 : 0},${run.error},${run.notify === true ? 1 : 0},${run.batchId ?? null},${run.retryOf ?? null},${run.modelSelection === undefined ? null : encodeModelSelection(run.modelSelection)},${run.checkoutThreadId ?? null},${run.triggerId ?? null},${run.replayId ?? null},${run.pipelineRunId ?? null},${run.ranOn?.environmentId ?? null},${remote.requestId ?? null},${encodeComputer(run.ranOn)},${encodeComputer(run.requestedBy)})`;
    }),

    /** Writes a run's progress; who started it, with what inputs, never changes. */
    saveRun: Effect.fn("BotsStore.saveRun")(function* (run: BotRun) {
      yield* sql`UPDATE fork_bots_runs SET project_id = ${run.projectId}, status = ${run.status}, started_at = ${run.startedAt}, finished_at = ${run.finishedAt}, result = ${run.result}, result_truncated = ${run.resultTruncated ? 1 : 0}, error = ${run.error}, failure_class = ${run.failureClass ?? null}, verdict = ${run.verdict?.verdict ?? null}, verdict_json = ${run.verdict == null ? null : encodeVerdict(run.verdict)}, input_tokens = ${run.usage?.inputTokens ?? null}, cached_input_tokens = ${run.usage?.cachedInputTokens ?? null}, output_tokens = ${run.usage?.outputTokens ?? null}, usage_status = ${run.usage?.status ?? null} WHERE id = ${run.id}`;
    }),

    /** Records that the result was posted, or why it was not, so it is attempted once. */
    markNotified: Effect.fn("BotsStore.markNotified")(function* (
      id: string,
      at: string,
      error: string | null,
      delivered: boolean,
    ) {
      yield* sql`UPDATE fork_bots_runs SET notified_at = ${at}, delivered_at = ${delivered ? at : null}, error = ${error} WHERE id = ${id}`;
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

    /** Newest first, with the count of every match. Fetches one extra row to report more. */
    inbox: Effect.fn("BotsStore.inbox")(function* (input: {
      readonly dismissed: boolean;
      readonly before?: string | undefined;
      readonly limit: number;
    }) {
      const matches = inboxCondition(sql, input.dismissed);
      const page =
        input.before === undefined
          ? matches
          : sql.and([matches, sql`created_at < ${input.before}`]);
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE ${page} ORDER BY created_at DESC, id DESC LIMIT ${input.limit + 1}`;
      const counted = yield* sql<{
        total: number;
        handled: number | null;
      }>`SELECT COUNT(*) AS total, SUM(CASE WHEN ${handledCondition(sql)} THEN 1 ELSE 0 END) AS handled FROM fork_bots_runs WHERE ${matches}`;
      return {
        runs: rows.slice(0, input.limit).flatMap((row) => toRun(row) ?? []),
        total: Number(counted[0]?.total ?? 0),
        handled: Number(counted[0]?.handled ?? 0),
        hasMore: rows.length > input.limit,
      };
    }),

    setDismissed: Effect.fn("BotsStore.setDismissed")(function* (
      ids: ReadonlyArray<string>,
      at: string | null,
    ) {
      yield* sql`UPDATE fork_bots_runs SET dismissed_at = ${at} WHERE id IN ${sql.in(ids)}`;
    }),

    setRetriedBy: Effect.fn("BotsStore.setRetriedBy")(function* (id: string, retriedBy: string) {
      yield* sql`UPDATE fork_bots_runs SET retried_by = ${retriedBy} WHERE id = ${id}`;
    }),

    setPromotedThread: Effect.fn("BotsStore.setPromotedThread")(function* (
      id: string,
      threadId: string,
    ) {
      yield* sql`UPDATE fork_bots_runs SET promoted_thread_id = ${threadId} WHERE id = ${id}`;
    }),

    /**
     * Points a batch item at the run that retried its run, keeping the old one among its earlier
     * attempts, so the batch view and report follow the retry.
     */
    replaceBatchItemRun: Effect.fn("BotsStore.replaceBatchItemRun")(function* (
      batchId: string,
      oldRunId: string,
      newRunId: string,
    ) {
      yield* sql`UPDATE fork_bots_batch_items SET run_id = ${newRunId}, previous_run_ids_json = json_insert(previous_run_ids_json, '$[#]', ${oldRunId}) WHERE batch_id = ${batchId} AND run_id = ${oldRunId}`;
    }),

    /** Whether the batch is running again with no item on `runId`: it reruns that run's item. */
    batchRerunsWithout: Effect.fn("BotsStore.batchRerunsWithout")(function* (
      batchId: string,
      runId: string,
    ) {
      const rows = yield* sql<{
        readonly found: number;
      }>`SELECT 1 AS found FROM fork_bots_batches WHERE id = ${batchId} AND status = 'running' AND NOT EXISTS (SELECT 1 FROM fork_bots_batch_items WHERE batch_id = ${batchId} AND run_id = ${runId}) LIMIT 1`;
      return rows.length > 0;
    }),

    /**
     * What counts against a bot's budget since `since`, oldest first: runs that started or wait to
     * start (refused and never-launched runs do not), and the tokens of runs that finished.
     */
    budgetWindow: Effect.fn("BotsStore.budgetWindow")(function* (botId: string, since: string) {
      const runs = yield* sql<{
        created_at: string;
      }>`SELECT created_at FROM fork_bots_runs WHERE bot_id = ${botId} AND created_at > ${since} AND (started_at IS NOT NULL OR status IN ('queued', 'running')) ORDER BY created_at, id`;
      const finished = yield* sql<{
        finished_at: string;
        tokens: number;
      }>`SELECT finished_at, COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) AS tokens FROM fork_bots_runs WHERE bot_id = ${botId} AND finished_at > ${since} ORDER BY finished_at, id`;
      return {
        runs: runs.map((row) => row.created_at),
        finished: finished.map((row) => ({
          finishedAt: row.finished_at,
          tokens: Number(row.tokens),
        })),
      };
    }),

    /** Runs created in `[since, until)`, of one bot or all. */
    listRunsCreatedBetween: Effect.fn("BotsStore.listRunsCreatedBetween")(function* (input: {
      readonly since: string;
      readonly until: string;
      readonly botId?: string | undefined;
    }) {
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE created_at >= ${input.since} AND created_at < ${input.until} ${input.botId === undefined ? sql`` : sql`AND bot_id = ${input.botId}`} ORDER BY created_at`;
      return rows.flatMap((row) => toRun(row) ?? []);
    }),

    /** Pipeline runs started in the window, for usage. */
    listPipelineRunsCreatedBetween: Effect.fn("BotsStore.listPipelineRunsCreatedBetween")(
      function* (input: { readonly since: string; readonly until: string }) {
        return yield* sql<{
          readonly id: string;
          readonly pipeline_id: string;
          readonly pipeline_name: string;
          readonly status: string;
        }>`SELECT id, pipeline_id, pipeline_name, status FROM fork_bots_pipeline_runs WHERE created_at >= ${input.since} AND created_at < ${input.until} ORDER BY created_at`;
      },
    ),

    listUnfinishedRuns: Effect.fn("BotsStore.listUnfinishedRuns")(function* () {
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE status IN ('queued', 'running') AND target_environment_id IS NULL ORDER BY created_at`;
      return rows.flatMap((row) => toRun(row) ?? []);
    }),

    /** Runs sent to another computer that have not ended, oldest first. */
    listOpenRemoteRuns: Effect.fn("BotsStore.listOpenRemoteRuns")(function* () {
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE status IN ('queued', 'running') AND target_environment_id IS NOT NULL ORDER BY created_at`;
      return rows.flatMap((row) => toRun(row) ?? []);
    }),

    /** The run this computer started for a remote request, if it already has one. */
    getRunForRequest: Effect.fn("BotsStore.getRunForRequest")(function* (requestId: string) {
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_runs WHERE remote_request_id = ${requestId}`;
      return rows[0] ? toRun(rows[0]) : null;
    }),

    /** Remote-requested runs whose latest update the requester has not been sent yet. */
    listUnreportedRemoteRuns: Effect.fn("BotsStore.listUnreportedRemoteRuns")(function* () {
      const rows = yield* sql<
        RunRow & { remote_reported: number }
      >`SELECT * FROM fork_bots_runs WHERE remote_request_id IS NOT NULL AND requested_by_json IS NOT NULL AND ((started_at IS NOT NULL AND remote_reported < 1) OR (finished_at IS NOT NULL AND remote_reported < 2)) ORDER BY created_at`;
      return rows.flatMap((row) => {
        const run = toRun(row);
        return run === null ? [] : [{ run, reported: Number(row.remote_reported) }];
      });
    }),

    markRemoteReported: Effect.fn("BotsStore.markRemoteReported")(function* (
      id: string,
      seq: number,
    ) {
      yield* sql`UPDATE fork_bots_runs SET remote_reported = MAX(remote_reported, ${seq}) WHERE id = ${id}`;
    }),

    /** Records the model another computer ran a remote run on, as it reported back. */
    applyRemoteModel: Effect.fn("BotsStore.applyRemoteModel")(function* (
      id: string,
      modelSelection: ModelSelection,
    ) {
      yield* sql`UPDATE fork_bots_runs SET model_selection_json = ${encodeModelSelection(modelSelection)} WHERE id = ${id}`;
    }),

    vaultBindings: Effect.fn("BotsStore.vaultBindings")(function* (botId: string) {
      const rows = yield* sql<{
        slot: string;
        item_id: string;
      }>`SELECT slot, item_id FROM fork_bots_vault_bindings WHERE bot_id = ${botId}`;
      return new Map(rows.map((row) => [row.slot, row.item_id]));
    }),

    bindVaultSlot: Effect.fn("BotsStore.bindVaultSlot")(function* (
      botId: string,
      slot: string,
      itemId: string | null,
    ) {
      if (itemId === null)
        yield* sql`DELETE FROM fork_bots_vault_bindings WHERE bot_id = ${botId} AND slot = ${slot}`;
      else
        // A bot deleted since the caller checked it gets no binding to outlive it.
        yield* sql`INSERT INTO fork_bots_vault_bindings (bot_id, slot, item_id) SELECT ${botId}, ${slot}, ${itemId} WHERE EXISTS (SELECT 1 FROM fork_bots_definitions WHERE id = ${botId}) ON CONFLICT(bot_id, slot) DO UPDATE SET item_id = excluded.item_id`;
    }),

    remoteSettings: Effect.fn("BotsStore.remoteSettings")(function* () {
      const rows = yield* sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_bots_settings WHERE key = 'remote'`;
      return rows[0] === undefined
        ? DEFAULT_BOT_REMOTE_SETTINGS
        : Option.getOrElse(
            decodeRemoteSettings(rows[0].value_json),
            () => DEFAULT_BOT_REMOTE_SETTINGS,
          );
    }),

    setRemoteSettings: Effect.fn("BotsStore.setRemoteSettings")(function* (
      settings: BotRemoteSettings,
    ) {
      yield* sql`INSERT INTO fork_bots_settings (key, value_json) VALUES ('remote', ${encodeRemoteSettings(settings)}) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`;
    }),

    libraryCursor: Effect.fn("BotsStore.libraryCursor")(function* () {
      const rows = yield* sql<{
        value: string;
      }>`SELECT value FROM fork_bots_library_cursor WHERE key = 'bots'`;
      return Number(rows[0]?.value ?? 0);
    }),

    setLibraryCursor: Effect.fn("BotsStore.setLibraryCursor")(function* (cursor: number) {
      yield* sql`INSERT INTO fork_bots_library_cursor (key, value) VALUES ('bots', ${String(cursor)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
    }),

    /** Marks the run that stopped its pipeline, or clears the mark when the pipeline resumes. */
    setPipelineStopped: Effect.fn("BotsStore.setPipelineStopped")(function* (
      id: string,
      stopped: boolean,
    ) {
      yield* sql`UPDATE fork_bots_runs SET pipeline_stopped = ${stopped ? 1 : 0} WHERE id = ${id}`;
    }),

    /**
     * Deletes finished runs beyond the newest `keep` of a bot, except those of a running batch or
     * an active pipeline run, and, for a bot with a budget, started runs that finished inside the
     * budget window. Runs that never started count toward no budget, so they always go first.
     */
    pruneRuns: Effect.fn("BotsStore.pruneRuns")(function* (
      botId: string,
      keep: number,
      budgeted: boolean,
    ) {
      const windowStart = budgeted
        ? isoAt(DateTime.toEpochMillis(yield* DateTime.now) - BUDGET_WINDOW_MS)
        : null;
      yield* sql`DELETE FROM fork_bots_runs WHERE bot_id = ${botId} AND finished_at IS NOT NULL AND (started_at IS NULL OR ${windowStart} IS NULL OR finished_at <= ${windowStart}) AND (batch_id IS NULL OR batch_id NOT IN (SELECT id FROM fork_bots_batches WHERE status = 'running')) AND (pipeline_run_id IS NULL OR pipeline_run_id NOT IN (SELECT id FROM fork_bots_pipeline_runs WHERE status IN ('running', 'waiting'))) AND id NOT IN (SELECT id FROM fork_bots_runs WHERE bot_id = ${botId} ORDER BY created_at DESC, id DESC LIMIT ${keep})`;
    }),
  };
});

export type BotsStore = Effect.Success<typeof makeBotsStore>;
