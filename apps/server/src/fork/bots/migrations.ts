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
    [
      7,
      "RunUsage",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN input_tokens INTEGER`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN cached_input_tokens INTEGER`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN output_tokens INTEGER`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN usage_status TEXT`;
        // The token budget sums a bot's runs by when they finished.
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_runs_finished ON fork_bots_runs (bot_id, finished_at)`;
      }),
    ],
    [
      8,
      "Suggestions",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // An empty shape key marks a thread seen but not counted, so it is never read twice.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_brief_threads (thread_id TEXT PRIMARY KEY, shape_key TEXT NOT NULL, created_at TEXT NOT NULL)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_brief_threads_created ON fork_bots_brief_threads (created_at)`;
        // `entries_json` holds the 14-day window, newest first; `total_count` counts every thread.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_brief_shapes (shape_key TEXT PRIMARY KEY, shape TEXT NOT NULL, entries_json TEXT NOT NULL, total_count INTEGER NOT NULL, last_seen_at TEXT NOT NULL)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_brief_shapes_seen ON fork_bots_brief_shapes (last_seen_at)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_suggestions (shape_key TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, dismissed_at TEXT, dismissed_total INTEGER NOT NULL DEFAULT 0, reopened INTEGER NOT NULL DEFAULT 0)`;
      }),
    ],
    [
      9,
      "Triggers",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_triggers (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, trigger_json TEXT NOT NULL, enabled INTEGER NOT NULL, pinned_version INTEGER NOT NULL, follow_latest INTEGER NOT NULL, created_by TEXT NOT NULL, creator_runtime_mode TEXT, webhook_token TEXT, webhook_secret TEXT, next_fire_at TEXT, last_fired_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_triggers_bot ON fork_bots_triggers (bot_id)`;
        // The unique key is the dedupe: one event fires a trigger once, however often it is seen.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_trigger_firings (id TEXT PRIMARY KEY, trigger_id TEXT NOT NULL, event_key TEXT NOT NULL, event_summary TEXT NOT NULL, fired_at TEXT NOT NULL, outcome TEXT NOT NULL, run_id TEXT, reason TEXT, UNIQUE(trigger_id, event_key))`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_trigger_firings_fired ON fork_bots_trigger_firings (trigger_id, fired_at DESC)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_trigger_cursors (event_type TEXT PRIMARY KEY, after_sequence INTEGER NOT NULL)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_trigger_pr_state (pr_key TEXT PRIMARY KEY, checks_state TEXT, head_sha TEXT, seen_open INTEGER NOT NULL, updated_at TEXT NOT NULL)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_trigger_pr_state_updated ON fork_bots_trigger_pr_state (updated_at)`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN trigger_id TEXT`;
      }),
    ],
    [
      10,
      "Versions",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Rows outlive their definition, so a deleted bot's runs stay readable and numbering
        // continues when its id is reused.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_versions (bot_id TEXT NOT NULL, version INTEGER NOT NULL, definition_json TEXT NOT NULL, saved_by TEXT NOT NULL, saved_at TEXT NOT NULL, changed_json TEXT NOT NULL, restored_from INTEGER, PRIMARY KEY (bot_id, version))`;
        yield* sql`ALTER TABLE fork_bots_definitions ADD COLUMN stable_version INTEGER`;
        // Earlier versions were never stored; history starts at each bot's current one.
        yield* sql`INSERT OR IGNORE INTO fork_bots_versions (bot_id, version, definition_json, saved_by, saved_at, changed_json, restored_from) SELECT id, version, definition_json, created_by, updated_at, '[]', NULL FROM fork_bots_definitions`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_replays (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, source_json TEXT NOT NULL, draft_json TEXT, base_version INTEGER NOT NULL, status TEXT NOT NULL, started_by TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_replays_bot ON fork_bots_replays (bot_id, created_at DESC)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_replay_items (replay_id TEXT NOT NULL, original_run_id TEXT NOT NULL, position INTEGER NOT NULL, replay_run_id TEXT, comparison TEXT NOT NULL, reason TEXT, PRIMARY KEY (replay_id, original_run_id))`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN replay_id TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN rating TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN note TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN rated_at TEXT`;
        // Version stats group a bot's runs by version.
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_runs_version ON fork_bots_runs (bot_id, bot_version)`;
      }),
    ],
  ],
};
