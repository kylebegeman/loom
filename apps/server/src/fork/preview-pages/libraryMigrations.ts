import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

/** Library-side page storage. The HTML lives here, not in object storage, so purging deletes it. */
export const PreviewPagesMigrations: ForkMigrationSet = {
  slug: "preview-pages",
  migrations: [
    [
      1,
      "PreviewPages",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_preview_pages (id TEXT PRIMARY KEY, subject TEXT NOT NULL, environment_id TEXT NOT NULL, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, html BLOB NOT NULL, size_bytes INTEGER NOT NULL, kept INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT, ended_at TEXT)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_preview_pages_subject ON fork_preview_pages (subject)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_preview_page_replies (reply_id TEXT PRIMARY KEY, page_id TEXT NOT NULL, subject TEXT NOT NULL, text TEXT NOT NULL, viewer TEXT NOT NULL, created_at TEXT NOT NULL, leased_until TEXT, acked_at TEXT, outcome TEXT, detail TEXT)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_preview_page_replies_subject_acked ON fork_preview_page_replies (subject, acked_at)`;
      }),
    ],
  ],
};
