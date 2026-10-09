import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { ProjectId, ThreadId } from "../baseSchemas.ts";

export const CODE_GRAPH_WS_METHODS = {
  status: "loom.code-graph.status",
  subscribeStatus: "loom.code-graph.subscribeStatus",
  list: "loom.code-graph.list",
  build: "loom.code-graph.build",
  cancel: "loom.code-graph.cancel",
  deleteGraph: "loom.code-graph.delete",
  summary: "loom.code-graph.summary",
  search: "loom.code-graph.search",
  neighborhood: "loom.code-graph.neighborhood",
  impact: "loom.code-graph.impact",
  setAgentTool: "loom.code-graph.setAgentTool",
  noteProjectOpened: "loom.code-graph.noteProjectOpened",
  getSettings: "loom.code-graph.getSettings",
  updateSettings: "loom.code-graph.updateSettings",
} as const;

/** The Graphify release Loom is tested with. Every install command Loom shows pins it. */
export const TESTED_GRAPHIFY_VERSION = "0.9.83";

/** Install commands for the tested release; the first is the one Loom shows by default. */
export const graphifyInstallCommands = () => [
  `uv tool install "graphifyy==${TESTED_GRAPHIFY_VERSION}"`,
  `pipx install "graphifyy==${TESTED_GRAPHIFY_VERSION}"`,
];

/** A `command` setting that runs the tested release through uv without installing it. */
export const graphifyUvxCommand = () => [
  "uvx",
  "--from",
  `graphifyy==${TESTED_GRAPHIFY_VERSION}`,
  "graphify",
];

/** Larger graph files are refused before they are read. */
export const CODE_GRAPH_MAX_GRAPH_BYTES = 100 * 1024 * 1024;

export const CodeGraphAvailability = Schema.Union([
  /** `tested` is false for any version other than TESTED_GRAPHIFY_VERSION. */
  Schema.TaggedStruct("available", { version: Schema.String, tested: Schema.Boolean }),
  Schema.TaggedStruct("missing", {
    command: Schema.Array(Schema.String),
    /** Always pins TESTED_GRAPHIFY_VERSION. */
    installHint: Schema.String,
  }),
]);
export type CodeGraphAvailability = typeof CodeGraphAvailability.Type;

export const CodeGraphBuildState = Schema.Literals(["none", "building", "ready", "failed"]);
export type CodeGraphBuildState = typeof CodeGraphBuildState.Type;

export const CodeGraphBuildMode = Schema.Literals(["update", "full", "force"]);
export type CodeGraphBuildMode = typeof CodeGraphBuildMode.Type;

export const CodeGraphStatus = Schema.Struct({
  projectId: ProjectId,
  projectName: Schema.String,
  availability: CodeGraphAvailability,
  state: CodeGraphBuildState,
  builtAt: Schema.NullOr(Schema.String),
  builtAtCommit: Schema.NullOr(Schema.String),
  graphifyVersion: Schema.NullOr(Schema.String),
  headCommit: Schema.NullOr(Schema.String),
  /** Built at another commit than HEAD. */
  stale: Schema.Boolean,
  /** Uncommitted changes in the project root since the build. */
  dirty: Schema.Boolean,
  nodeCount: Schema.Number,
  edgeCount: Schema.Number,
  graphBytes: Schema.Number,
  /** True while a build waits behind another project's build. */
  queued: Schema.Boolean,
  progress: Schema.NullOr(
    Schema.Struct({ mode: CodeGraphBuildMode, startedAt: Schema.String, lastLine: Schema.String }),
  ),
  error: Schema.NullOr(
    Schema.Struct({
      summary: Schema.String,
      detail: Schema.String,
      /** `update` refused to shrink the graph; a forced rebuild resolves it. */
      shrinkRefused: Schema.Boolean,
    }),
  ),
  /** Per project, off by default: whether loom_code_graph_query answers for this project. */
  agentTool: Schema.Boolean,
});
export type CodeGraphStatus = typeof CodeGraphStatus.Type;

export const CodeGraphNodeKind = Schema.Literals(["file", "method", "symbol"]);
export type CodeGraphNodeKind = typeof CodeGraphNodeKind.Type;

export const CodeGraphNode = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: CodeGraphNodeKind,
  /** Relative to the project root. */
  file: Schema.String,
  line: Schema.NullOr(Schema.Number),
  community: Schema.NullOr(Schema.Number),
});
export type CodeGraphNode = typeof CodeGraphNode.Type;

/** Directed: `from` calls, imports or contains `to`. */
export const CodeGraphEdge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  relation: Schema.String,
});
export type CodeGraphEdge = typeof CodeGraphEdge.Type;

export const CodeGraphSummary = Schema.Struct({
  nodeCount: Schema.Number,
  edgeCount: Schema.Number,
  fileCount: Schema.Number,
  relations: Schema.Array(Schema.Struct({ relation: Schema.String, count: Schema.Number })),
  /** Largest first, at most 30. */
  communities: Schema.Array(
    Schema.Struct({
      community: Schema.Number,
      size: Schema.Number,
      topFiles: Schema.Array(Schema.String),
    }),
  ),
  /** Most connected symbols, at most 20. */
  hubs: Schema.Array(Schema.Struct({ node: CodeGraphNode, degree: Schema.Number })),
});
export type CodeGraphSummary = typeof CodeGraphSummary.Type;

export const CodeGraphSearchResult = Schema.Struct({
  nodes: Schema.Array(CodeGraphNode),
  truncated: Schema.Boolean,
});
export type CodeGraphSearchResult = typeof CodeGraphSearchResult.Type;

export const CodeGraphNeighborhood = Schema.Struct({
  focus: CodeGraphNode,
  /** Every node within the depth, the focus excluded, nearest first. */
  nodes: Schema.Array(Schema.Struct({ node: CodeGraphNode, depth: Schema.Number })),
  /** Edges among the focus and `nodes`. */
  edges: Schema.Array(CodeGraphEdge),
  truncated: Schema.Boolean,
});
export type CodeGraphNeighborhood = typeof CodeGraphNeighborhood.Type;

export const CodeGraphImpactDepth = Schema.Literals([1, 2, 3]);
export type CodeGraphImpactDepth = typeof CodeGraphImpactDepth.Type;

export const CodeGraphImpactInput = Schema.Struct({
  projectId: ProjectId,
  /** Thread whose checkout roots the paths; defaults to the project root. */
  threadId: Schema.optional(ThreadId),
  /** Relative paths. Absent: the uncommitted changes of the thread's checkout. */
  files: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(2_000))),
  depth: Schema.optional(CodeGraphImpactDepth),
});
export type CodeGraphImpactInput = typeof CodeGraphImpactInput.Type;

export const CodeGraphImpactHit = Schema.Struct({
  node: CodeGraphNode,
  depth: Schema.Number,
  viaRelation: Schema.String,
  viaNodeId: Schema.String,
  /** The call, import or reference site in the hit's own file. */
  viaLine: Schema.NullOr(Schema.Number),
});
export type CodeGraphImpactHit = typeof CodeGraphImpactHit.Type;

export const CodeGraphImpactResult = Schema.Struct({
  seedFiles: Schema.Array(Schema.String),
  /** Changed files the graph does not know. */
  unknownFiles: Schema.Array(Schema.String),
  hits: Schema.Array(CodeGraphImpactHit),
  /** Nearest first, then by hit count. */
  files: Schema.Array(
    Schema.Struct({ file: Schema.String, minDepth: Schema.Number, hitCount: Schema.Number }),
  ),
  communities: Schema.Number,
  truncated: Schema.Boolean,
  stale: Schema.Boolean,
});
export type CodeGraphImpactResult = typeof CodeGraphImpactResult.Type;

export const CodeGraphSettings = Schema.Struct({
  /** argv that starts Graphify; Loom appends `--version`, `extract` or `update` arguments. */
  command: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(Schema.isMinLength(1)),
  /**
   * Updates existing graphs after turns that change files and when a client opens a project
   * whose graph is stale. Never builds a first graph.
   */
  autoUpdate: Schema.Boolean,
});
export type CodeGraphSettings = typeof CodeGraphSettings.Type;

export const CodeGraphSettingsPatch = Schema.Struct({
  command: Schema.optional(CodeGraphSettings.fields.command),
  autoUpdate: Schema.optional(CodeGraphSettings.fields.autoUpdate),
});
export type CodeGraphSettingsPatch = typeof CodeGraphSettingsPatch.Type;

export const DEFAULT_CODE_GRAPH_SETTINGS: CodeGraphSettings = {
  command: ["graphify"],
  autoUpdate: false,
};

export class CodeGraphError extends Schema.TaggedError<CodeGraphError>()("CodeGraphError", {
  reason: Schema.Literals([
    "graphify-missing",
    "no-graph",
    "graph-too-large",
    "graph-invalid",
    "build-running",
    "build-failed",
    "project-not-found",
    "node-not-found",
    "agent-tool-off",
  ]),
  message: Schema.String,
}) {}

const errors = Schema.Union([CodeGraphError, EnvironmentAuthorizationError]);
const M = CODE_GRAPH_WS_METHODS;
const ProjectRef = Schema.Struct({ projectId: ProjectId });

export const CodeGraphRpcGroup = RpcGroup.make(
  /** Checks for Graphify again rather than using the cached answer. */
  Rpc.make(M.status, { payload: ProjectRef, success: CodeGraphStatus, error: errors }),
  Rpc.make(M.subscribeStatus, {
    payload: ProjectRef,
    success: CodeGraphStatus,
    error: errors,
    stream: true,
  }),
  Rpc.make(M.list, {
    payload: Schema.Struct({}),
    success: Schema.Array(CodeGraphStatus),
    error: errors,
  }),
  Rpc.make(M.build, {
    payload: Schema.Struct({ projectId: ProjectId, mode: CodeGraphBuildMode }),
    success: CodeGraphStatus,
    error: errors,
  }),
  Rpc.make(M.cancel, { payload: ProjectRef, success: Schema.Void, error: errors }),
  Rpc.make(M.deleteGraph, { payload: ProjectRef, success: Schema.Void, error: errors }),
  Rpc.make(M.summary, { payload: ProjectRef, success: CodeGraphSummary, error: errors }),
  Rpc.make(M.search, {
    payload: Schema.Struct({
      projectId: ProjectId,
      query: Schema.String.check(Schema.isMaxLength(200)),
    }),
    success: CodeGraphSearchResult,
    error: errors,
  }),
  Rpc.make(M.neighborhood, {
    payload: Schema.Struct({
      projectId: ProjectId,
      nodeId: Schema.String,
      depth: Schema.optional(Schema.Literals([1, 2])),
    }),
    success: CodeGraphNeighborhood,
    error: errors,
  }),
  Rpc.make(M.impact, {
    payload: CodeGraphImpactInput,
    success: CodeGraphImpactResult,
    error: errors,
  }),
  Rpc.make(M.setAgentTool, {
    payload: Schema.Struct({ projectId: ProjectId, enabled: Schema.Boolean }),
    success: CodeGraphStatus,
    error: errors,
  }),
  Rpc.make(M.noteProjectOpened, { payload: ProjectRef, success: Schema.Void, error: errors }),
  Rpc.make(M.getSettings, {
    payload: Schema.Struct({}),
    success: CodeGraphSettings,
    error: errors,
  }),
  Rpc.make(M.updateSettings, {
    payload: CodeGraphSettingsPatch,
    success: CodeGraphSettings,
    error: errors,
  }),
);
