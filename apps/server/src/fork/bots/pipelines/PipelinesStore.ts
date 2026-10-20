import { ProjectId, RuntimeMode, ThreadId } from "@t3tools/contracts";
import {
  BotDefinition,
  BotFinding,
  BotInputs,
  BotPipeline,
  BotPipelineAttemptState,
  BotPipelineInput,
  BotPipelineRunStatus,
  BotRunStatus,
  BotVerdictValue,
  type BotCreator,
  type BotPipelineAttempt,
  type BotPipelineRun,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import type { StepOutput } from "./templates.ts";

/** Runs kept per pipeline; older finished runs lose their attempts too, never their bot runs. */
export const PIPELINE_RUNS_KEPT = 100;

interface PipelineRow {
  readonly id: string;
  readonly version: number;
  readonly definition_json: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface RunRow {
  readonly id: string;
  readonly pipeline_id: string;
  readonly pipeline_version: number;
  readonly pipeline_name: string;
  readonly definition_json: string;
  readonly versions_json: string;
  readonly inputs_json: string;
  readonly project_id: string | null;
  readonly checkout_thread_id: string | null;
  readonly status: string;
  readonly retry_at: string | null;
  readonly cursor_step_id: string | null;
  readonly final_verdict: string | null;
  readonly stopped_run_id: string | null;
  readonly error: string | null;
  readonly started_by: string;
  readonly caller_runtime_mode: string | null;
  readonly caller_thread_id: string | null;
  readonly trigger_id: string | null;
  readonly created_at: string;
  readonly finished_at: string | null;
}

interface AttemptRow {
  readonly pipeline_run_id: string;
  readonly seq: number;
  readonly step_id: string;
  readonly round: number;
  readonly state: string;
  readonly bot_version: number | null;
  readonly run_id: string | null;
  readonly batch_id: string | null;
  readonly outcome_json: string | null;
  readonly notes_json: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
}

/** What the store holds about a pipeline run beyond what clients see. */
export interface StoredPipelineRun {
  readonly run: BotPipelineRun;
  /** The pipeline as it was when the run started. */
  readonly pipeline: BotPipeline;
  /** Each step's bot as resolved when the run started, by step id. */
  readonly bots: Readonly<Record<string, BotDefinition>>;
  readonly callerRuntimeMode: RuntimeMode | null;
  /** Set when a trigger started the run, so its inputs came from an event. */
  readonly triggerId: string | null;
}

export interface StoredAttempt {
  readonly attempt: BotPipelineAttempt;
  /** Everything later steps' templates read, which the attempt's outcome only summarizes. */
  readonly output: StepOutput | null;
}

const StoredStepOutput = Schema.Struct({
  status: BotRunStatus,
  verdict: Schema.NullOr(BotVerdictValue),
  summary: Schema.NullOr(Schema.String),
  findings: Schema.Array(BotFinding),
  result: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});

const definitionJson = Schema.fromJsonString(BotPipelineInput);
const pipelineJson = Schema.fromJsonString(BotPipeline);
const botsJson = Schema.fromJsonString(Schema.Record(Schema.String, BotDefinition));
const inputsJson = Schema.fromJsonString(BotInputs);
const outputJson = Schema.fromJsonString(StoredStepOutput);
const notesJson = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeDefinition = Schema.decodeUnknownOption(definitionJson);
const decodePipeline = Schema.decodeUnknownOption(pipelineJson);
const decodeBots = Schema.decodeUnknownOption(botsJson);
const decodeInputs = Schema.decodeUnknownOption(inputsJson);
const decodeOutput = Schema.decodeUnknownOption(outputJson);
const decodeNotes = Schema.decodeUnknownOption(notesJson);
const encodeDefinition = Schema.encodeSync(definitionJson);
const encodePipeline = Schema.encodeSync(pipelineJson);
const encodeBots = Schema.encodeSync(botsJson);
const encodeInputs = Schema.encodeSync(inputsJson);
const encodeOutput = Schema.encodeSync(outputJson);
const encodeNotes = Schema.encodeSync(notesJson);
const isRunStatus = Schema.is(BotPipelineRunStatus);
const isAttemptState = Schema.is(BotPipelineAttemptState);
const isVerdict = Schema.is(BotVerdictValue);
const isRuntimeMode = Schema.is(RuntimeMode);

const creator = (value: string): BotCreator => (value === "agent" ? "agent" : "user");

/** The definition as stored: everything but the row's own columns. */
const definitionFields = ({
  version: _version,
  createdBy: _createdBy,
  createdAt: _createdAt,
  updatedAt: _updatedAt,
  ...input
}: BotPipeline) => input;

// A row written by a future version this one cannot read is skipped, not fatal.
const toPipeline = (row: PipelineRow): BotPipeline | null => {
  const definition = decodeDefinition(row.definition_json);
  if (Option.isNone(definition)) return null;
  return {
    ...definition.value,
    version: Number(row.version),
    createdBy: creator(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toStoredRun = (row: RunRow): StoredPipelineRun | null => {
  const pipeline = decodePipeline(row.definition_json);
  const bots = decodeBots(row.versions_json);
  const inputs = decodeInputs(row.inputs_json);
  const { status } = row;
  if (
    Option.isNone(pipeline) ||
    Option.isNone(bots) ||
    Option.isNone(inputs) ||
    !isRunStatus(status)
  )
    return null;
  return {
    run: {
      id: row.id,
      pipelineId: row.pipeline_id,
      pipelineVersion: Number(row.pipeline_version),
      pipelineName: row.pipeline_name,
      inputs: inputs.value,
      projectId: row.project_id === null ? null : ProjectId.make(row.project_id),
      checkoutThreadId:
        row.checkout_thread_id === null ? null : ThreadId.make(row.checkout_thread_id),
      status,
      retryAt: row.retry_at,
      cursorStepId: row.cursor_step_id,
      finalVerdict:
        row.final_verdict !== null && isVerdict(row.final_verdict) ? row.final_verdict : null,
      stoppedRunId: row.stopped_run_id,
      error: row.error,
      startedBy: creator(row.started_by),
      callerThreadId: row.caller_thread_id === null ? null : ThreadId.make(row.caller_thread_id),
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    },
    pipeline: pipeline.value,
    bots: bots.value,
    callerRuntimeMode:
      row.caller_runtime_mode !== null && isRuntimeMode(row.caller_runtime_mode)
        ? row.caller_runtime_mode
        : null,
    triggerId: row.trigger_id,
  };
};

const toAttempt = (row: AttemptRow): StoredAttempt | null => {
  const { state } = row;
  if (!isAttemptState(state)) return null;
  const output =
    row.outcome_json === null ? null : Option.getOrNull(decodeOutput(row.outcome_json));
  return {
    attempt: {
      seq: Number(row.seq),
      stepId: row.step_id,
      round: Number(row.round),
      state,
      botVersion: row.bot_version === null ? null : Number(row.bot_version),
      runId: row.run_id,
      batchId: row.batch_id,
      outcome:
        output === null
          ? null
          : { status: output.status, verdict: output.verdict, summary: output.summary },
      notes: Option.getOrElse(decodeNotes(row.notes_json), () => []),
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    },
    output,
  };
};

export interface RunUpdate {
  readonly status: BotPipelineRun["status"];
  readonly retryAt: string | null;
  readonly cursorStepId: string | null;
  readonly finalVerdict: BotPipelineRun["finalVerdict"];
  readonly stoppedRunId: string | null;
  readonly error: string | null;
  readonly finishedAt: string | null;
}

export const makePipelinesStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertAttempt = Effect.fn("PipelinesStore.insertAttempt")(function* (
    pipelineRunId: string,
    attempt: Pick<BotPipelineAttempt, "seq" | "stepId" | "round">,
  ) {
    yield* sql`INSERT INTO fork_bots_pipeline_attempts (pipeline_run_id,seq,step_id,round,state,notes_json) VALUES (${pipelineRunId},${attempt.seq},${attempt.stepId},${attempt.round},'pending','[]')`;
  });

  return {
    withTransaction: sql.withTransaction,

    listPipelines: Effect.fn("PipelinesStore.listPipelines")(function* () {
      const rows =
        yield* sql<PipelineRow>`SELECT * FROM fork_bots_pipelines ORDER BY created_at, id`;
      return rows.flatMap((row) => toPipeline(row) ?? []);
    }),

    getPipeline: Effect.fn("PipelinesStore.getPipeline")(function* (id: string) {
      const rows = yield* sql<PipelineRow>`SELECT * FROM fork_bots_pipelines WHERE id = ${id}`;
      return rows[0] ? toPipeline(rows[0]) : null;
    }),

    /** Whether a row exists, including one this version cannot read. */
    hasPipeline: Effect.fn("PipelinesStore.hasPipeline")(function* (id: string) {
      const rows = yield* sql<{ id: string }>`SELECT id FROM fork_bots_pipelines WHERE id = ${id}`;
      return rows.length > 0;
    }),

    /** The highest version this id used, so a pipeline recreated under it continues past its runs. */
    maxRunVersion: Effect.fn("PipelinesStore.maxRunVersion")(function* (id: string) {
      const rows = yield* sql<{
        version: number | null;
      }>`SELECT MAX(pipeline_version) AS version FROM fork_bots_pipeline_runs WHERE pipeline_id = ${id}`;
      return Number(rows[0]?.version ?? 0);
    }),

    putPipeline: Effect.fn("PipelinesStore.putPipeline")(function* (pipeline: BotPipeline) {
      yield* sql`INSERT INTO fork_bots_pipelines (id,version,definition_json,created_by,created_at,updated_at) VALUES (${pipeline.id},${pipeline.version},${encodeDefinition(definitionFields(pipeline))},${pipeline.createdBy},${pipeline.createdAt},${pipeline.updatedAt}) ON CONFLICT(id) DO UPDATE SET version = excluded.version, definition_json = excluded.definition_json, updated_at = excluded.updated_at`;
    }),

    deletePipeline: Effect.fn("PipelinesStore.deletePipeline")(function* (id: string) {
      yield* sql`DELETE FROM fork_bots_pipelines WHERE id = ${id}`;
    }),

    /** Writes the run and its first attempt, pending, in one transaction. */
    insertRun: Effect.fn("PipelinesStore.insertRun")(function* (
      stored: StoredPipelineRun,
      firstStepId: string,
    ) {
      const { run } = stored;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`INSERT INTO fork_bots_pipeline_runs (id,pipeline_id,pipeline_version,pipeline_name,definition_json,versions_json,inputs_json,project_id,checkout_thread_id,status,retry_at,cursor_step_id,final_verdict,stopped_run_id,error,started_by,caller_runtime_mode,caller_thread_id,trigger_id,created_at,finished_at) VALUES (${run.id},${run.pipelineId},${run.pipelineVersion},${run.pipelineName},${encodePipeline(stored.pipeline)},${encodeBots(stored.bots)},${encodeInputs(run.inputs)},${run.projectId},${run.checkoutThreadId},${run.status},${run.retryAt},${run.cursorStepId},${run.finalVerdict},${run.stoppedRunId},${run.error},${run.startedBy},${stored.callerRuntimeMode},${run.callerThreadId},${stored.triggerId},${run.createdAt},${run.finishedAt})`;
          yield* insertAttempt(run.id, { seq: 1, stepId: firstStepId, round: 1 });
        }),
      );
    }),

    getRun: Effect.fn("PipelinesStore.getRun")(function* (id: string) {
      const rows = yield* sql<RunRow>`SELECT * FROM fork_bots_pipeline_runs WHERE id = ${id}`;
      return rows[0] ? toStoredRun(rows[0]) : null;
    }),

    updateRun: Effect.fn("PipelinesStore.updateRun")(function* (id: string, update: RunUpdate) {
      yield* sql`UPDATE fork_bots_pipeline_runs SET status = ${update.status}, retry_at = ${update.retryAt}, cursor_step_id = ${update.cursorStepId}, final_verdict = ${update.finalVerdict}, stopped_run_id = ${update.stoppedRunId}, error = ${update.error}, finished_at = ${update.finishedAt} WHERE id = ${id}`;
    }),

    /** Newest first. Fetches one extra row to report whether more exist. */
    listRuns: Effect.fn("PipelinesStore.listRuns")(function* (input: {
      readonly pipelineId?: string | undefined;
      readonly before?: string | undefined;
      readonly limit: number;
    }) {
      const conditions = [
        ...(input.pipelineId === undefined ? [] : [sql`pipeline_id = ${input.pipelineId}`]),
        ...(input.before === undefined ? [] : [sql`created_at < ${input.before}`]),
      ];
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_pipeline_runs ${conditions.length === 0 ? sql`` : sql`WHERE ${sql.and(conditions)}`} ORDER BY created_at DESC, id DESC LIMIT ${input.limit + 1}`;
      return {
        runs: rows.slice(0, input.limit).flatMap((row) => toStoredRun(row)?.run ?? []),
        hasMore: rows.length > input.limit,
      };
    }),

    listActiveRuns: Effect.fn("PipelinesStore.listActiveRuns")(function* () {
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_bots_pipeline_runs WHERE status IN ('running', 'waiting') ORDER BY created_at`;
      return rows.flatMap((row) => toStoredRun(row) ?? []);
    }),

    /** Active runs, of one pipeline or all, including rows this version cannot read. */
    activeRunCount: Effect.fn("PipelinesStore.activeRunCount")(function* (pipelineId?: string) {
      const rows = yield* sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM fork_bots_pipeline_runs WHERE status IN ('running', 'waiting') ${pipelineId === undefined ? sql`` : sql`AND pipeline_id = ${pipelineId}`}`;
      return Number(rows[0]?.count ?? 0);
    }),

    getAttempts: Effect.fn("PipelinesStore.getAttempts")(function* (pipelineRunId: string) {
      const rows =
        yield* sql<AttemptRow>`SELECT * FROM fork_bots_pipeline_attempts WHERE pipeline_run_id = ${pipelineRunId} ORDER BY seq`;
      return rows.flatMap((row) => toAttempt(row) ?? []);
    }),

    insertAttempt,

    startAttempt: Effect.fn("PipelinesStore.startAttempt")(function* (
      pipelineRunId: string,
      seq: number,
      started: {
        readonly botVersion: number;
        readonly runId: string | null;
        readonly batchId: string | null;
        readonly notes: ReadonlyArray<string>;
        readonly startedAt: string;
      },
    ) {
      yield* sql`UPDATE fork_bots_pipeline_attempts SET state = 'started', bot_version = ${started.botVersion}, run_id = ${started.runId}, batch_id = ${started.batchId}, notes_json = ${encodeNotes(started.notes)}, started_at = ${started.startedAt} WHERE pipeline_run_id = ${pipelineRunId} AND seq = ${seq}`;
    }),

    /** Ends an attempt as done, with its output, or skipped, with notes only. */
    endAttempt: Effect.fn("PipelinesStore.endAttempt")(function* (
      pipelineRunId: string,
      seq: number,
      ended: {
        readonly state: "done" | "skipped";
        readonly output: StepOutput | null;
        readonly notes: ReadonlyArray<string>;
        readonly finishedAt: string;
      },
    ) {
      yield* sql`UPDATE fork_bots_pipeline_attempts SET state = ${ended.state}, outcome_json = ${ended.output === null ? null : encodeOutput(ended.output)}, notes_json = ${encodeNotes(ended.notes)}, finished_at = ${ended.finishedAt} WHERE pipeline_run_id = ${pipelineRunId} AND seq = ${seq}`;
    }),

    /** Sends a started attempt whose run never started back to wait. */
    resetAttempt: Effect.fn("PipelinesStore.resetAttempt")(function* (
      pipelineRunId: string,
      seq: number,
    ) {
      yield* sql`UPDATE fork_bots_pipeline_attempts SET state = 'pending', bot_version = NULL, run_id = NULL, batch_id = NULL, started_at = NULL WHERE pipeline_run_id = ${pipelineRunId} AND seq = ${seq}`;
    }),

    /** Shares the bot starters' table, under ids no bot starter uses. */
    hasStarter: Effect.fn("PipelinesStore.hasStarter")(function* (starterId: string) {
      const rows = yield* sql<{
        starter_id: string;
      }>`SELECT starter_id FROM fork_bots_starters WHERE starter_id = ${starterId}`;
      return rows.length > 0;
    }),

    recordStarter: Effect.fn("PipelinesStore.recordStarter")(function* (
      starterId: string,
      revision: number,
      at: string,
    ) {
      yield* sql`INSERT INTO fork_bots_starters (starter_id, revision, seeded_at) VALUES (${starterId}, ${revision}, ${at}) ON CONFLICT(starter_id) DO UPDATE SET revision = excluded.revision`;
    }),

    /** Deletes finished runs beyond the newest `keep` of a pipeline, with their attempts. */
    pruneRuns: Effect.fn("PipelinesStore.pruneRuns")(function* (pipelineId: string, keep: number) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const stale = sql`SELECT id FROM fork_bots_pipeline_runs WHERE pipeline_id = ${pipelineId} AND status NOT IN ('running', 'waiting') AND id NOT IN (SELECT id FROM fork_bots_pipeline_runs WHERE pipeline_id = ${pipelineId} ORDER BY created_at DESC, id DESC LIMIT ${keep})`;
          yield* sql`DELETE FROM fork_bots_pipeline_attempts WHERE pipeline_run_id IN (${stale})`;
          yield* sql`DELETE FROM fork_bots_pipeline_runs WHERE id IN (${stale})`;
        }),
      );
    }),
  };
});

export type PipelinesStore = Effect.Success<typeof makePipelinesStore>;
