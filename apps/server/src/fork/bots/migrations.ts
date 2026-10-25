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
    [
      11,
      "Pipelines",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_pipelines (id TEXT PRIMARY KEY, version INTEGER NOT NULL, definition_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
        // `definition_json` and `versions_json` snapshot the pipeline and each step's bot at start,
        // so saving either mid-run changes nothing for the run.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_pipeline_runs (id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, pipeline_version INTEGER NOT NULL, pipeline_name TEXT NOT NULL, definition_json TEXT NOT NULL, versions_json TEXT NOT NULL, inputs_json TEXT NOT NULL, project_id TEXT, checkout_thread_id TEXT, status TEXT NOT NULL, retry_at TEXT, cursor_step_id TEXT, final_verdict TEXT, stopped_run_id TEXT, error TEXT, started_by TEXT NOT NULL, caller_runtime_mode TEXT, caller_thread_id TEXT, trigger_id TEXT, created_at TEXT NOT NULL, finished_at TEXT)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_pipeline_runs_pipeline ON fork_bots_pipeline_runs (pipeline_id, created_at DESC)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_pipeline_runs_status ON fork_bots_pipeline_runs (status)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_pipeline_attempts (pipeline_run_id TEXT NOT NULL, seq INTEGER NOT NULL, step_id TEXT NOT NULL, round INTEGER NOT NULL, state TEXT NOT NULL, bot_version INTEGER, run_id TEXT, batch_id TEXT, outcome_json TEXT, notes_json TEXT NOT NULL DEFAULT '[]', started_at TEXT, finished_at TEXT, PRIMARY KEY (pipeline_run_id, seq))`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN pipeline_run_id TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN pipeline_stopped INTEGER NOT NULL DEFAULT 0`;
        yield* sql`ALTER TABLE fork_bots_batches ADD COLUMN pipeline_run_id TEXT`;
      }),
    ],
    [
      12,
      "Anywhere",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`ALTER TABLE fork_bots_definitions ADD COLUMN library_json TEXT`;
        // Per computer and never synced: the Library only sees slot names.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_vault_bindings (bot_id TEXT NOT NULL, slot TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY (bot_id, slot))`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN target_environment_id TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN remote_request_id TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN ran_on_json TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN requested_by_json TEXT`;
        // The highest result seq the target has posted for a remote request it ran.
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN remote_reported INTEGER NOT NULL DEFAULT 0`;
        // A redelivered request finds the run it already started.
        yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS fork_bots_runs_remote_request ON fork_bots_runs (remote_request_id) WHERE remote_request_id IS NOT NULL`;
        // Each item resolves its own computer, so a `best` batch spreads over the ready ones.
        yield* sql`ALTER TABLE fork_bots_batches ADD COLUMN target_json TEXT`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_library_cursor (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
        // Library side: created everywhere, used only on the authority.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_library_bots (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, seq INTEGER NOT NULL, definition_json TEXT, project_id TEXT, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_library_bots_seq ON fork_bots_library_bots (seq)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_library_status (environment_id TEXT PRIMARY KEY, report_json TEXT NOT NULL, reported_at TEXT NOT NULL)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_library_requests (id TEXT PRIMARY KEY, from_env TEXT NOT NULL, target_env TEXT NOT NULL, message_json TEXT NOT NULL, state TEXT NOT NULL, leased_until TEXT, created_at TEXT NOT NULL, delivered_at TEXT)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_library_requests_target ON fork_bots_library_requests (target_env, state, created_at)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_bots_library_results (request_id TEXT NOT NULL, seq INTEGER NOT NULL, to_env TEXT NOT NULL, update_json TEXT NOT NULL, leased_until TEXT, created_at TEXT NOT NULL, acked_at TEXT, PRIMARY KEY (request_id, seq))`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_bots_library_results_to ON fork_bots_library_results (to_env, acked_at, created_at)`;
      }),
    ],
    [
      13,
      "BatchTriggers",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // A trigger's batch frames its items as untrusted, also when a restart resumes it.
        yield* sql`ALTER TABLE fork_bots_batches ADD COLUMN trigger_id TEXT`;
      }),
    ],
    [
      14,
      "TriggerFiringTargets",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // A firing that starts a pipeline or a batch has no bot run of its own to link.
        yield* sql`ALTER TABLE fork_bots_trigger_firings ADD COLUMN pipeline_run_id TEXT`;
        yield* sql`ALTER TABLE fork_bots_trigger_firings ADD COLUMN batch_id TEXT`;
      }),
    ],
    [
      15,
      "RunOutcomes",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // notified_at also marks a delivery that failed; this is set only when the result arrived.
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN delivered_at TEXT`;
        yield* sql`ALTER TABLE fork_bots_runs ADD COLUMN failure_class TEXT`;
        // A failed delivery appended its reason to the error, so a run without one arrived.
        yield* sql`UPDATE fork_bots_runs SET delivered_at = notified_at WHERE notify = 1 AND notified_at IS NOT NULL AND caller_thread_id IS NOT NULL AND (error IS NULL OR instr(error, 'Result delivery failed:') = 0)`;
      }),
    ],
  ],
};
