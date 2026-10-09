# L26 technical design

As built on `feat/loom-code-graph` against orchestration V2 and Graphify 0.9.83 (PyPI
`graphifyy`). Graphify's CLI parses arguments by hand and changes often; check the flags
below against a new release before raising the pinned version.

## Overview

```
                 environment server (ForkLayer)                         clients
 ┌──────────────────────────────────────────────────────────┐
 │ CodeGraphRunner   spawns `graphify --version|extract|update`│  loom.code-graph.* RPC
 │   (env scrubbed, GRAPHIFY_OUT=<state dir>)                 │ ─────────────────────▶ Code map panel
 │ CodeGraphIndex    parses graph.json into an adjacency index│                       Diff header button
 │ CodeGraphService  status, build queue, queries, impact     │                       Settings section
 │ CodeGraphStore    fork_code_graph_* tables                 │                       Palette items
 │ reactor.ts        checkpoint.captured -> auto-update       │  CodeGraphOpenWatcher (ForkRoot)
 │                   project.deleted -> forget graph          │  reports the active project
 │ <stateDir>/fork/code-graph/<encoded projectId>/            │  loom_code_graph_query (MCP)
 └──────────────────────────────────────────────────────────┘ ─────────────────────▶ agents
```

Graphify is used only as a graph builder. All queries run in TypeScript over its
`graph.json`, so answers are typed and bounded, and no Python process runs per request.

## Graphify integration

### Detection

The service runs `<command> --version` with a 60 second timeout (`uvx` may download Graphify
on first use). The command is the configured argv, default `["graphify"]`; the settings
"Use uvx" button stores `["uvx", "--from", "graphifyy==0.9.83", "graphify"]`. The answer is
cached for 60 seconds per command. The `loom.code-graph.status` RPC bypasses the cache and
notifies every subscribed project, so "Check again" and the panel's refresh button see a
fresh install. Changing the command clears the cache.

Version policy (Kyle): `TESTED_GRAPHIFY_VERSION = "0.9.83"` in
`packages/contracts/src/fork/code-graph.ts` is pinned in every command Loom shows
(`graphifyInstallCommands()` returns the `uv tool install` and `pipx install` forms,
`graphifyUvxCommand()` the uvx argv). Any other version, older or newer, still runs with
`tested: false`; safety comes from the shape check on `graph.json`, not from refusing a
version.

### Commands Loom runs

`CodeGraphRunner.buildArgv` builds argv only from a closed `GraphifyInvocation` union:

| Build mode | argv (after the configured command)                 | Notes                                                                                                                                |
| ---------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `full`     | `extract <root> --code-only --out <outDir>`         | Local tree-sitter extraction, no LLM. An `update` request for a project without a graph runs as `full`.                              |
| `update`   | `update <root>`                                     | Re-extracts changed files. Refuses to write a smaller graph; Loom detects "Refusing to overwrite" and records `shrinkRefused: true`. |
| `force`    | `extract <root> --code-only --force --out <outDir>` | "Rebuild anyway" after a refused update.                                                                                             |

Every child gets:

- `GRAPHIFY_OUT=<outDir>`. Graphify reads it once at import, so it must be in the spawn
  environment; it keeps `update` and every other writer out of `<root>/graphify-out/`.
- LLM credentials removed: any `*_API_KEY`, `OPENAI_BASE_URL` and the AWS credential and
  profile variables, so no Graphify default can spend money.
- `GRAPHIFY_NO_TIPS=1` and `PYTHONUNBUFFERED=1`, so output is plain and streams.
- `cwd` is the project root. A 20 minute timeout for builds.

`startGraphify` spawns with `node:child_process` (`shell: false`), splits stdout and stderr
into lines for progress, keeps the last 200 lines for errors, and stops only the child it
spawned (SIGTERM, then SIGKILL after 5 seconds). A spawn failure becomes an output line and
an exit of `null`, which detection reads as "missing".

### What Loom never runs

`graphify install` and the per-platform installers (they edit `CLAUDE.md`, `AGENTS.md`,
`.claude/settings.json`, `.codex/hooks.json` and similar), `graphify hook install` (git hooks,
merge driver, `.gitattributes`), `uninstall`, `watch`, `label`, `prs --triage`, `add`,
`clone`, and Graphify's MCP server. The runner cannot build their argv; a test asserts the
only first arguments are `--version`, `extract` and `update`.

### Output files

`<stateDir>/fork/code-graph/<encodeURIComponent(projectId)>/` holds Graphify's `graph.json`,
`manifest.json`, cache and analysis files. Loom reads only `graph.json`. Deleting a graph
removes the whole folder.

## graph.json and the index

Graphify writes NetworkX node-link JSON. `CodeGraphIndex.parseGraph` is the shape check: a
top-level object with `nodes` and `links` (or `edges`) arrays, every node with string `id`,
`label` and `source_file`, every link with string `source`, `target` and `relation`. Unknown
keys are ignored, links to unlisted nodes are skipped, and the first problem is named in a
`graph-invalid` message that includes the Graphify version from `graph.graphify_version`
and the pinned install command. Files over `CODE_GRAPH_MAX_GRAPH_BYTES` (100 MB) are refused
before reading.

- Every link is treated as directed, source to target, whatever `directed` says.
- Display kind is inferred: a node whose label equals its file's basename is a `file`, the
  target of a `method` link is a `method`, anything else a `symbol`. Nodes with no file (or
  `external: true`) are imported packages; they count as reachable but never appear in
  results.
- Lines come from `source_location` (`"L<n>"`).

The service keeps at most two project indexes in memory (least recently used first out),
replaced after each successful build and dropped on delete.

### Queries

- **Search**: case-insensitive on the label with or without a trailing `()`: exact, prefix,
  substring, file path, then subsequence. 50 results.
- **Neighborhood**: nodes within 1 or 2 hops in either direction, nearest first, capped at
  80, plus the edges among them.
- **Path** (agent tool only): shortest path in either direction over any relation, at most
  8 hops.
- **Impact**: a port of Graphify's reverse walk (`graphify/affected.py`). Seeds are every node
  in the changed files plus their members (`method` and `contains` targets). The walk
  follows incoming edges of `IMPACT_RELATIONS` (Graphify's `DEFAULT_AFFECTED_RELATIONS`:
  `calls`, `indirect_call`, `references`, `imports`, `imports_from`, `dynamic_import`,
  `re_exports`, `inherits`, `extends`, `implements`, `uses`, `mixes_in`, `embeds`,
  `requires`) up to depth 1 to 3 (default 2). Hits record the relation, the node they came
  through and the call or import line, sorted by depth then fan-in, capped at 300. Files are
  grouped with their minimum depth and hit count. Changed files the graph does not know are
  returned as `unknownFiles`; `communities` counts distinct communities among seeds and hits.
- **Summary**: node, edge and file counts, relation counts, the 30 largest communities with
  their top files, and the 20 most connected symbols.

### Staleness

The record stores `HEAD` and a fingerprint of the uncommitted state when a successful build
started. `stale` means `HEAD` moved since; `dirty` means the fingerprint changed (a hash of
`git status --porcelain=v1 -z --untracked-files=all` plus the size and mtime of up to 2,000
changed files). Both are cached for 30 seconds per project and dropped after a build or a
project-root turn. Impact results carry their own `stale` flag, comparing the thread
checkout's `HEAD` with the build commit.

## Build queue

`CodeGraphService` holds one `Semaphore(1)`, so one Graphify process runs per environment.
Each project has at most one waiting entry; a second request merges into it, keeping the
stronger mode (`update` < `full` < `force`). Status reports `queued: true` while waiting and
`state: "building"` with `progress` (mode, start time, last output line) while running.
Progress notifications are throttled to two per second.

Outcomes: a clean exit loads `graph.json` and becomes `ready`; a failed load (missing, too
large, wrong shape) or a non-zero exit becomes `failed` but keeps the previous build's
numbers, commit and file, so queries keep answering. Cancel removes a waiting entry or
stops the running child and restores the previous record. At startup, rows left in
`building` by a dead server are reset to `ready` (an earlier build exists) or `none`.

## Automatic updates

Off by default (`autoUpdate` in settings). `autoUpdate(projectId)` queues an `update` only
when the setting is on, nothing is queued or running for the project, a graph exists, the
graph is stale or dirty, Graphify is available, and the project has not auto-updated in the
last 2 minutes. It never builds a first graph. Two triggers call it:

- **Turns.** `reactor.ts` runs `ThreadManagementService.streamDomainEvents` and, for each
  `checkpoint.captured` event with a non-empty `payload.files`, calls
  `noteThreadChanged(threadId)`. That resolves the thread through `ProjectionStoreV2` and
  returns early when the thread has a `worktreePath`: a worktree turn leaves the project
  root, and so its graph, unchanged.
- **Opening a project.** `noteProjectOpened` (RPC) forks the check into the service scope
  and returns at once. The web `CodeGraphOpenWatcher` sends it when the active thread's
  `(environmentId, projectId)` changes, at most once per 10 minutes per pair, remembering the
  last 20 pairs in memory.

## Project deletion

`reactor.ts` reads `OrchestrationEventStore.latestApplicationSequence` at start and streams
`streamApplicationEvents({ afterSequence })`; each `project.deleted` calls `forgetProject`,
which cancels any build and removes the folder, the row and cached state. A forked
`forgetMissingProjects` catch-up removes graphs of projects that no longer resolve in
`ProjectStoreV2`, covering deletions while the server was down. No cursor table is needed.
Each stream runs under `forkParked` and logs instead of failing the layer.

## Contracts

`packages/contracts/src/fork/code-graph.ts` defines the schemas, `CodeGraphError` (reasons
`graphify-missing`, `no-graph`, `graph-too-large`, `graph-invalid`, `build-running`,
`build-failed`, `project-not-found`, `node-not-found`, `agent-tool-off`), the settings with
defaults `{ command: ["graphify"], autoUpdate: false }`, and `CodeGraphRpcGroup`, merged into
`ForkRpcGroup`. Every error union is `CodeGraphError | EnvironmentAuthorizationError`.

| Tag                                                | Kind   | Scope                   | Notes                                                                                        |
| -------------------------------------------------- | ------ | ----------------------- | -------------------------------------------------------------------------------------------- |
| `loom.code-graph.status`                           | unary  | `orchestration:read`    | Re-checks Graphify, bypassing the cache, and notifies subscribers.                           |
| `loom.code-graph.subscribeStatus`                  | stream | `orchestration:read`    | Current status, then on change. A `ForkSubscriptionRpcTag`.                                  |
| `loom.code-graph.list`                             | unary  | `orchestration:read`    | Status of every project with a stored row (settings list).                                   |
| `loom.code-graph.build`                            | unary  | `orchestration:operate` | `{ projectId, mode: "update" \| "full" \| "force" }`; returns at once, builds in background. |
| `loom.code-graph.cancel`, `loom.code-graph.delete` | unary  | `orchestration:operate` |                                                                                              |
| `summary`, `search`, `neighborhood`, `impact`      | unary  | `orchestration:read`    | Bounded answers. `impact` takes optional `threadId`, `files` (max 2,000) and `depth`.        |
| `loom.code-graph.setAgentTool`                     | unary  | `orchestration:operate` | Creates the project row (state `none`) if missing.                                           |
| `loom.code-graph.noteProjectOpened`                | unary  | `orchestration:read`    | Returns at once.                                                                             |
| `loom.code-graph.getSettings`                      | unary  | `orchestration:read`    |                                                                                              |
| `loom.code-graph.updateSettings`                   | unary  | `terminal:operate`      | The command chooses an executable the server runs.                                           |

Server scopes live in `FORK_RPC_REQUIRED_SCOPES`; client write guards (`build`, `cancel`,
`delete`, `setAgentTool`, `updateSettings`) in `FORK_CLIENT_GUARDED_RPC_SCOPES`.

## Server

`apps/server/src/fork/code-graph/`:

- `CodeGraphRunner.ts`: `buildArgv`, `graphifyEnvironment`, version parsing, shrink-refusal
  detection and `startGraphify`.
- `CodeGraphIndex.ts`: `parseGraph` and the pure queries above.
- `CodeGraphStore.ts` and `migrations.ts`: the two tables below.
- `git.ts`: `head`, `changedFiles` (paths relative to the scanned folder, using
  `rev-parse --show-prefix`) and `treeFingerprint`, through upstream's `ProcessRunner`.
- `CodeGraphService.ts`: the `Context.Service`. Resolves projects through
  `ProjectStoreV2.get` and threads (with `worktreePath`) through
  `ProjectionStoreV2.getThread`. Status subscriptions use a listener set and
  `Stream.callback` with a one-slot sliding buffer, so bursts collapse into one status read.
  Its layer provides `ProcessRunner.layer`; `ForkLayer` provides `ProjectionStore.layer` and
  `ProjectStore.layer`.
- `reactor.ts`: `CodeGraphReactorLive`, merged with the service layer in `ForkServicesLive`.
- `rpc.ts`: thin handlers, each one service call under `auth.effect` or `auth.stream`.
- `mcp.ts`: the agent tool.

## Storage

Migration set `code-graph`, id 1:

- `fork_code_graph_projects`: one row per project with workspace root, output folder, state,
  build time and commit, tree fingerprint, Graphify version, node, edge and byte counts, the
  `agent_tool` switch (default 0) and the last error as JSON.
- `fork_code_graph_settings`: a key/value table holding the settings JSON; fields added later
  take their defaults.

No foreign keys into upstream tables.

## Clients

- `packages/client-runtime/src/fork/code-graph.ts`: `createCodeGraphAtoms` with a
  subscription family for status, query families for list, summary, search, neighborhood,
  impact and settings, and commands for recheck (the status RPC), build, cancel, delete,
  setAgentTool, noteProjectOpened and updateSettings.
- `apps/web/src/fork/code-graph/`:
  - `panel.tsx`: the `ForkPanelDefinition` (id `code-graph`, title "Code map", `NetworkIcon`,
    shortcut `Y`, available with a thread and the `code-graph` feature), lazily loading
    `CodeGraphPanel.tsx`. A hidden panel renders nothing, which drops its status stream;
    builds continue on the server.
  - `viewStore.ts`: a per-thread zustand store (view, impact request, focused node), kept for
    the session while the panel is closed. `state.ts`'s `openImpact` writes the Impact view
    and the diff's files into it, then opens the single `forkPanelSurface("code-graph")`.
  - `diffHeaderAction.tsx`: `codeGraphDiffHeaderAction`, an icon button that renders null
    without a thread, files or the feature, and makes no request until clicked.
  - `NeighborhoodGraph.tsx` and `radialLayout.ts`: a static SVG, focus in the center, direct
    neighbors on an inner ring grouped by relation, second hops on an outer ring.
  - `impactSummary.ts`: Markdown of at most 40 lines (files nearest first, then the ten most
    direct symbols); `state.ts`'s `appendToComposer` adds it to the draft as its own
    paragraph.
  - `CodeGraphOpenWatcher.tsx` with `openWatcher.logic.ts`, `palette.tsx`, `settings.tsx`.

## Agent-facing tool

`loom_code_graph_query` in `mcp.ts`, registered through `FORK_MCP_TOOLKITS`:

- Parameters: `mode` (`search`, `neighbors`, `impact`, `path`), `query`, `to` (the path's
  end), `files` (impact; defaults to the thread checkout's uncommitted changes) and `depth`
  (1 to 3).
- Description, paid in every session: "Query this project's code graph built by Loom: find
  symbols, list callers and callees, trace a path, or list what changed files can affect."
- Access: `McpToolAccess.readsAsCaller`, so only an agent in a Loom thread can call it. The
  handler resolves the thread's project and fails with `agent-tool-off` unless that
  project's switch is on, `no-graph` without a graph. It never starts a build.
- Output: plain text with at most 40 lines per section and a count of what it left out,
  plus a `stale` flag. `neighbors` lists direct edges as "Uses" and "Used by".
- Annotations: title "Query the code graph", read-only, not destructive.

The tool rides on the shared `t3-code` MCP server every adapter attaches, so no adapter
changes are needed. The per-project switch cannot hide it from `tools/list`; it only makes
calls fail politely, which is why the description stays one sentence.

## Performance

- Builds run in a child process, one at a time per environment.
- `graph.json` is size-checked, then parsed once per build into the index.
- Every RPC answer is capped (50 search results, 80 neighborhood nodes, 300 impact hits, 30
  communities, 20 hubs). Nothing streams the graph.
- Status streams collapse bursts and throttle progress lines.
- The panel and diff button make no request until shown or clicked; the neighborhood SVG is
  static, with no animation.

## Alternatives considered

- **Attach Graphify's MCP server to provider sessions**: needs a seam in every adapter, adds
  about ten prose-returning tools to every session, and one shells out to `gh`. Rejected.
- **Shell out to `graphify query|affected|path` per request**: a Python start per query,
  text output to re-parse, and `query` writes a stamp file. Rejected; the traversal port is
  small.
- **Graphify output inside the repository (`graphify-out/`)**: pollutes the tree and git
  status. Rejected.
- **A graph rendering library for a whole-repository map**: a new dependency, and a force
  layout repaints continuously. Deferred.
- **Per-file impact badges in the diff file list**: a second seam in the diff views; the
  header button plus panel covers the need.
