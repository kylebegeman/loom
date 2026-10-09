import {
  CodeGraphBuildState,
  CodeGraphSettings,
  CodeGraphSettingsPatch,
  DEFAULT_CODE_GRAPH_SETTINGS,
  type CodeGraphStatus,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export type GraphError = NonNullable<CodeGraphStatus["error"]>;

/** One project's graph as stored. The status adds availability, staleness and progress. */
export interface GraphRecord {
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly outDir: string;
  readonly state: CodeGraphBuildState;
  readonly builtAt: string | null;
  /** HEAD when the last good build started; Graphify leaves graph.json alone when nothing changed. */
  readonly builtAtCommit: string | null;
  /** Uncommitted changes at that build, to tell when they changed since. */
  readonly treeFingerprint: string | null;
  readonly graphifyVersion: string | null;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly graphBytes: number;
  readonly agentTool: boolean;
  readonly error: GraphError | null;
  readonly updatedAt: string;
}

interface Row {
  readonly project_id: string;
  readonly workspace_root: string;
  readonly out_dir: string;
  readonly state: string;
  readonly built_at: string | null;
  readonly built_at_commit: string | null;
  readonly tree_fingerprint: string | null;
  readonly graphify_version: string | null;
  readonly node_count: number;
  readonly edge_count: number;
  readonly graph_bytes: number;
  readonly agent_tool: number;
  readonly last_error_json: string | null;
  readonly updated_at: string;
}

const ErrorJson = Schema.fromJsonString(
  Schema.Struct({ summary: Schema.String, detail: Schema.String, shrinkRefused: Schema.Boolean }),
);
const decodeError = Schema.decodeUnknownOption(ErrorJson);
const encodeError = Schema.encodeSync(ErrorJson);
const encodeSettings = Schema.encodeSync(Schema.fromJsonString(CodeGraphSettings));
const decodeStoredSettings = Schema.decodeUnknownOption(
  Schema.fromJsonString(CodeGraphSettingsPatch),
);
const isState = Schema.is(CodeGraphBuildState);

/** A patch over settings; fields left out or undefined keep their value. */
export const mergeSettings = (
  base: CodeGraphSettings,
  patch: CodeGraphSettingsPatch | undefined,
): CodeGraphSettings => ({
  ...base,
  ...Object.fromEntries(Object.entries(patch ?? {}).filter((entry) => entry[1] !== undefined)),
});

const toRecord = (row: Row): GraphRecord => ({
  projectId: row.project_id,
  workspaceRoot: row.workspace_root,
  outDir: row.out_dir,
  // A state written by a future version reads as no graph rather than failing.
  state: isState(row.state) ? row.state : "none",
  builtAt: row.built_at,
  builtAtCommit: row.built_at_commit,
  treeFingerprint: row.tree_fingerprint,
  graphifyVersion: row.graphify_version,
  nodeCount: Number(row.node_count),
  edgeCount: Number(row.edge_count),
  graphBytes: Number(row.graph_bytes),
  agentTool: Number(row.agent_tool) === 1,
  error: row.last_error_json === null ? null : Option.getOrNull(decodeError(row.last_error_json)),
  updatedAt: row.updated_at,
});

export const makeCodeGraphStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return {
    get: Effect.fn("CodeGraphStore.get")(function* (projectId: string) {
      const rows =
        yield* sql<Row>`SELECT * FROM fork_code_graph_projects WHERE project_id = ${projectId}`;
      return rows[0] ? toRecord(rows[0]) : null;
    }),

    list: Effect.fn("CodeGraphStore.list")(function* () {
      const rows = yield* sql<Row>`SELECT * FROM fork_code_graph_projects ORDER BY project_id`;
      return rows.map(toRecord);
    }),

    save: Effect.fn("CodeGraphStore.save")(function* (record: GraphRecord) {
      const error = record.error === null ? null : encodeError(record.error);
      yield* sql`INSERT INTO fork_code_graph_projects (project_id,workspace_root,out_dir,state,built_at,built_at_commit,tree_fingerprint,graphify_version,node_count,edge_count,graph_bytes,agent_tool,last_error_json,updated_at) VALUES (${record.projectId},${record.workspaceRoot},${record.outDir},${record.state},${record.builtAt},${record.builtAtCommit},${record.treeFingerprint},${record.graphifyVersion},${record.nodeCount},${record.edgeCount},${record.graphBytes},${record.agentTool ? 1 : 0},${error},${record.updatedAt}) ON CONFLICT(project_id) DO UPDATE SET workspace_root = excluded.workspace_root, out_dir = excluded.out_dir, state = excluded.state, built_at = excluded.built_at, built_at_commit = excluded.built_at_commit, tree_fingerprint = excluded.tree_fingerprint, graphify_version = excluded.graphify_version, node_count = excluded.node_count, edge_count = excluded.edge_count, graph_bytes = excluded.graph_bytes, agent_tool = excluded.agent_tool, last_error_json = excluded.last_error_json, updated_at = excluded.updated_at`;
      return record;
    }),

    delete: Effect.fn("CodeGraphStore.delete")(function* (projectId: string) {
      yield* sql`DELETE FROM fork_code_graph_projects WHERE project_id = ${projectId}`;
    }),

    /**
     * Builds the previous server left running died with it. A project with an earlier good
     * build is ready again; Graphify writes graph.json atomically, so that file is intact.
     */
    resetBuilding: Effect.fn("CodeGraphStore.resetBuilding")(function* (updatedAt: string) {
      yield* sql`UPDATE fork_code_graph_projects SET state = CASE WHEN built_at IS NULL THEN 'none' ELSE 'ready' END, updated_at = ${updatedAt} WHERE state = 'building'`;
    }),

    getSettings: Effect.fn("CodeGraphStore.getSettings")(function* () {
      const rows = yield* sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_code_graph_settings WHERE key = 'settings'`;
      // Fields added later take their defaults.
      const stored = rows[0]
        ? Option.getOrUndefined(decodeStoredSettings(rows[0].value_json))
        : undefined;
      return mergeSettings(DEFAULT_CODE_GRAPH_SETTINGS, stored);
    }),

    updateSettings: Effect.fn("CodeGraphStore.updateSettings")(function* (
      settings: CodeGraphSettings,
    ) {
      yield* sql`INSERT INTO fork_code_graph_settings (key,value_json) VALUES ('settings', ${encodeSettings(settings)}) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`;
      return settings;
    }),
  };
});

export type CodeGraphStore = Effect.Success<typeof makeCodeGraphStore>;
