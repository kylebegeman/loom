import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  FORK_MIGRATION_SETS,
  type ForkMigrationSet,
  forkMigrationsTable,
  runForkMigrationSet,
} from "./migrations.ts";

const listTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`;
  return new Set(rows.map((row) => row.name));
});

const runAll = (sets: ReadonlyArray<ForkMigrationSet>) =>
  Effect.forEach(sets, runForkMigrationSet).pipe(Effect.map((applied) => applied.flat()));

// Exercises the runner the same way a packet's set does, independent of which packets exist.
const sampleSet: ForkMigrationSet = {
  slug: "sample-packet",
  migrations: [
    [
      1,
      "Entries",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_sample_packet_entries (id TEXT PRIMARY KEY)`;
      }),
    ],
  ],
};

describe("fork migrations", () => {
  it.effect("apply once, in their own tracking table, and create only fork_ tables", () =>
    Effect.gen(function* () {
      const sets = [...FORK_MIGRATION_SETS, sampleSet];
      const before = yield* listTables;

      const first = yield* runAll(sets);
      const second = yield* runAll(sets);
      const created = [...(yield* listTables)].filter((name) => !before.has(name));

      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual([]);
      expect(created).toContain(forkMigrationsTable("sample-packet"));
      expect(created.filter((name) => !name.startsWith("fork_"))).toEqual([]);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});
