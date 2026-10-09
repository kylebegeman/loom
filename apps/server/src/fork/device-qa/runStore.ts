import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  DEFAULT_DEVICE_QA_SETTINGS,
  DeviceQaFlowRun,
  DeviceQaRunStatus,
  DeviceQaSettings,
  DeviceQaSettingsPatch,
  DeviceQaStep,
  type DeviceQaRun,
} from "@t3tools/contracts/fork";
import { DevicePlatform } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** The run history lists this many runs per project. */
export const RUNS_LISTED = 20;

/** A run as stored: the public record plus its workspace, folder and steps. */
export interface StoredRun {
  readonly run: DeviceQaRun;
  readonly cwd: string;
  readonly runDir: string;
  /** Written when the run finishes; live steps are kept in memory until then. */
  readonly steps: Readonly<Record<string, ReadonlyArray<DeviceQaStep>>> | null;
}

interface RunRow {
  readonly id: string;
  readonly project_id: string;
  readonly thread_id: string | null;
  readonly cwd: string;
  readonly host_id: string;
  readonly device_id: string;
  readonly platform: string;
  readonly flows_json: string;
  readonly steps_json: string | null;
  readonly update_baselines: number;
  readonly status: string;
  readonly started_by: string;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly run_dir: string;
}

const flowsJson = Schema.fromJsonString(Schema.Array(DeviceQaFlowRun));
const stepsJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Array(DeviceQaStep)));
const settingsJson = Schema.fromJsonString(DeviceQaSettings);
const decodeFlows = Schema.decodeUnknownOption(flowsJson);
const decodeSteps = Schema.decodeUnknownOption(stepsJson);
const encodeFlows = Schema.encodeSync(flowsJson);
const encodeSteps = Schema.encodeSync(stepsJson);
const encodeSettings = Schema.encodeSync(settingsJson);
const decodeStoredSettings = Schema.decodeUnknownOption(
  Schema.fromJsonString(DeviceQaSettingsPatch),
);
const isStatus = Schema.is(DeviceQaRunStatus);
const isPlatform = Schema.is(DevicePlatform);

/** A patch over settings; fields left out or undefined keep their value. */
export const mergeSettings = (
  base: DeviceQaSettings,
  patch: DeviceQaSettingsPatch | undefined,
): DeviceQaSettings => ({
  ...base,
  ...Object.fromEntries(Object.entries(patch ?? {}).filter((entry) => entry[1] !== undefined)),
});

const toStored = (row: RunRow): StoredRun | null => {
  const flows = decodeFlows(row.flows_json);
  const { status, platform } = row;
  // A row written by a future version this one cannot read is skipped, not fatal.
  if (Option.isNone(flows) || !isStatus(status) || !isPlatform(platform)) return null;
  return {
    run: {
      id: row.id,
      projectId: ProjectId.make(row.project_id),
      threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
      target: { hostId: row.host_id, deviceId: row.device_id, platform },
      flows: flows.value,
      updateBaselines: Number(row.update_baselines) === 1,
      status,
      startedBy: row.started_by === "agent" ? "agent" : "user",
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    },
    cwd: row.cwd,
    runDir: row.run_dir,
    steps: row.steps_json === null ? null : Option.getOrNull(decodeSteps(row.steps_json)),
  };
};

export const makeRunStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return {
    insert: Effect.fn("DeviceQaRunStore.insert")(function* (stored: StoredRun) {
      const { run } = stored;
      yield* sql`INSERT INTO fork_device_qa_runs (id,project_id,thread_id,cwd,host_id,device_id,platform,flows_json,steps_json,update_baselines,status,started_by,started_at,finished_at,run_dir) VALUES (${run.id},${run.projectId},${run.threadId},${stored.cwd},${run.target.hostId},${run.target.deviceId},${run.target.platform},${encodeFlows(run.flows)},${stored.steps === null ? null : encodeSteps(stored.steps)},${run.updateBaselines ? 1 : 0},${run.status},${run.startedBy},${run.startedAt},${run.finishedAt},${stored.runDir})`;
    }),

    /** Writes the run's progress; its workspace, target and request never change. */
    save: Effect.fn("DeviceQaRunStore.save")(function* (stored: StoredRun) {
      const { run } = stored;
      yield* sql`UPDATE fork_device_qa_runs SET flows_json = ${encodeFlows(run.flows)}, steps_json = ${stored.steps === null ? null : encodeSteps(stored.steps)}, status = ${run.status}, finished_at = ${run.finishedAt} WHERE id = ${run.id}`;
    }),

    get: Effect.fn("DeviceQaRunStore.get")(function* (id: string) {
      const rows = yield* sql<RunRow>`SELECT * FROM fork_device_qa_runs WHERE id = ${id}`;
      return rows[0] ? toStored(rows[0]) : null;
    }),

    /** Newest first. */
    listForProject: Effect.fn("DeviceQaRunStore.listForProject")(function* (
      projectId: string,
      limit = RUNS_LISTED,
    ) {
      const rows =
        yield* sql<RunRow>`SELECT * FROM fork_device_qa_runs WHERE project_id = ${projectId} ORDER BY started_at DESC, id DESC LIMIT ${limit}`;
      return rows.flatMap((row) => toStored(row) ?? []);
    }),

    /**
     * Runs the previous server left running died with it: they become `interrupted`, and their
     * unfinished flows `cancelled`.
     */
    markInterrupted: Effect.fn("DeviceQaRunStore.markInterrupted")(function* (finishedAt: string) {
      const rows = yield* sql<RunRow>`SELECT * FROM fork_device_qa_runs WHERE status = 'running'`;
      for (const row of rows) {
        const stored = toStored(row);
        if (stored === null) continue;
        const flows = stored.run.flows.map((flow) =>
          flow.status === "pending" || flow.status === "running"
            ? { ...flow, status: "cancelled" as const }
            : flow,
        );
        yield* sql`UPDATE fork_device_qa_runs SET status = 'interrupted', finished_at = ${finishedAt}, flows_json = ${encodeFlows(flows)} WHERE id = ${row.id}`;
      }
      return rows.length;
    }),

    /** Deletes finished runs beyond the newest `keep` of a project. Returns their directories. */
    prune: Effect.fn("DeviceQaRunStore.prune")(function* (projectId: string, keep: number) {
      const rows = yield* sql<{
        id: string;
        run_dir: string;
        finished_at: string | null;
      }>`SELECT id, run_dir, finished_at FROM fork_device_qa_runs WHERE project_id = ${projectId} ORDER BY started_at DESC, id DESC`;
      const doomed = rows.slice(keep).filter((row) => row.finished_at !== null);
      for (const row of doomed) yield* sql`DELETE FROM fork_device_qa_runs WHERE id = ${row.id}`;
      return doomed.map((row) => row.run_dir);
    }),

    getSettings: Effect.fn("DeviceQaRunStore.getSettings")(function* () {
      const rows = yield* sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_device_qa_settings WHERE key = 'settings'`;
      // Fields added later take their defaults.
      const stored = rows[0]
        ? Option.getOrUndefined(decodeStoredSettings(rows[0].value_json))
        : undefined;
      return mergeSettings(DEFAULT_DEVICE_QA_SETTINGS, stored);
    }),

    updateSettings: Effect.fn("DeviceQaRunStore.updateSettings")(function* (
      settings: DeviceQaSettings,
    ) {
      yield* sql`INSERT INTO fork_device_qa_settings (key,value_json) VALUES ('settings', ${encodeSettings(settings)}) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`;
      return settings;
    }),
  };
});

export type DeviceQaRunStore = Effect.Success<typeof makeRunStore>;
