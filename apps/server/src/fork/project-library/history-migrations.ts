import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

export const LibraryHistoryMigrations: ForkMigrationSet = {
  slug: "library-history",
  migrations: [
    [
      1,
      "SourceDeltaBaselines",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_library_source_baselines (thread_id TEXT PRIMARY KEY, bytes BLOB NOT NULL)`;
        const columns = yield* sql<{ name: string }>`PRAGMA table_info(fork_library_source_outbox)`;
        if (!columns.some((column) => column.name === "wire_json"))
          yield* sql`ALTER TABLE fork_library_source_outbox ADD COLUMN wire_json TEXT`;
      }),
    ],
  ],
};
