import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

export const DeviceQaMigrations: ForkMigrationSet = {
  slug: "device-qa",
  migrations: [
    [
      1,
      "Runs",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_device_qa_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT, cwd TEXT NOT NULL, host_id TEXT NOT NULL, device_id TEXT NOT NULL, platform TEXT NOT NULL, flows_json TEXT NOT NULL, steps_json TEXT, update_baselines INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, started_by TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, run_dir TEXT NOT NULL)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_device_qa_runs_project ON fork_device_qa_runs (project_id, started_at DESC)`;
      }),
    ],
    [
      2,
      "Evidence",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_device_qa_evidence (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, host_id TEXT NOT NULL, device_id TEXT NOT NULL, platform TEXT NOT NULL, device_name TEXT NOT NULL, label TEXT, path TEXT, mime_type TEXT, size_bytes INTEGER, width INTEGER, height INTEGER, duration_ms INTEGER, detail TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_device_qa_evidence_thread ON fork_device_qa_evidence (thread_id, created_at DESC)`;
      }),
    ],
    [
      3,
      "Settings",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_device_qa_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
      }),
    ],
  ],
};
