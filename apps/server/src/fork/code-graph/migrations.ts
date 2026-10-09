import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../persistence/migrations.ts";

export const CodeGraphMigrations: ForkMigrationSet = {
  slug: "code-graph",
  migrations: [
    [
      1,
      "Projects",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_code_graph_projects (project_id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL, out_dir TEXT NOT NULL, state TEXT NOT NULL, built_at TEXT, built_at_commit TEXT, tree_fingerprint TEXT, graphify_version TEXT, node_count INTEGER NOT NULL DEFAULT 0, edge_count INTEGER NOT NULL DEFAULT 0, graph_bytes INTEGER NOT NULL DEFAULT 0, agent_tool INTEGER NOT NULL DEFAULT 0, last_error_json TEXT, updated_at TEXT NOT NULL)`;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_code_graph_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
      }),
    ],
  ],
};
