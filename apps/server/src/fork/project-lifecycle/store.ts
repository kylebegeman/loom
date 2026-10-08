import { ProjectId } from "@t3tools/contracts";
import { ProjectLifecycleSettings, type LaneBackend } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const settingsJson = Schema.fromJsonString(ProjectLifecycleSettings);

/** One stored lane. Usage and holders are live values the service derives. */
export interface LaneRow {
  readonly id: string;
  readonly checkoutPath: string;
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly name: string;
  readonly laneDir: string;
  readonly backend: LaneBackend;
  readonly capBytes: number;
  readonly device: string | null;
  readonly createdAt: string;
  /** First of the lane's ports; null only for lanes made before ports existed. */
  readonly portBase: number | null;
}

interface LaneRecord {
  readonly id: string;
  readonly checkout_path: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly name: string;
  readonly lane_dir: string;
  readonly backend: string;
  readonly cap_bytes: number;
  readonly device: string | null;
  readonly created_at: string;
  readonly port_base: number | null;
}

const toRow = (record: LaneRecord): LaneRow => ({
  id: record.id,
  checkoutPath: record.checkout_path,
  projectId: ProjectId.make(record.project_id),
  projectName: record.project_name,
  name: record.name,
  laneDir: record.lane_dir,
  backend: record.backend === "image" ? "image" : "folder",
  capBytes: Number(record.cap_bytes),
  device: record.device,
  createdAt: record.created_at,
  portBase: record.port_base === null ? null : Number(record.port_base),
});

export const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return {
    /** Stored settings, or `defaults` when none were saved. */
    getSettings: Effect.fn("ProjectLifecycleStore.getSettings")(function* (
      defaults: ProjectLifecycleSettings,
    ) {
      const rows = yield* sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_project_lifecycle_settings WHERE key = 'settings'`;
      return rows[0] ? yield* Schema.decodeEffect(settingsJson)(rows[0].value_json) : defaults;
    }),
    updateSettings: Effect.fn("ProjectLifecycleStore.updateSettings")(function* (
      settings: ProjectLifecycleSettings,
    ) {
      yield* sql`INSERT INTO fork_project_lifecycle_settings (key,value_json) VALUES ('settings', ${yield* Schema.encodeEffect(settingsJson)(settings)}) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`;
      return settings;
    }),
    listLanes: Effect.fn("ProjectLifecycleStore.listLanes")(function* () {
      const rows =
        yield* sql<LaneRecord>`SELECT * FROM fork_project_lifecycle_lanes ORDER BY created_at, id`;
      return rows.map(toRow);
    }),
    insertLane: Effect.fn("ProjectLifecycleStore.insertLane")(function* (lane: LaneRow) {
      yield* sql`INSERT INTO fork_project_lifecycle_lanes (id,checkout_path,project_id,project_name,name,lane_dir,backend,cap_bytes,device,created_at,port_base) VALUES (${lane.id},${lane.checkoutPath},${lane.projectId},${lane.projectName},${lane.name},${lane.laneDir},${lane.backend},${lane.capBytes},${lane.device},${lane.createdAt},${lane.portBase})`;
    }),
    updateLane: Effect.fn("ProjectLifecycleStore.updateLane")(function* (
      id: string,
      fields: { readonly capBytes: number; readonly device: string | null },
    ) {
      yield* sql`UPDATE fork_project_lifecycle_lanes SET cap_bytes = ${fields.capBytes}, device = ${fields.device} WHERE id = ${id}`;
    }),
    setPortBase: Effect.fn("ProjectLifecycleStore.setPortBase")(function* (
      id: string,
      portBase: number,
    ) {
      yield* sql`UPDATE fork_project_lifecycle_lanes SET port_base = ${portBase} WHERE id = ${id}`;
    }),
    deleteLane: Effect.fn("ProjectLifecycleStore.deleteLane")(function* (id: string) {
      yield* sql`DELETE FROM fork_project_lifecycle_lanes WHERE id = ${id}`;
    }),
  };
});

export type ProjectLifecycleStore = Effect.Success<typeof makeStore>;
