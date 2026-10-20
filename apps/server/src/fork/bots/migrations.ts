import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

export const BotsMigrations: ForkMigrationSet = {
  slug: "bots",
  migrations: [
    [
      1,
      "DefinitionsAndRuns",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_definitions (id TEXT PRIMARY KEY, version INTEGER NOT NULL, definition_json TEXT NOT NULL, scope_project_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_runs (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, bot_version INTEGER NOT NULL, bot_name TEXT NOT NULL, thread_id TEXT NOT NULL, project_id TEXT, inputs_json TEXT NOT NULL, status TEXT NOT NULL, started_by TEXT NOT NULL, caller_thread_id TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, result TEXT, result_truncated INTEGER NOT NULL DEFAULT 0, error TEXT)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_runs_bot ON fork_bots_runs (bot_id, created_at DESC)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_runs_status ON fork_bots_runs (status)`;
      }),
    ],
    [
      2,
      "Starters",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // A row means the starter was offered once; deleting the bot keeps it, so it stays deleted.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_starters (starter_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, seeded_at TEXT NOT NULL)`;
      }),
    ],
    [
      3,
      "RunNotify",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN notify INTEGER NOT NULL DEFAULT 0`;
        // Set once delivery was attempted, so a restart retries only runs it never reached.
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN notified_at TEXT`;
      }),
    ],
    [
      4,
      "RunVerdicts",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // `verdict` repeats `verdict_json.verdict` so filters and counts use the index.
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN verdict TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN verdict_json TEXT`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_runs_verdict ON fork_bots_runs (bot_id, verdict, created_at DESC)`;
      }),
    ],
  ],
};
