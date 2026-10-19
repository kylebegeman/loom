import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

export const VaultScheduledMigrations: ForkMigrationSet = {
  slug: "vault-scheduled",
  migrations: [
    [
      1,
      "MessageOwnership",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE fork_vault_scheduled_runs (
      task_id TEXT PRIMARY KEY,
      task_created_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      message_id TEXT NOT NULL,
      project_id TEXT NOT NULL
    )`;
      }),
    ],
  ],
};
