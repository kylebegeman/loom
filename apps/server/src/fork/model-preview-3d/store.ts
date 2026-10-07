import {
  EMPTY_MODEL_WORKSPACE,
  ModelWorkspace,
  DEFAULT_MODEL_PREVIEW_SETTINGS,
  ModelPreviewSettings,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as SqlClient from "effect/unstable/sql/SqlClient";
const workspaceJson = Schema.fromJsonString(ModelWorkspace);
const Overrides = Schema.Record(Schema.String, Schema.String);
const settingsJson = Schema.fromJsonString(ModelPreviewSettings);
const overridesJson = Schema.fromJsonString(Overrides);
export const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return {
    getWorkspace: Effect.fn("ModelPreviewStore.getWorkspace")(function* (
      projectId: string,
      path: string,
    ) {
      const rows = yield* sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_model_preview_3d_workspace WHERE project_id = ${projectId} AND path = ${path}`;
      return rows[0]
        ? yield* Schema.decodeEffect(workspaceJson)(rows[0].value_json)
        : EMPTY_MODEL_WORKSPACE;
    }),
    saveWorkspace: Effect.fn("ModelPreviewStore.saveWorkspace")(function* (
      projectId: string,
      path: string,
      value: ModelWorkspace,
    ) {
      const encoded = yield* Schema.encodeEffect(workspaceJson)(value);
      yield* sql`INSERT INTO fork_model_preview_3d_workspace (project_id,path,value_json) VALUES (${projectId},${path},${encoded}) ON CONFLICT(project_id,path) DO UPDATE SET value_json = excluded.value_json`;
      return value;
    }),
    getWorkspaces: Effect.fn("ModelPreviewStore.getWorkspaces")(function* () {
      const rows = yield* sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_model_preview_3d_workspace`;
      return yield* Effect.forEach(rows, (row) =>
        Schema.decodeEffect(workspaceJson)(row.value_json),
      );
    }),
    getSettings: Effect.fn("ModelPreviewStore.getSettings")(function* () {
      const rows = yield* sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_model_preview_3d_settings WHERE key = 'settings'`;
      return rows[0]
        ? yield* Schema.decodeEffect(settingsJson)(rows[0].value_json)
        : DEFAULT_MODEL_PREVIEW_SETTINGS;
    }),
    updateSettings: Effect.fn("ModelPreviewStore.updateSettings")(function* (
      settings: ModelPreviewSettings,
    ) {
      yield* sql`INSERT INTO fork_model_preview_3d_settings (key,value_json) VALUES ('settings', ${yield* Schema.encodeEffect(settingsJson)(settings)}) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`;
      return settings;
    }),
    getParams: Effect.fn("ModelPreviewStore.getParams")(function* (
      projectId: string,
      path: string,
      legacyPath: string | null = null,
    ) {
      const rows = yield* sql<{
        overrides_json: string;
        parameter_set: string | null;
      }>`SELECT overrides_json, parameter_set FROM fork_model_preview_3d_params WHERE project_id = ${projectId} AND (path = ${path} OR path = ${legacyPath ?? path}) ORDER BY CASE WHEN path = ${path} THEN 0 ELSE 1 END LIMIT 1`;
      return rows[0]
        ? {
            lastUsed: yield* Schema.decodeEffect(overridesJson)(rows[0].overrides_json),
            lastUsedSet: rows[0].parameter_set,
          }
        : { lastUsed: {}, lastUsedSet: null };
    }),
    saveParams: Effect.fn("ModelPreviewStore.saveParams")(function* (
      projectId: string,
      path: string,
      overrides: Readonly<Record<string, string>>,
      set: string | null,
    ) {
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* sql`INSERT INTO fork_model_preview_3d_params (project_id,path,overrides_json,parameter_set,updated_at) VALUES (${projectId},${path},${yield* Schema.encodeEffect(overridesJson)(overrides)},${set},${now}) ON CONFLICT(project_id,path) DO UPDATE SET overrides_json = excluded.overrides_json, parameter_set = excluded.parameter_set, updated_at = excluded.updated_at`;
    }),
    sweep: Effect.fn("ModelPreviewStore.sweep")(function* (projectIds: ReadonlyArray<string>) {
      const rows = yield* sql<{
        project_id: string;
      }>`SELECT project_id FROM fork_model_preview_3d_params UNION SELECT project_id FROM fork_model_preview_3d_workspace`;
      yield* Effect.forEach(
        rows.filter((r) => !projectIds.includes(r.project_id)),
        (r) =>
          Effect.all([
            sql`DELETE FROM fork_model_preview_3d_params WHERE project_id = ${r.project_id}`,
            sql`DELETE FROM fork_model_preview_3d_workspace WHERE project_id = ${r.project_id}`,
          ]),
        { discard: true },
      );
    }),
  };
});
