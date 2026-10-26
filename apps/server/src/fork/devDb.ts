import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Loom tables whose rows name the live install's own resources: lane images, ports and
 * leases, run folders, evidence files and graph folders. `migrate-dev-db` leaves them empty,
 * because a dev server reconciling copied rows would stop, clean or delete those real
 * resources. The Library history journal belongs to the live computer and its Library too: a
 * dev server has its own environment id, so a copied journal fails its fence on every pass and
 * the dev server never publishes history. Left empty, with its numbering, it starts a journal of
 * its own whose first entry is the 1 a new journal must begin with.
 */
export const FORK_LIVE_RESOURCE_TABLES: ReadonlyArray<string> = [
  "fork_project_lifecycle_lanes",
  "fork_apple_build_tooling_runs",
  "fork_device_qa_runs",
  "fork_device_qa_evidence",
  "fork_code_graph_projects",
  "fork_library_source_state",
  "fork_library_source_outbox",
  "fork_library_source_threads",
  "fork_library_source_baselines",
  "fork_library_source_activity",
  "fork_library_source_assets",
];

/** Why a copied run, batch or pipeline run stopped, as its run history shows it. */
export const DEV_DB_STOPPED_WORK = "Stopped when this development database was copied.";

/**
 * Bot work a dev server would take up by itself: triggers fire on their schedule, unfinished runs,
 * batches, pipeline runs and replays resume after a start, and remote run requests are delivered.
 * The copy keeps all of it as history but stops it, so a dev server never runs the developer's
 * bots unasked. A trigger stays visible, paused.
 */
export const stopCopiedBotWork = Effect.fn("stopCopiedBotWork")(function* (stoppedAt: string) {
  const sql = yield* SqlClient.SqlClient;
  const present = new Set(
    (yield* sql<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'fork_bots_%'`).map(
      (row) => row.name,
    ),
  );
  const stops = [
    [
      "fork_bots_triggers",
      sql`UPDATE fork_bots_triggers SET enabled = 0, next_fire_at = NULL WHERE enabled <> 0`,
    ],
    [
      "fork_bots_runs",
      sql`UPDATE fork_bots_runs
        SET status = 'cancelled', finished_at = ${stoppedAt},
          error = COALESCE(error, ${DEV_DB_STOPPED_WORK})
        WHERE status IN ('queued', 'running')`,
    ],
    [
      "fork_bots_batches",
      sql`UPDATE fork_bots_batches SET status = 'cancelled', finished_at = ${stoppedAt}
        WHERE status = 'running'`,
    ],
    [
      "fork_bots_pipeline_runs",
      sql`UPDATE fork_bots_pipeline_runs
        SET status = 'cancelled', finished_at = ${stoppedAt},
          error = COALESCE(error, ${DEV_DB_STOPPED_WORK})
        WHERE status IN ('running', 'waiting')`,
    ],
    [
      "fork_bots_replays",
      sql`UPDATE fork_bots_replays SET status = 'cancelled', finished_at = ${stoppedAt}
        WHERE status = 'running'`,
    ],
    ["fork_bots_library_requests", sql`DELETE FROM fork_bots_library_requests`],
    ["fork_bots_library_results", sql`DELETE FROM fork_bots_library_results`],
  ] as const;
  for (const [table, stop] of stops) if (present.has(table)) yield* stop;
});

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
      // A contentless index keeps no text to rebuild from; its owner refills it, as
      // rebuildMessageSearch does for message search.
      fullText.filter((table) => !/\bcontent\s*=\s*''/i.test(table.sql)),
      ({ name }) =>
        sql.unsafe(`INSERT INTO main."${name}"("${name}") VALUES ('rebuild')`).unprepared,
      { discard: true },
    ),
  };
});
