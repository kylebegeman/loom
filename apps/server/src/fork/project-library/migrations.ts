import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";
import { LIBRARY_SEARCH_SCHEMA, backfillLibrarySearch } from "./LibrarySearch.ts";
import { backfillTimeline } from "./LibraryTimeline.ts";

export const ProjectLibraryMigrations: ForkMigrationSet = {
  slug: "project-library",
  migrations: [
    [
      1,
      "IndependentCatalogAndHistory",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE fork_library_projects (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, archived INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
        yield* sql`CREATE TABLE fork_library_identity (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
        yield* sql`CREATE TABLE fork_library_project_revisions (project_id TEXT NOT NULL REFERENCES fork_library_projects(id), revision INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(project_id, revision))`;
        yield* sql`CREATE TABLE fork_library_working_copies (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES fork_library_projects(id), environment_id TEXT NOT NULL, root_path TEXT NOT NULL, state TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL)`;
        yield* sql`CREATE INDEX fork_library_copies_project ON fork_library_working_copies(project_id, updated_at, id)`;
        yield* sql`CREATE TABLE fork_library_threads (library_id TEXT NOT NULL UNIQUE, source_environment_id TEXT NOT NULL, source_thread_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES fork_library_projects(id), working_copy_id TEXT, source_sequence INTEGER NOT NULL, summary_json TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(source_environment_id, source_thread_id))`;
        yield* sql`CREATE INDEX fork_library_threads_project ON fork_library_threads(project_id, updated_at DESC, source_environment_id, source_thread_id)`;
        yield* sql`CREATE TABLE fork_library_host_cursors (environment_id TEXT NOT NULL, journal_id TEXT NOT NULL, last_sequence INTEGER NOT NULL, PRIMARY KEY(environment_id, journal_id))`;
        yield* sql`CREATE TABLE fork_library_ingested_entries (environment_id TEXT NOT NULL, journal_id TEXT NOT NULL, sequence INTEGER NOT NULL, payload_digest TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(environment_id, journal_id, sequence))`;
        yield* sql`CREATE TABLE fork_library_thread_versions (library_id TEXT NOT NULL, source_sequence INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(library_id, source_sequence))`;
        yield* sql`CREATE TABLE fork_library_import_proofs (request_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)`;
        yield* sql`CREATE TABLE fork_library_source_state (key TEXT PRIMARY KEY, journal_id TEXT NOT NULL, environment_id TEXT NOT NULL, authority_id TEXT NOT NULL, authority_epoch INTEGER NOT NULL, scan_sequence INTEGER NOT NULL DEFAULT 0, acknowledged_sequence INTEGER NOT NULL DEFAULT 0)`;
        yield* sql`CREATE TABLE fork_library_source_threads (thread_id TEXT PRIMARY KEY, queued_sequence INTEGER NOT NULL, acknowledged_sequence INTEGER NOT NULL DEFAULT 0)`;
        yield* sql`CREATE TABLE fork_library_source_outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, source_sequence INTEGER NOT NULL, payload_json TEXT NOT NULL)`;
        yield* sql`CREATE TABLE fork_library_source_assets (attachment_id TEXT PRIMARY KEY, payload_digest TEXT NOT NULL, bytes INTEGER NOT NULL)`;
        yield* sql`CREATE TABLE fork_library_commands (request_id TEXT PRIMARY KEY, operation TEXT NOT NULL, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL)`;
        yield* sql`CREATE TABLE fork_library_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, aggregate_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`;
      }),
    ],
    [
      2,
      "CompressedArchivesAndIndexedHistory",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE fork_library_history_blobs (digest TEXT PRIMARY KEY, bytes BLOB NOT NULL)`;
        yield* sql`CREATE TABLE fork_library_history_headers (library_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, field TEXT NOT NULL, total_items INTEGER NOT NULL)`;
        yield* sql`CREATE TABLE fork_library_history_items (library_id TEXT NOT NULL, position INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(library_id, position))`;
      }),
    ],
    [
      3,
      "EnrolledComputers",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE fork_library_computers (environment_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL)`;
      }),
    ],
    [
      4,
      "HistorySearch",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        for (const statement of LIBRARY_SEARCH_SCHEMA) yield* sql.unsafe(statement);
        yield* backfillLibrarySearch;
      }),
    ],
    [
      5,
      "ProjectTimeline",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_library_events_aggregate ON fork_library_events(aggregate_id, sequence)`;
        yield* backfillTimeline;
      }),
    ],
  ],
};
