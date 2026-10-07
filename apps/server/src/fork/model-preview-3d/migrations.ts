import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";
export const ModelPreviewMigrations: ForkMigrationSet = {
  slug: "model-preview-3d",
  migrations: [
    [
      3,
      "Workspace",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_model_preview_3d_workspace (project_id TEXT NOT NULL, path TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY (project_id, path))`;
      }),
    ],
    [
      1,
      "Params",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_model_preview_3d_params (project_id TEXT NOT NULL, path TEXT NOT NULL, overrides_json TEXT NOT NULL, parameter_set TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, path))`;
      }),
    ],
    [
      2,
      "Settings",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_model_preview_3d_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
      }),
    ],
  ],
};
