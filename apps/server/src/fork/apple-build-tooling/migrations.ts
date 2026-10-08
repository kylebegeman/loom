import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

export const AppleBuildToolingMigrations: ForkMigrationSet = {
  slug: "apple-build-tooling",
  migrations: [
    [
      1,
      "Runs",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_apple_build_tooling_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT, cwd TEXT NOT NULL, kind TEXT NOT NULL, request_json TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, started_by TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, exit_code INTEGER, command_line TEXT NOT NULL, error_count INTEGER NOT NULL DEFAULT 0, warning_count INTEGER NOT NULL DEFAULT 0, failed_test_count INTEGER NOT NULL DEFAULT 0, summary_json TEXT, run_dir TEXT NOT NULL, result_bundle_path TEXT)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_apple_build_tooling_runs_project ON fork_apple_build_tooling_runs (project_id, started_at DESC)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_apple_build_tooling_runs_cwd ON fork_apple_build_tooling_runs (cwd, started_at DESC)`;
      }),
    ],
    [
      2,
      "Settings",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_apple_build_tooling_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
      }),
    ],
  ],
};
