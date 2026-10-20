import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

export const PreviewAccessMigrations: ForkMigrationSet = {
  slug: "preview-access",
  migrations: [
    [
      1,
      "PreviewHosts",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_preview_hosts (subject TEXT PRIMARY KEY, environment_id TEXT NOT NULL, machine TEXT NOT NULL, suffix TEXT NOT NULL, updated_at TEXT NOT NULL)`;
      }),
    ],
  ],
};
