import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Loom tables whose rows name the live install's own resources: lane images, ports and
 * leases, run folders, evidence files and graph folders. `migrate-dev-db` leaves them empty,
 * because a dev server reconciling copied rows would stop, clean or delete those real
 * resources.
 */
export const FORK_LIVE_RESOURCE_TABLES: ReadonlyArray<string> = [
  "fork_project_lifecycle_lanes",
  "fork_apple_build_tooling_runs",
  "fork_device_qa_runs",
  "fork_device_qa_evidence",
  "fork_code_graph_projects",
];

/**
 * Creates the source's full-text tables in the copy before anything else. Each one makes the
 * internal tables that hold its index, which SQLite refuses to create or write by name, so
 * `migrate-dev-db` skips every table named in `created` and runs `rebuild` once the rows the
 * indexes read from are copied. That assumes each index reads an ordinary table, as the
 * Library's search does; one that keeps its own text would come out empty.
 */
export const createDevDbFullTextTables = Effect.fn("createDevDbFullTextTables")(function* (
  tables: ReadonlyArray<{ readonly name: string; readonly sql: string }>,
) {
  const sql = yield* SqlClient.SqlClient;
  const fullText = tables.filter((table) => /^CREATE\s+VIRTUAL\s+TABLE\b/i.test(table.sql));
  for (const table of fullText) yield* sql.unsafe(table.sql).unprepared;
  const created = yield* sql<{ name: string }>`
    SELECT name FROM main.sqlite_master WHERE type = 'table'`;
  return {
    created: new Set(created.map((row) => row.name)),
    rebuild: Effect.forEach(
      fullText,
      ({ name }) =>
        sql.unsafe(`INSERT INTO main."${name}"("${name}") VALUES ('rebuild')`).unprepared,
      { discard: true },
    ),
  };
});
