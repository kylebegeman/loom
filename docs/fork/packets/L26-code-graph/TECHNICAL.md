# L26 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`) and to Graphify at
`Graphify-Labs/graphify@4c73561` (PyPI `graphifyy` 0.9.67). Verify Graphify flags against the
installed version before relying on them; its CLI parses arguments by hand and changes often.

## Overview

```
                 environment server (ForkLayer)                          clients
 ┌──────────────────────────────────────────────────────────┐
 │ CodeGraphRunner   spawns `graphify extract|update`        │  loom.code-graph.* RPC
 │   (ProcessRunner-like, env scrubbed, GRAPHIFY_OUT=...)    │ ─────────────────────▶ Code map panel
 │ CodeGraphIndex    loads graph.json -> adjacency index     │                       Diff "Impact" button
 │   (LRU of 2 projects, reloaded on build)                  │                       Settings section
 │ CodeGraphService  status, build queue, queries, impact    │                       Palette items
 │ CodeGraphReactor  auto-update after turns, cleanup        │  CodeGraphOpenWatcher (ForkRoot):
 │   + noteProjectOpened: auto-update a stale graph          │  reports the active project
 │ fork_code_graph_* tables, <stateDir>/fork/code-graph/...   │  loom_code_graph_query (MCP)
 └──────────────────────────────────────────────────────────┘ ─────────────────────▶ agents
```

Graphify is used only as a graph **builder**. All queries run in TypeScript over its
`graph.json`, so queries are fast, typed and bounded, and no Python process runs per request.

## Graphify integration

### Detection

`CodeGraphRunner.detect` runs `<command> --version` (timeout 10 s). The command is the
configured argv, default `["graphify"]`; users with uv but no install can set
`["uvx", "--from", "graphifyy==0.9.67", "graphify"]`. Cache the result for 60 s and on
"Check again".

Version policy (Kyle): `TESTED_GRAPHIFY_VERSION = "0.9.67"` is pinned in every install
command Loom shows (`uv tool install "graphifyy==0.9.67"`, the `uvx --from graphifyy==0.9.67`
form, and `pipx install "graphifyy==0.9.67"`). Any other version, older or newer, still runs:
status reports `available` with `tested: false`, and the UI labels it "Untested version
<x>". Safety comes from the shape check on `graph.json` (below), not from refusing a
version. A version string that does not parse is also `tested: false`.

### Commands Loom runs

| Purpose            | argv (after the configured command)                 | Notes                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full build         | `extract <root> --code-only --out <outDir>`         | Pure local AST, no API key (`graphify/cli.py:3218-3345`, `--code-only` at 3332). Clusters by default; communities keep numeric ids.                                                                                          |
| Incremental update | `update <root>`                                     | Re-extracts changed files only, no LLM (`cli.py:2403-2461`, `watch.py:1379`). Takes a per-repository lock. Refuses to shrink the graph unless forced; on a shrink refusal Loom offers "Rebuild" (full build with `--force`). |
| Forced rebuild     | `extract <root> --code-only --force --out <outDir>` | After a failed or refused update.                                                                                                                                                                                            |

Process environment for every call:

- `GRAPHIFY_OUT=<outDir>` (absolute). Graphify reads it once at import
  (`graphify/paths.py`, `GRAPHIFY_OUT = os.environ.get("GRAPHIFY_OUT", "graphify-out")`), so
  every reader, including `update` and the query stamp file (`cli.py:687-696`), writes there
  instead of `<root>/graphify-out/`. Also pass `--out <outDir>` where the command accepts it.
- LLM credentials removed as defense in depth, so a future default change cannot spend money:
  drop `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `GEMINI_API_KEY`,
  `GOOGLE_API_KEY`, `MOONSHOT_API_KEY`, `DEEPSEEK_API_KEY`, `AZURE_OPENAI_API_KEY`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` and any key matching
  `/_API_KEY$/` (backends listed in `graphify/llm.py:102-215`).
- `PYTHONUNBUFFERED=1` so progress lines stream.
- `cwd` is the project root. Timeout: 20 minutes for builds, configurable later.
- Output cap: keep the last 200 lines of stdout and stderr for status and errors.

Builds must stream progress, so they use a spawned child with line reading (Effect
`ChildProcess` from `effect/unstable/process`, as upstream's `processRunner.ts` does
internally) rather than `ProcessRunner.run`, which buffers. Cancellation kills the child PID
Loom spawned and nothing else (AGENTS.md rule 1).

### What Loom never runs

These write agent or repository configuration and are never called
(`graphify/install.py`, `graphify/hooks.py`): `graphify install`, `graphify <platform>
install` (claude, codex, opencode, cursor, gemini and the rest; they edit `CLAUDE.md`,
`AGENTS.md`, `.claude/settings.json`, `.codex/hooks.json`, `GEMINI.md`), `graphify hook
install` (git hooks, merge driver, `.gitattributes`), `graphify uninstall`, `graphify watch`,
`graphify label`, `cluster-only` without `--no-label`, `prs --triage`, `add <url>`, `clone`,
and Graphify's MCP server (`python -m graphify.serve`). A test asserts the runner only ever
builds argv starting with `extract` or `update` (plus `--version`).

### Output files

`<stateDir>/fork/code-graph/<projectId>/` holds Graphify's `graph.json`, `manifest.json`,
`cache/` and analysis files. `stateDir` comes from `ServerConfig`
(`apps/server/src/config.ts:117-131`); join paths like upstream features do. Loom reads only
`graph.json`.

## graph.json and the index

NetworkX node-link JSON written by `graphify/export.py:272-417`:

```jsonc
{
  "directed": false,
  "multigraph": false,
  "graph": {},
  "nodes": [
    {
      "id": "src_api_ts_handler",
      "label": "handler",
      "file_type": "code",
      "source_file": "src/api.ts",
      "source_location": "L24",
      "community": 3,
      "community_name": "...",
    },
  ],
  "links": [
    {
      "source": "a",
      "target": "b",
      "relation": "calls",
      "confidence": "EXTRACTED",
      "confidence_score": 1.0,
      "source_file": "src/api.ts",
      "source_location": "L30",
      "weight": 1.0,
    },
  ],
  "hyperedges": [],
  "built_at_commit": "<sha>",
}
```

- Required node fields: `id`, `label`, `file_type`, `source_file`; required link fields:
  `source`, `target`, `relation`, `confidence`, `source_file` (`graphify/validate.py:4-7`).
- No symbol-kind field. Loom infers a display kind: a node whose label equals the basename of
  its `source_file` is a `file`; a node that is the target of a `method` link is a `method`;
  otherwise `symbol`. Relations seen: `contains`, `calls`, `imports`, `imports_from`, `uses`,
  `method`, `inherits`, `implements`, `mixes_in`, `references`, `rationale_for`,
  `semantically_similar_to` (the last two only appear with LLM extraction, never with
  `--code-only`).
- Lines are start lines as `"L<n>"`; no end line or column.
- `directed: false` in the file, but relations have a direction (`source` calls `target`).
  The index treats every link as directed source to target.

Decoding: a permissive Effect Schema (unknown keys ignored, required fields checked) run on a
streamed read. This is the shape check: top level `nodes` and `links` arrays, every node with
string `id`, `label`, `source_file`, every link with string `source`, `target`, `relation`,
and optional `source_location` matching `L<n>`. A failure is `graph-invalid` with a clear
message that names the version, for example "This graph was built by Graphify 0.10.2 and
does not have the shape Loom reads (links[12] has no relation). Loom is tested with Graphify
0.9.67: uv tool install \"graphifyy==0.9.67\"". The previous good index stays loaded, and
the status keeps the failed build's error; refuse files over `MAX_GRAPH_BYTES = 100 MB` (Graphify's own cap is 512 MiB,
`graphify/security.py:32`). The index:

```ts
interface CodeGraphIndex {
  readonly projectId: ProjectId;
  readonly builtAtCommit: string | null;
  readonly nodes: ReadonlyArray<IndexedNode>;          // id, label, kind, file, line, community
  readonly byId: ReadonlyMap<string, number>;
  readonly out: ReadonlyArray<ReadonlyArray<Edge>>;    // node index -> outgoing
  readonly in: ReadonlyArray<ReadonlyArray<Edge>>;     // node index -> incoming
  readonly byFile: ReadonlyMap<string, ReadonlyArray<number>>;
  readonly labelTrigrams: ...;                          // or a sorted label array for prefix + fuzzy search
}
interface Edge { readonly to: number; readonly relation: string; readonly line: number | null; readonly confidence: string }
```

Memory: ERPNext-sized graphs (about 22.6k nodes and 48.7k links, Graphify's `BENCHMARKS.md`)
index in tens of MB. Keep at most two project indexes (LRU), dropped on rebuild or delete.

### Impact (blast radius)

A TypeScript port of Graphify's reverse traversal (`graphify/affected.py`, `affected_nodes`
at 189, `DEFAULT_AFFECTED_RELATIONS` at 10-32):

1. Seeds: every node whose `source_file` is one of the changed files (paths relative to the
   project or worktree root; renames use the new path; deleted files still seed through the
   old graph).
2. Breadth-first over **incoming** edges of Graphify's default affected relations (`calls`,
   `indirect_call`, `references`, `imports`, `imports_from`, `dynamic_import`, `re_exports`,
   `inherits`, `extends`, `implements`, `uses`, `mixes_in`, `embeds`, `requires`; copy the
   list from the pinned version into `IMPACT_RELATIONS`), up to `depth` (default 2, max 3),
   skipping nodes in the changed files themselves.
3. Result: hits `{node, depth, viaRelation, viaNode}` capped at `MAX_IMPACT_HITS = 300`,
   grouped by file with the minimum depth per file, sorted by depth then fan-in.

Graphify's `compute_pr_impact` (`graphify/prs.py:260`) counts touched communities; Loom
reports the same (distinct communities among seeds and hits).

### Neighborhood and path

- Neighborhood: outgoing and incoming edges of one node, grouped by relation and direction,
  up to `depth` 2 and 80 nodes, plus the edges among them, for the small graph.
- Path: bidirectional BFS shortest path between two nodes (undirected over relations), at
  most 8 hops, like Graphify's `shortest_path` tool.
- Search: case-insensitive prefix match first, then substring, then a subsequence match on
  labels and file paths; 50 results max.

### Staleness

`status.stale` is true when `built_at_commit` differs from `git rev-parse HEAD` in the
project root, or when `git status --porcelain` is non-empty for tracked code files. Computed
on status reads with a 30 s cache, using upstream's `GitVcsDriver` (`apps/server/src/vcs/`)
or a plain `git` call through `ProcessRunner`.

## Contracts

`packages/contracts/src/fork/code-graph.ts`:

```ts
export const CODE_GRAPH_WS_METHODS = {
  status: "loom.code-graph.status",
  subscribeStatus: "loom.code-graph.subscribeStatus",
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

export const CodeGraphAvailability = Schema.Union([
  /** tested is false for any version other than TESTED_GRAPHIFY_VERSION ("0.9.67"). */
  Schema.TaggedStruct("available", { version: Schema.String, tested: Schema.Boolean }),
  Schema.TaggedStruct("missing", {
    command: Schema.Array(Schema.String),
    installHint: Schema.String, // always pins 0.9.67
  }),
]);

export const CodeGraphBuildState = Schema.Literals(["none", "building", "ready", "failed"]);

export const CodeGraphStatus = Schema.Struct({
  projectId: ProjectId,
  availability: CodeGraphAvailability,
  state: CodeGraphBuildState,
  builtAt: Schema.NullOr(Schema.String),
  builtAtCommit: Schema.NullOr(Schema.String),
  headCommit: Schema.NullOr(Schema.String),
  stale: Schema.Boolean,
  dirty: Schema.Boolean,
  nodeCount: Schema.Number,
  edgeCount: Schema.Number,
  graphBytes: Schema.Number,
  /** True while an update waits behind another project's build. */
  queued: Schema.Boolean,
  progress: Schema.NullOr(Schema.Struct({ startedAt: Schema.String, lastLine: Schema.String })),
  error: Schema.NullOr(Schema.Struct({ summary: Schema.String, detail: Schema.String })),
  /** Per project, off by default: whether loom_code_graph_query answers for this project. */
  agentTool: Schema.Boolean,
});

export const CodeGraphNode = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(["file", "method", "symbol"]),
  file: Schema.String,
  line: Schema.NullOr(Schema.Number),
  community: Schema.NullOr(Schema.Number),
});

export const CodeGraphImpactInput = Schema.Struct({
  projectId: ProjectId,
  /** Thread whose worktree roots the paths; defaults to the project root. */
  threadId: Schema.optional(ThreadId),
  /** Relative paths. Absent: the working tree changes of the thread's checkout. */
  files: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(2_000))),
  depth: Schema.optional(Schema.Literals([1, 2, 3])),
});

export const CodeGraphImpactResult = Schema.Struct({
  seedFiles: Schema.Array(Schema.String),
  unknownFiles: Schema.Array(Schema.String), // changed files the graph does not know
  hits: Schema.Array(
    Schema.Struct({
      node: CodeGraphNode,
      depth: Schema.Number,
      viaRelation: Schema.String,
      viaNodeId: Schema.String,
    }),
  ),
  files: Schema.Array(
    Schema.Struct({ file: Schema.String, minDepth: Schema.Number, hitCount: Schema.Number }),
  ),
  communities: Schema.Number,
  truncated: Schema.Boolean,
  stale: Schema.Boolean,
});

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

export const CodeGraphSettings = Schema.Struct({
  command: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  /** Off by default. Updates existing graphs after turns that change files and when a
   * client opens a project whose graph is stale. Never builds a first graph. */
  autoUpdate: Schema.Boolean,
});
```

Summary, search and neighborhood results follow the same pattern (arrays of
`CodeGraphNode` plus edges `{ from, to, relation }`), each capped server-side.

| Tag                                                           | Kind                                    | Scope                   | Notes                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `loom.code-graph.status`                                      | unary                                   | `orchestration:read`    |                                                                                                                         |
| `loom.code-graph.subscribeStatus`                             | subscription (`ForkSubscriptionRpcTag`) | `orchestration:read`    | Emits the current status, then on change; progress lines throttled to 2 per second.                                     |
| `loom.code-graph.build`                                       | unary                                   | `orchestration:operate` | `{ projectId, mode: "update" \| "full" \| "force" }`; returns the status immediately, the build runs in the background. |
| `loom.code-graph.cancel`                                      | unary                                   | `orchestration:operate` |                                                                                                                         |
| `loom.code-graph.delete`                                      | unary                                   | `orchestration:operate` | Deletes the project's output directory and row.                                                                         |
| `loom.code-graph.summary`, `search`, `neighborhood`, `impact` | unary                                   | `orchestration:read`    |                                                                                                                         |
| `loom.code-graph.setAgentTool`                                | unary                                   | `orchestration:operate` | `{ projectId, enabled }`; creates the project row (state `none`) if missing.                                            |
| `loom.code-graph.noteProjectOpened`                           | unary                                   | `orchestration:read`    | `{ projectId }`; returns void at once. Queues an update only when `autoUpdate` is on, a graph exists, and it is stale.  |
| `loom.code-graph.getSettings`                                 | unary                                   | `orchestration:read`    |                                                                                                                         |
| `loom.code-graph.updateSettings`                              | unary                                   | `terminal:operate`      | Changing the command means choosing an executable to run on the server, so it takes the terminal-level scope.           |

Every error union is `Schema.Union([CodeGraphError, EnvironmentAuthorizationError])`.

## Server

`apps/server/src/fork/code-graph/`:

- `CodeGraphRunner.ts`: detect, spawn build or update with streamed lines, cancel. Depends on
  the platform `ChildProcessSpawner` (as upstream's `processRunner.ts` does) and
  `ServerConfig`. Pure helpers `buildArgv(mode, root, outDir)` and
  `scrubEnvironment(env)` are unit tested.
- `CodeGraphIndex.ts`: decode and index `graph.json`; `impact`, `neighborhood`, `path`,
  `search`, `summary` as pure functions over the index (the bulk of the tests).
- `CodeGraphStore.ts`: repository for the two tables (below).
- `CodeGraphService.ts`: `Context.Service` combining them: a build queue with one build at a
  time per environment (`Semaphore(1)`, Kyle's decision) and at most one queued entry per
  project (a second request for a queued project keeps its place; a manual full or force
  build replaces a queued automatic update), status `PubSub` for subscriptions (`queued`
  true while waiting), LRU of indexes, staleness. Other fork services may call its query
  methods directly (`impact`, `neighborhood`, `search`); the per-project agent switch gates
  only the MCP tool. Resolves `projectId` to `workspaceRoot` and a
  thread to its `worktreePath` through `ProjectionSnapshotQuery.getProjectShellById` /
  `getThreadShellById` (the same calls `apps/server/src/mcp/toolkits/pullRequests/handlers.ts:148-181`
  makes).
- `CodeGraphReactor.ts`: a `Layer.effectDiscard` in `ForkServicesLive`, started with
  `forkParked(...)` (`apps/server/src/serverActivation.ts:11-26`). It subscribes to
  `orchestrationEngine.streamDomainEvents` and:
  - on `thread.turn-diff-completed` (`packages/contracts/src/orchestration.ts:2084`) with
    changed files, when `autoUpdate` is on and a graph exists for the thread's project,
    queues an `update` (coalesced: at most one queued update per project, and not more often
    than every 2 minutes);
  - on `project.deleted` (`orchestration.ts:1944`) deletes the project's graph directory and
    row.
    Missing an event only means a later manual update; no cursor table is needed.
- Opening a stale project (Kyle's decision): `noteProjectOpened({ projectId })` checks
  `autoUpdate`, that a graph exists (`ready`, or `failed` with a previous `graph.json`), and
  staleness (the same 30 s cached check), then queues an `update` in the background with the
  same coalescing and 2 minute floor as the reactor. It never starts a first build and never
  waits for the build. The web sends it from `CodeGraphOpenWatcher` (Clients).
- `rpc.ts`: `makeCodeGraphRpcHandlers(auth)`, each handler
  `auth.effect(TAG, withForkRuntime(...))`.
- `mcp.ts`: the toolkit (below).
- `migrations.ts`: `CodeGraphMigrations`.

`ProcessRunner` is provided locally in upstream (`server.ts:326,392,407`), not globally; the
fork service provides its own `ProcessRunner.layer` for short git calls (stateless, safe to
provide again) and uses the child process spawner directly for builds.

## Storage

```sql
-- migration 1 (fork_migrations_code_graph)
CREATE TABLE IF NOT EXISTS fork_code_graph_projects (
  project_id        TEXT PRIMARY KEY,
  workspace_root    TEXT NOT NULL,
  out_dir           TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('none','building','ready','failed')),
  built_at          TEXT,
  built_at_commit   TEXT,
  graphify_version  TEXT,
  node_count        INTEGER NOT NULL DEFAULT 0,
  edge_count        INTEGER NOT NULL DEFAULT 0,
  graph_bytes       INTEGER NOT NULL DEFAULT 0,
  agent_tool        INTEGER NOT NULL DEFAULT 0, -- per project, off by default
  last_error_json   TEXT,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_code_graph_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

No foreign keys into upstream tables (EXTENSION-POINTS.md, Persistence). A `building` row
found at startup is reset to its previous state (`ready` if `graph.json` exists, otherwise
`none`) because the child did not survive the restart.

## Clients

- `packages/client-runtime/src/fork/code-graph.ts`: query atom families for `status`,
  `summary`, `search`, `neighborhood`, `impact`, `getSettings`; a subscription atom family for
  `subscribeStatus`; commands for `build`, `cancel`, `delete`, `updateSettings`. Labels
  `loom:code-graph:<name>`.
- `apps/web/src/fork/code-graph/`:
  - `state.ts`: web instances with `connectionAtomRuntime`.
  - `panel.tsx`: `ForkPanelDefinition` `{ id: "code-graph", title: "Code map", icon:
NetworkIcon, shortcut: "Y", isAvailable: threadRef !== null &&
loomFeatures.includes("code-graph") }`. The panel reads the thread's project from the
    thread ref.
  - `CodeGraphPanel.tsx` with tabs `OverviewTab`, `SearchTab`, `ImpactTab`, and
    `NeighborhoodGraph.tsx` (static SVG, radial layout computed once per selection: the focus
    node in the center, depth-1 nodes on a ring ordered by relation, depth-2 on an outer ring;
    no physics, no animation).
  - `impactStore.ts`: zustand, session only, `{ [threadKey]: { files, scopeLabel, requestId } }`
    written by the diff button and read by `ImpactTab`; the panel surface uses
    `forkPanelSurface("code-graph", "impact")` so the Impact tab opens as its own tab id.
  - `diffHeaderAction.tsx`: the `ext-diff-header` action (`codeGraphDiffHeaderAction`, whose
    component is `DiffImpactButton`).
  - `palette.tsx`, `settings.tsx` (settings section: Graphify command with the pinned install
    command, "Update graphs automatically", and a per-project list with size, "Let agents
    query the code graph" per project, and "Delete graph").
  - The Overview tab header shows the same per-project switch, "Let agents query the code
    graph for this project", and the version label ("Graphify 0.9.67", or "Graphify 0.10.2,
    untested version" in a warning tone).
  - `CodeGraphOpenWatcher.tsx`, a `ForkRoot` component (`ext-web-root`): reads the active
    thread's environment and project from the route and, when the project changes and the
    environment has `code-graph`, calls `noteProjectOpened` once. It remembers the last 20
    `(environmentId, projectId)` pairs it reported in memory and skips a pair reported in the
    last 10 minutes, so switching threads inside a project sends nothing. Renders nothing.
  - "Open file" uses `useRightPanelStore.getState().openFile(threadRef, file, line)`.
  - "Add to message" appends a compact Markdown list (at most 40 lines: files by depth, top
    symbols) to the thread's composer draft with `useComposerDraftStore.getState()`'s
    `getComposerDraft` and `setPrompt`, the pattern `PullRequestDetailPanel.tsx:1071-1095`
    uses.

## Agent-facing tools

One tool, `loom_code_graph_query`, in `apps/server/src/fork/code-graph/mcp.ts` registered in
`ForkMcpToolkitsLive`:

```ts
const CodeGraphQueryInput = Schema.Struct({
  mode: Schema.Literals(["search", "neighbors", "impact", "path"]),
  /** search: text; neighbors: a symbol or file label or node id; path: the start. */
  query: Schema.optional(Schema.String),
  /** path: the end. */
  target: Schema.optional(Schema.String),
  /** impact: relative paths; absent means the thread's uncommitted changes. */
  files: Schema.optional(Schema.Array(Schema.String)),
  depth: Schema.optional(Schema.Literals([1, 2, 3])),
});
```

- Description (short, it is paid for every turn): "Query this project's code graph built by
  Loom: find symbols, list callers and callees, trace a path, or list what changed files can
  affect."
- Output: plain text lines `label  kind  file:line  (relation, depth)`, capped at about
  2,000 tokens, ending with "Graph built at <sha>; stale" when stale.
- Handler reads `McpInvocationContext` (`threadId`), resolves the thread's project, and fails
  with a typed error when the project's `agent_tool` is off ("The code graph tool is off for
  this project. Turn on 'Let agents query the code graph' in the Code map panel."), Graphify
  never built a graph for the project, or the feature is missing. It never starts a build.
- The per-project switch gates calls, not listing: upstream's MCP server lists every tool to
  every session (EXTENSION-POINTS.md, section 10), so the short description is paid in every
  session whatever the switch says. That cost is why the description stays one sentence.
- If L15 (AI code review) is present, it reads impact server-side through
  `CodeGraphService.impact` for its reviewer brief, whatever the agent switch says; no agent
  queries the graph in that path.
- Annotations: `Tool.Title` "Query code graph", `Tool.Readonly` true.

## Provider decisions

The tool rides on the existing `t3-code` MCP server that every adapter attaches (Claude,
Codex, Cursor, Grok, OpenCode, Antigravity; EXTENSION-POINTS.md, MCP tools). The server is
attached whenever the session has any MCP capability, and `pull-requests` is always granted
(`apps/server/src/provider/Layers/ProviderService.ts:906-913`), so no adapter change is
needed. Verify at implementation time that a session with browser and device access off
still lists the tool.

## Performance

- Builds run in a child process, off the server's event loop; one at a time by default.
- The only large file read is `graph.json`, parsed once per build into the index.
- Every RPC answer is capped (50 search results, 80 neighborhood nodes, 300 impact hits,
  30 communities, 20 hub symbols). Nothing streams the graph.
- Status subscription payloads are small; progress lines are throttled.
- The diff button makes no request until clicked.
- The neighborhood SVG is static; no continuous animation.

## Alternatives considered

- **Attach Graphify's MCP server to provider sessions**: needs a seam in all six adapters,
  its tools return prose, it adds ten tools to every session, and `get_pr_impact` shells out
  to `gh`. Rejected.
- **Shell out to `graphify query|affected|path` per request**: a Python start per query
  (hundreds of ms), text-only output to re-parse, and `query` writes a stamp file. Rejected
  for the UI; the TS port of the traversal is small.
- **Graphify output inside the repository (`graphify-out/`)**: pollutes the user's tree and
  git status. Rejected.
- **A graph rendering library (sigma, cytoscape, d3-force)** for a whole-repo map: a new
  dependency needing approval, and a large force layout repaints continuously. Deferred.
- **Per-file impact badges in the diff file list**: a second seam in `DiffFileTree.tsx` or the
  code view; the header button plus panel covers the need.
