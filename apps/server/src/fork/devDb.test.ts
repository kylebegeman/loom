import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrateDevDb } from "../../scripts/migrate-dev-db.ts";
import { runMigrations } from "../persistence/Migrations.ts";

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
});
