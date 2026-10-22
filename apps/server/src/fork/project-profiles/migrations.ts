import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";
export const ProjectProfilesMigrations: ForkMigrationSet = {
  slug: "project-profiles",
  migrations: [
    [
      1,
      "ProjectProfiles",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE fork_project_profiles_profiles (project_id TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
        yield* sql`CREATE TABLE fork_project_profiles_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
        yield* sql`CREATE TABLE fork_project_profiles_turn_usage (turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, project_id TEXT NOT NULL, tokens INTEGER NOT NULL, sequence INTEGER NOT NULL)`;
        yield* sql`CREATE INDEX fork_project_profiles_turn_usage_thread ON fork_project_profiles_turn_usage(thread_id)`;
        yield* sql`CREATE TABLE fork_project_profiles_thread_usage (thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, tokens INTEGER NOT NULL)`;
        yield* sql`CREATE TABLE fork_project_profiles_daily_usage (project_id TEXT NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL, PRIMARY KEY(project_id,day))`;
        yield* sql`CREATE TABLE fork_project_profiles_budget_alerts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, message TEXT NOT NULL, day TEXT, published INTEGER NOT NULL DEFAULT 0)`;
      }),
    ],
  ],
};
