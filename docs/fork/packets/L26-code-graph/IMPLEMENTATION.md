# L26 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder.
- Install Graphify on the dev machine: `uv tool install "graphifyy==0.9.67"`. Run
  `graphify extract <small repo> --code-only --out "$scratch"` with `GRAPHIFY_OUT="$scratch"`
  (a directory from `scratch=$(mktemp -d)`, outside the worktree) by hand once and confirm: the
  flags are accepted, nothing is written inside the repository, no network access happens
  (watch with Little Snitch or `nettop` if unsure), and `graph.json` matches TECHNICAL.
  Check `graphify update <repo>` the same way. Copy a small real `graph.json` (a few hundred
  nodes, from a fork-owned or public repository) into the test fixtures.
- Seed the worktree `.t3` with real data for the manual pass (AGENTS.md, "Test data"). Never
  point a server at `~/.t3/userdata`.

## File layout

```
packages/contracts/src/fork/code-graph.ts
packages/client-runtime/src/fork/code-graph.ts
apps/server/src/fork/code-graph/
  migrations.ts  CodeGraphStore.ts  CodeGraphRunner.ts  CodeGraphIndex.ts
  CodeGraphService.ts  CodeGraphReactor.ts  rpc.ts  mcp.ts
  __fixtures__/graph.small.json
  *.test.ts
apps/web/src/fork/code-graph/
  state.ts  panel.tsx  CodeGraphPanel.tsx  OverviewTab.tsx  SearchTab.tsx  ImpactTab.tsx
  NeighborhoodGraph.tsx  impactStore.ts  DiffImpactButton.tsx  palette.tsx  settings.tsx
  radialLayout.ts  impactSummary.ts  *.test.ts
docs/fork/user/code-graph.md
```

## Steps

1. **Extension points.** Existence checks for `ext-core`, `ext-panels`, `ext-mcp`,
   `ext-settings`, `ext-palette`; create missing ones exactly as specified, one commit each.
2. **Contracts.** `code-graph.ts` as sketched in TECHNICAL: schemas, `CodeGraphError`,
   `CODE_GRAPH_WS_METHODS`, `CodeGraphRpcGroup`. Streaming tag
   `loom.code-graph.subscribeStatus` goes into `ForkSubscriptionRpcTag`. Register the group
   and exports in `fork/rpc.ts` and `fork/index.ts`. Typecheck contracts, server, web,
   client-runtime and mobile.
3. **Index first (pure).** `CodeGraphIndex.ts`: decode, index, `search`, `neighborhood`,
   `path`, `impact`, `summary`, kind inference. Test against the fixture before any process or
   database code exists.
4. **Storage.** `migrations.ts` (`CodeGraphMigrations`, slug `code-graph`, id 1) registered in
   `FORK_MIGRATION_SETS`; `CodeGraphStore.ts` repository following
   `apps/server/src/persistence/Layers/OrchestrationCommandReceipts.ts:16-90`.
5. **Runner.** `CodeGraphRunner.ts`: `detect`, `buildArgv`, `scrubEnvironment`, `start` (spawn
   with streamed lines, returns a handle with `lines`, `exit`, `cancel`). Spawn through the
   platform `ChildProcessSpawner` with `resolveSpawnCommand` from `@t3tools/shared/shell` as
   `apps/server/src/processRunner.ts` does, so Windows and PATH resolution behave like
   upstream. Kill only the spawned child.
6. **Service.** `CodeGraphService.ts`: settings (defaults `{ command: ["graphify"],
autoUpdateAfterTurns: false, agentTool: false }` unless Kyle decides otherwise), status and
   staleness, the build queue (`Effect.Semaphore` of 1, per-project dedupe), status `PubSub`,
   index LRU, project and thread resolution through `ProjectionSnapshotQuery`, startup reset
   of stale `building` rows. Add `CodeGraphService` to `ForkServices` and its layer to
   `ForkServicesLive`; append `"code-graph"` to `LOOM_SERVER_FEATURES`.
7. **Reactor.** `CodeGraphReactor.ts` with `forkParked`, coalesced auto-update on
   `thread.turn-diff-completed`, cleanup on `project.deleted`.
8. **RPC handlers.** `rpc.ts` spread into `ForkRpcGroup.of`, scopes added to
   `FORK_RPC_REQUIRED_SCOPES` as in the TECHNICAL table.
9. **MCP tool.** `mcp.ts` (`CodeGraphToolkitRegistrationLive`) appended to
   `ForkMcpToolkitsLive`. Non-empty parameters struct (EXTENSION-POINTS.md warns an empty one
   makes some providers drop every tool).
10. **Client runtime.** Atom families and commands in `client-runtime/src/fork/code-graph.ts`,
    exported from the fork index.
11. **Web panel.** `panel.tsx` registered in `FORK_PANELS` (shortcut `Y`); tabs; static SVG
    neighborhood with a pure `radialLayout` (tested); "Open file" and "Add to message".
12. **Diff header action.** Run the `ext-diff-header` existence check and create it if
    missing (own commit, EXTENSION-POINTS.md section 17). Then `impactStore.ts` and
    `DiffImpactButton.tsx`, and register `codeGraphDiffHeaderAction` in
    `FORK_DIFF_HEADER_ACTIONS` ([SEAMS.md](./SEAMS.md)).
13. **Palette and settings.** `palette.tsx` in `FORK_COMMAND_PALETTE_SOURCES` (values
    `action:loom:code-graph:open`, `:impact`, `:rebuild`); `settings.tsx` in
    `FORK_SETTINGS_SECTIONS` (id `code-graph`), reading the settings scope's environment and
    showing its own unavailable state without the feature.
14. **Docs.** `docs/fork/user/code-graph.md` (what it does, install command, that Loom never
    runs Graphify's installers, where the graph is stored, the agent tool setting and its token
    cost). FORK.md "Packet seams" row. Status in the packets index.

Commit extension points separately, then
`feat(fork-code-graph): build a code graph with Graphify and show change impact`. Revert
`pnpm-lock.yaml` noise before every commit. No new npm dependency is needed.

## Pitfalls

- **Never run anything but `--version`, `extract` and `update`.** A single `graphify install`
  rewrites `CLAUDE.md`, `AGENTS.md` and hook files in the user's repository and home. The
  runner builds argv from a closed union; a test enforces it.
- **`GRAPHIFY_OUT` is read at import time.** Set it in the child's environment, not after
  start. Without it, Graphify writes `graphify-out/` into the repository.
- **Relative paths.** Graphify stores `source_file` relative to the root it scanned. A thread in
  a worktree has the same relative layout, so impact maps worktree-relative diff paths onto the
  project graph; the result is marked stale when the worktree's HEAD differs from
  `built_at_commit`.
- **Shrink guard.** `update` refuses to write a smaller graph unless forced
  (`graphify/export.py:273-327`). Surface it as "The update would remove part of the graph;
  rebuild instead?" and run the `force` mode on confirmation.
- **Per-repository lock.** A second Graphify process on the same repository blocks; the queue
  must never start two for one project.
- **Big graphs.** Enforce `MAX_GRAPH_BYTES` before reading; parse once; do not hold the raw
  JSON string after indexing.
- **Server restart during a build.** The child dies with the server; reset `building` rows at
  startup and keep the previous `graph.json` usable (Graphify writes atomically).
- **Upstream tests.** Do not add fork requirements to transport layers; handlers use
  `withForkRuntime` (EXTENSION-POINTS.md, Server core).
- **Tool cost.** Keep the MCP description to one sentence.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A graph builds and updates for a real repository with no files created inside it
  (`git status` unchanged) and no LLM environment variables passed to the child.
- Impact from the diff button lists callers of a changed function in another file.
- The agent tool answers `neighbors` and `impact` for a Codex and a Claude session.
- Without Graphify installed, every entry point explains what to install.
