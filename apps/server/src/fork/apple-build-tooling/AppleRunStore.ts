import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  AppleBuildSettings,
  AppleBuildSettingsPatch,
  AppleRunKind,
  AppleRunPhase,
  AppleRunRequest,
  AppleRunStatus,
  AppleRunSummary,
  DEFAULT_APPLE_BUILD_SETTINGS,
  type AppleRunRecord,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** The history list shows this many runs per workspace. */
export const RUNS_LISTED = 20;

/** A run as stored: the public record plus where its files live. */
export interface StoredRun {
  readonly run: AppleRunRecord;
  readonly runDir: string;
  readonly summary: AppleRunSummary | null;
  readonly resultBundlePath: string | null;
}

interface RunRecord {
  readonly id: string;
  readonly project_id: string;
  readonly thread_id: string | null;
  readonly cwd: string;
  readonly kind: string;
  readonly request_json: string;
  readonly status: string;
  readonly phase: string;
  readonly started_by: string;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly exit_code: number | null;
  readonly command_line: string;
  readonly error_count: number;
  readonly warning_count: number;
  readonly failed_test_count: number;
  readonly summary_json: string | null;
  readonly run_dir: string;
  readonly result_bundle_path: string | null;
}

const requestJson = Schema.fromJsonString(AppleRunRequest);
const summaryJson = Schema.fromJsonString(AppleRunSummary);
const settingsJson = Schema.fromJsonString(AppleBuildSettings);
const decodeRequest = Schema.decodeUnknownOption(requestJson);
const decodeSummary = Schema.decodeUnknownOption(summaryJson);
const encodeRequest = Schema.encodeSync(requestJson);
const encodeSummary = Schema.encodeSync(summaryJson);

const isKind = Schema.is(AppleRunKind);
const isStatus = Schema.is(AppleRunStatus);
const isPhase = Schema.is(AppleRunPhase);
const encodeSettings = Schema.encodeSync(settingsJson);

/** A patch over settings; optional fields left out or undefined keep their value. */
export const mergeSettings = (
  base: AppleBuildSettings,
  patch: AppleBuildSettingsPatch | undefined,
): AppleBuildSettings => ({
  ...base,
  ...Object.fromEntries(Object.entries(patch ?? {}).filter((entry) => entry[1] !== undefined)),
});

const decodeStoredSettings = Schema.decodeUnknownOption(
  Schema.fromJsonString(AppleBuildSettingsPatch),
);

const toStored = (record: RunRecord): StoredRun | null => {
  const request = decodeRequest(record.request_json);
  const { kind, status, phase } = record;
  // A row written by a future version this one cannot read is skipped, not fatal.
  if (Option.isNone(request) || !isKind(kind) || !isStatus(status) || !isPhase(phase)) return null;
  return {
    run: {
      id: record.id,
      projectId: ProjectId.make(record.project_id),
      threadId: record.thread_id === null ? null : ThreadId.make(record.thread_id),
      cwd: record.cwd,
      kind,
      request: request.value,
      status,
      phase,
      startedBy: record.started_by === "agent" ? "agent" : "user",
      startedAt: record.started_at,
      finishedAt: record.finished_at,
      exitCode: record.exit_code === null ? null : Number(record.exit_code),
      commandLine: record.command_line,
      counts: {
        errors: Number(record.error_count),
        warnings: Number(record.warning_count),
        failedTests: Number(record.failed_test_count),
      },
      hasResultBundle: record.result_bundle_path !== null,
    },
    runDir: record.run_dir,
    summary:
      record.summary_json === null ? null : Option.getOrNull(decodeSummary(record.summary_json)),
    resultBundlePath: record.result_bundle_path,
  };
};

const rowsToStored = (rows: ReadonlyArray<RunRecord>) => rows.flatMap((row) => toStored(row) ?? []);

export const countsOf = (summary: AppleRunSummary | null) => ({
  errors: summary?.build?.errorCount ?? 0,
  warnings: summary?.build?.warningCount ?? 0,
  failedTests: summary?.tests?.failed ?? 0,
});

export const makeRunStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const get = Effect.fn("AppleRunStore.get")(function* (id: string) {
    const rows =
      yield* sql<RunRecord>`SELECT * FROM fork_apple_build_tooling_runs WHERE id = ${id}`;
    return rows[0] ? toStored(rows[0]) : null;
  });

  return {
    insert: Effect.fn("AppleRunStore.insert")(function* (stored: StoredRun) {
      const { run } = stored;
      yield* sql`INSERT INTO fork_apple_build_tooling_runs (id,project_id,thread_id,cwd,kind,request_json,status,phase,started_by,started_at,finished_at,exit_code,command_line,error_count,warning_count,failed_test_count,summary_json,run_dir,result_bundle_path) VALUES (${run.id},${run.projectId},${run.threadId},${run.cwd},${run.kind},${encodeRequest(run.request)},${run.status},${run.phase},${run.startedBy},${run.startedAt},${run.finishedAt},${run.exitCode},${run.commandLine},${run.counts.errors},${run.counts.warnings},${run.counts.failedTests},${stored.summary === null ? null : encodeSummary(stored.summary)},${stored.runDir},${stored.resultBundlePath})`;
    }),

    /** Writes the run's current state; the id, workspace and request never change. */
    save: Effect.fn("AppleRunStore.save")(function* (stored: StoredRun) {
      const { run } = stored;
      yield* sql`UPDATE fork_apple_build_tooling_runs SET status = ${run.status}, phase = ${run.phase}, finished_at = ${run.finishedAt}, exit_code = ${run.exitCode}, command_line = ${run.commandLine}, error_count = ${run.counts.errors}, warning_count = ${run.counts.warnings}, failed_test_count = ${run.counts.failedTests}, summary_json = ${stored.summary === null ? null : encodeSummary(stored.summary)}, result_bundle_path = ${stored.resultBundlePath} WHERE id = ${run.id}`;
    }),

    get,

    /** Newest first. */
    listForCwd: Effect.fn("AppleRunStore.listForCwd")(function* (cwd: string) {
      return rowsToStored(
        yield* sql<RunRecord>`SELECT * FROM fork_apple_build_tooling_runs WHERE cwd = ${cwd} ORDER BY started_at DESC, id DESC LIMIT ${RUNS_LISTED}`,
      );
    }),

    latestFinished: Effect.fn("AppleRunStore.latestFinished")(function* (
      cwd: string,
      kind: AppleRunKind,
    ) {
      const rows = rowsToStored(
        yield* sql<RunRecord>`SELECT * FROM fork_apple_build_tooling_runs WHERE cwd = ${cwd} AND kind = ${kind} AND finished_at IS NOT NULL ORDER BY started_at DESC, id DESC LIMIT 1`,
      );
      return rows[0] ?? null;
    }),

    /** Runs the previous server left queued or running died with it. */
    markInterrupted: Effect.fn("AppleRunStore.markInterrupted")(function* (finishedAt: string) {
      yield* sql`UPDATE fork_apple_build_tooling_runs SET status = 'interrupted', phase = 'done', finished_at = ${finishedAt} WHERE status IN ('queued', 'running')`;
    }),

    /**
     * Deletes finished runs beyond the newest `keep` of a project, and runs whose project no
     * longer exists. Returns the deleted runs' directories.
     */
    prune: Effect.fn("AppleRunStore.prune")(function* (
      projectId: string,
      keep: number,
      liveProjectIds: ReadonlyArray<string>,
    ) {
      const rows = yield* sql<{
        id: string;
        project_id: string;
        run_dir: string;
        finished_at: string | null;
      }>`SELECT id, project_id, run_dir, finished_at FROM fork_apple_build_tooling_runs ORDER BY started_at DESC, id DESC`;
      const live = new Set(liveProjectIds);
      let kept = 0;
      const doomed = rows.filter((row) => {
        if (row.finished_at === null) return false;
        if (!live.has(row.project_id)) return true;
        if (row.project_id !== projectId) return false;
        return ++kept > keep;
      });
      for (const row of doomed)
        yield* sql`DELETE FROM fork_apple_build_tooling_runs WHERE id = ${row.id}`;
      return doomed.map((row) => row.run_dir);
    }),

    /** Deletes the finished runs of one project, or of all. Returns their directories. */
    clear: Effect.fn("AppleRunStore.clear")(function* (projectId: string | undefined) {
      const rows =
        projectId === undefined
          ? yield* sql<{
              run_dir: string;
            }>`SELECT run_dir FROM fork_apple_build_tooling_runs WHERE finished_at IS NOT NULL`
          : yield* sql<{
              run_dir: string;
            }>`SELECT run_dir FROM fork_apple_build_tooling_runs WHERE finished_at IS NOT NULL AND project_id = ${projectId}`;
      if (projectId === undefined)
        yield* sql`DELETE FROM fork_apple_build_tooling_runs WHERE finished_at IS NOT NULL`;
      else
        yield* sql`DELETE FROM fork_apple_build_tooling_runs WHERE finished_at IS NOT NULL AND project_id = ${projectId}`;
      return rows.map((row) => row.run_dir);
    }),

    /** Every workspace a project's runs used, for clearing their derived data. */
    cwdsForProject: Effect.fn("AppleRunStore.cwdsForProject")(function* (projectId: string) {
      const rows = yield* sql<{
        cwd: string;
      }>`SELECT DISTINCT cwd FROM fork_apple_build_tooling_runs WHERE project_id = ${projectId}`;
      return rows.map((row) => row.cwd);
    }),

    countRuns: Effect.fn("AppleRunStore.countRuns")(function* () {
      const rows = yield* sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM fork_apple_build_tooling_runs`;
      return Number(rows[0]?.count ?? 0);
    }),

    getSettings: Effect.fn("AppleRunStore.getSettings")(function* () {
      const rows = yield* sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_apple_build_tooling_settings WHERE key = 'settings'`;
      // Fields added later take their defaults.
      const stored = rows[0]
        ? Option.getOrUndefined(decodeStoredSettings(rows[0].value_json))
        : undefined;
      return mergeSettings(DEFAULT_APPLE_BUILD_SETTINGS, stored);
    }),

    updateSettings: Effect.fn("AppleRunStore.updateSettings")(function* (
      settings: AppleBuildSettings,
    ) {
      yield* sql`INSERT INTO fork_apple_build_tooling_settings (key,value_json) VALUES ('settings', ${encodeSettings(settings)}) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`;
      return settings;
    }),
  };
});

export type AppleRunStore = Effect.Success<typeof makeRunStore>;
