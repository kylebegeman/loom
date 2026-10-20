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
    [
      5,
      "Batches",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // `definition_json` pins the version the batch started with, so a mid-batch save changes nothing.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_batches (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, bot_version INTEGER NOT NULL, bot_name TEXT NOT NULL, definition_json TEXT NOT NULL, project_id TEXT, checkout_thread_id TEXT, source_json TEXT NOT NULL, source_summary TEXT NOT NULL, item_parameter TEXT, shared_inputs_json TEXT NOT NULL, status TEXT NOT NULL, note TEXT, started_by TEXT NOT NULL, caller_thread_id TEXT, created_at TEXT NOT NULL, finished_at TEXT)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_batches_bot ON fork_bots_batches (bot_id, created_at DESC)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_batches_status ON fork_bots_batches (status)`;
        // An item has no run row until the batch starts it, so a restart cannot lose a waiting item.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_batch_items (batch_id TEXT NOT NULL, item_index INTEGER NOT NULL, label TEXT NOT NULL, inputs_json TEXT NOT NULL, state TEXT NOT NULL, run_id TEXT, previous_run_ids_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (batch_id, item_index))`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN batch_id TEXT`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_runs_batch ON fork_bots_runs (batch_id)`;
      }),
    ],
    [
      6,
      "RunInbox",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN dismissed_at TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN retry_of TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN retried_by TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN promoted_thread_id TEXT`;
        // What ran, so a retry, usage and replay never read a definition edited since.
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN model_selection_json TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN checkout_thread_id TEXT`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_runs_inbox ON fork_bots_runs (status, dismissed_at, created_at DESC)`;
      }),
    ],
  ],
};
