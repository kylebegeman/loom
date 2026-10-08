import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

export const ProjectLifecycleMigrations: ForkMigrationSet = {
  slug: "project-lifecycle",
  migrations: [
    [
      1,
      "SettingsAndLanes",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_project_lifecycle_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_project_lifecycle_lanes (id TEXT PRIMARY KEY, checkout_path TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, project_name TEXT NOT NULL, name TEXT NOT NULL, lane_dir TEXT NOT NULL, backend TEXT NOT NULL, cap_bytes INTEGER NOT NULL, device TEXT, created_at TEXT NOT NULL)`;
      }),
    ],
  ],
};
