import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

export const AgentReceiptsMigrations: ForkMigrationSet = {
  slug: "agent-receipts",
  migrations: [
    [
      1,
      "Receipts",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // A receipt version is visible to Library snapshots from visible_sequence (one past the
        // newest event when written) until superseded_sequence, so a snapshot at an event
        // sequence always holds the same receipts.
        yield* sql`CREATE TABLE IF NOT EXISTS fork_agent_receipts (subject_id TEXT NOT NULL, generation TEXT NOT NULL, kind TEXT NOT NULL, receipt_id TEXT NOT NULL, thread_id TEXT NOT NULL, root_thread_id TEXT NOT NULL, child_thread_id TEXT, visible_sequence INTEGER NOT NULL, superseded_sequence INTEGER, payload_json TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY (subject_id, generation, visible_sequence))`;
        yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS fork_agent_receipts_current ON fork_agent_receipts (subject_id, generation) WHERE superseded_sequence IS NULL`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_agent_receipts_thread ON fork_agent_receipts (thread_id) WHERE superseded_sequence IS NULL`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_agent_receipts_root ON fork_agent_receipts (root_thread_id, visible_sequence)`;
        yield* sql`CREATE INDEX IF NOT EXISTS fork_agent_receipts_child ON fork_agent_receipts (child_thread_id) WHERE child_thread_id IS NOT NULL AND superseded_sequence IS NULL`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_agent_receipt_state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
      }),
    ],
  ],
};
