import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Migrator from "effect/unstable/sql/Migrator";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

type ForkMigration = Effect.Effect<void, SqlError, SqlClient.SqlClient>;

/** One packet's migrations. Ids start at 1, only grow, and applied ones are never edited. */
export interface ForkMigrationSet {
  readonly slug: string;
  readonly migrations: ReadonlyArray<readonly [id: number, name: string, migration: ForkMigration]>;
}

/** One entry per packet that owns tables. */
export const FORK_MIGRATION_SETS: ReadonlyArray<ForkMigrationSet> = [
  // SnippetsMigrations,
];

export const forkMigrationsTable = (slug: string) => `fork_migrations_${slug.replaceAll("-", "_")}`;

const run = Migrator.make({});

export const runForkMigrationSet = (set: ForkMigrationSet) =>
  run({
    table: forkMigrationsTable(set.slug),
    loader: Migrator.fromRecord(
      Object.fromEntries(
        set.migrations.map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ),
    ),
  });

/** Runs every packet's pending migrations before ForkLayer builds packet services. */
export const ForkMigrationsLive = Layer.effectDiscard(
  Effect.forEach(FORK_MIGRATION_SETS, runForkMigrationSet, { discard: true }).pipe(Effect.orDie),
);
