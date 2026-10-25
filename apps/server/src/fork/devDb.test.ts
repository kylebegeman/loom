import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrateDevDb } from "../../scripts/migrate-dev-db.ts";
import { DEV_DB_STOPPED_WORK } from "./devDb.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import { LIBRARY_SEARCH_SCHEMA } from "./project-library/LibrarySearch.ts";

const withDatabase = <A, E>(
  databasePath: string,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
) => effect.pipe(Effect.provide(NodeSqliteClient.layer({ filename: databasePath })));

it.layer(NodeServices.layer)("migrate-dev-db with Loom tables", (it) => {
  it.effect("leaves the live install's lanes behind and keeps Loom settings", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-dev-db-src-" });
      const destDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-dev-db-dest-" });
      const source = path.join(sourceDir, "userdata", "statev2.sqlite");
      yield* fs.makeDirectory(path.dirname(source), { recursive: true });
      yield* withDatabase(
        source,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runMigrations();
          yield* sql`CREATE TABLE fork_project_lifecycle_lanes (id TEXT PRIMARY KEY, lane_dir TEXT)`;
          yield* sql`INSERT INTO fork_project_lifecycle_lanes VALUES ('lane-1', '/lanes/real/main')`;
          yield* sql`CREATE TABLE fork_code_graph_settings (key TEXT PRIMARY KEY, value_json TEXT)`;
          yield* sql`INSERT INTO fork_code_graph_settings VALUES ('settings', '{}')`;
        }),
      );

      const result = yield* runMigrateDevDb(
        { baseDir: destDir, source, projects: 5, threadsPerProject: 1 },
        { sharedHome: sourceDir },
      );

      const counts = yield* withDatabase(
        result.databasePath,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const [row] = yield* sql<{ lanes: number; settings: number }>`
            SELECT
              (SELECT COUNT(*) FROM fork_project_lifecycle_lanes) AS lanes,
              (SELECT COUNT(*) FROM fork_code_graph_settings) AS settings`;
          return row;
        }),
      );
      assert.deepStrictEqual(counts, { lanes: 0, settings: 1 });
    }),
  );

  it.effect("leaves the live computer's Library history journal behind", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-dev-db-src-" });
      const destDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-dev-db-dest-" });
      const source = path.join(sourceDir, "userdata", "statev2.sqlite");
      yield* fs.makeDirectory(path.dirname(source), { recursive: true });
      yield* withDatabase(
        source,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runMigrations();
          yield* sql`CREATE TABLE fork_library_source_state (key TEXT PRIMARY KEY, environment_id TEXT)`;
          yield* sql`INSERT INTO fork_library_source_state VALUES ('host', 'live-environment')`;
          yield* sql`CREATE TABLE fork_library_source_outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, payload_json TEXT)`;
          yield* sql`INSERT INTO fork_library_source_outbox VALUES (1, '{}')`;
        }),
      );

      const result = yield* runMigrateDevDb(
        { baseDir: destDir, source, projects: 5, threadsPerProject: 1 },
        { sharedHome: sourceDir },
      );

      const counts = yield* withDatabase(
        result.databasePath,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const [row] = yield* sql<{ journal: number; outbox: number; numbering: number }>`
            SELECT
              (SELECT COUNT(*) FROM fork_library_source_state) AS journal,
              (SELECT COUNT(*) FROM fork_library_source_outbox) AS outbox,
              (SELECT COUNT(*) FROM sqlite_sequence
                WHERE name = 'fork_library_source_outbox') AS numbering`;
          return row;
        }),
      );
      assert.deepStrictEqual(counts, { journal: 0, outbox: 0, numbering: 0 });
    }),
  );

  it.effect("copies the Library's search index with the conversations it covers", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-dev-db-src-" });
      const destDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-dev-db-dest-" });
      const source = path.join(sourceDir, "userdata", "statev2.sqlite");
      yield* fs.makeDirectory(path.dirname(source), { recursive: true });
      yield* withDatabase(
        source,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runMigrations();
          for (const statement of LIBRARY_SEARCH_SCHEMA) yield* sql.unsafe(statement);
          yield* sql`INSERT INTO fork_library_search_items
            (id, library_id, position, item_id, role, occurred_at, body) VALUES
            (7, 'library-1', 0, 'item-1', 'user', '2026-10-19T00:00:00Z', 'tunnel renewal'),
            (9, 'library-1', 1, 'item-2', 'assistant', '2026-10-19T00:00:01Z', 'preview gateway')`;
        }),
      );

      const result = yield* runMigrateDevDb(
        { baseDir: destDir, source, projects: 5, threadsPerProject: 1 },
        { sharedHome: sourceDir },
      );

      const found = yield* withDatabase(
        result.databasePath,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO fork_library_search(fork_library_search) VALUES ('integrity-check')`;
          yield* sql`INSERT INTO fork_library_search_items
            (id, library_id, position, item_id, role, occurred_at, body) VALUES
            (11, 'library-2', 0, 'item-3', 'user', '2026-10-19T00:00:02Z', 'gateway smoke')`;
          const rows = yield* sql<{ rowid: number }>`
            SELECT rowid FROM fork_library_search WHERE fork_library_search MATCH 'gateway'
            ORDER BY rowid`;
          return rows.map((row) => row.rowid);
        }),
      );
      assert.deepStrictEqual(found, [9, 11]);
    }),
  );

  it.effect("keeps the developer's bot history but stops every piece of bot work", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-dev-db-src-" });
      const destDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-dev-db-dest-" });
      const source = path.join(sourceDir, "userdata", "statev2.sqlite");
      yield* fs.makeDirectory(path.dirname(source), { recursive: true });
      yield* withDatabase(
        source,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runMigrations();
          // Only the columns the copy reads; the real tables come from the Bots migrations.
          yield* sql`CREATE TABLE fork_bots_triggers
            (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, next_fire_at TEXT)`;
          yield* sql`INSERT INTO fork_bots_triggers VALUES
            ('trg_on', 1, '2026-10-24T09:00:00Z'), ('trg_off', 0, NULL)`;
          yield* sql`CREATE TABLE fork_bots_runs
            (id TEXT PRIMARY KEY, status TEXT NOT NULL, finished_at TEXT, error TEXT)`;
          yield* sql`INSERT INTO fork_bots_runs VALUES
            ('queued', 'queued', NULL, NULL),
            ('done', 'failed', '2026-10-20T00:00:00Z', 'Timed out')`;
          yield* sql`CREATE TABLE fork_bots_pipeline_runs
            (id TEXT PRIMARY KEY, status TEXT NOT NULL, error TEXT, finished_at TEXT)`;
          yield* sql`INSERT INTO fork_bots_pipeline_runs VALUES ('waiting', 'waiting', NULL, NULL)`;
          yield* sql`CREATE TABLE fork_bots_library_requests (id TEXT PRIMARY KEY, state TEXT)`;
          yield* sql`INSERT INTO fork_bots_library_requests VALUES ('request-1', 'pending')`;
        }),
      );

      const result = yield* runMigrateDevDb(
        { baseDir: destDir, source, projects: 5, threadsPerProject: 1 },
        { sharedHome: sourceDir },
      );

      const copied = yield* withDatabase(
        result.databasePath,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return {
            triggers:
              yield* sql`SELECT id, enabled, next_fire_at FROM fork_bots_triggers ORDER BY id`,
            runs: yield* sql`SELECT id, status, error FROM fork_bots_runs ORDER BY id`,
            pipelineRuns: yield* sql`SELECT status, error FROM fork_bots_pipeline_runs`,
            requests: yield* sql`SELECT id FROM fork_bots_library_requests`,
          };
        }),
      );
      assert.deepStrictEqual(copied, {
        triggers: [
          { id: "trg_off", enabled: 0, next_fire_at: null },
          { id: "trg_on", enabled: 0, next_fire_at: null },
        ],
        runs: [
          { id: "done", status: "failed", error: "Timed out" },
          { id: "queued", status: "cancelled", error: DEV_DB_STOPPED_WORK },
        ],
        pipelineRuns: [{ status: "cancelled", error: DEV_DB_STOPPED_WORK }],
        requests: [],
      });
    }),
  );
});
