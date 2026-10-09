# L26 implementation

Built on `feat/loom-code-graph` in three commits. This file records the layout, what changed
from the original plan, and the traps a maintainer should keep in mind.

## File layout

```
packages/contracts/src/fork/code-graph.ts           code-graph.test.ts
packages/client-runtime/src/fork/code-graph.ts
apps/server/src/fork/code-graph/
  CodeGraphRunner.ts  CodeGraphIndex.ts  CodeGraphStore.ts  CodeGraphService.ts
  git.ts  reactor.ts  rpc.ts  mcp.ts  migrations.ts
  __fixtures__/graph.small.json                     (written by Graphify 0.9.83)
  *.test.ts
apps/web/src/fork/diffHeader/                       (ext-diff-header)
  registry.ts  ForkDiffHeaderActions.tsx  registry.test.ts
apps/web/src/fork/code-graph/
  state.ts  viewStore.ts  panel.tsx  CodeGraphPanel.tsx  parts.tsx  NeighborhoodGraph.tsx
  radialLayout.ts  impactSummary.ts  diffHeaderAction.tsx  palette.tsx  settings.tsx
  CodeGraphOpenWatcher.tsx  openWatcher.logic.ts  *.test.ts
```

## Commits

1. `13fa404a42` feat(fork): add the diff panel header extension point. The two
   `DiffPanel.tsx` seams, the registry and renderer, the registry test, the `seams.tsv`
   row and the FORK.md row.
2. `b188786e4b` feat(fork-code-graph): build code graphs with Graphify on the server.
   Contracts, the runner, index, store, git helpers, service, reactor, RPC handlers, MCP
   tool, migrations and their registrations.
3. `ee70a90584` feat(fork-code-graph): show the code map panel and change impact. Client
   runtime atoms, the web panel, diff header action, palette, settings and open watcher.
   It also made the status RPC re-check Graphify, so "Check again" sees a fresh install.

## Changes from the plan

- Integration uses released V2 contracts. Auto-update listens for `checkpoint.captured`
  (with files) on `ThreadManagementService.streamDomainEvents`; deletion comes from
  `OrchestrationEventStore.streamApplicationEvents` after `latestApplicationSequence`, with
  a `forgetMissingProjects` catch-up at start. Projects and threads resolve through
  `ProjectStoreV2` and `ProjectionStoreV2`.
- Worktree turns never trigger updates; only turns in the project root change the graphed
  tree.
- Status subscriptions use a listener set and `Stream.callback`, not a `PubSub`.
- The diff header button switches the one Code map surface to Impact through the per-thread
  `viewStore.ts`. There is no `impactStore.ts` and no second `forkPanelSurface(..., "impact")`
  tab. The three views are a segmented toggle inside one component file instead of
  separate tab files.
- The agent switch and "Delete graph" sit in the Overview's "This project" section; the
  untested-version note appears in the graph status area rather than a header label.
- `loom.code-graph.list` was added for the settings list of project graphs.
- Staleness compares a fingerprint of uncommitted changes at build time instead of treating
  any dirty tree as stale, so a graph built on a dirty tree is not reported stale forever.
- The runner spawns with `node:child_process` directly; short git calls use upstream's
  `ProcessRunner`.
- The version check allows 60 seconds, because `uvx` may download Graphify on first use.
- The palette's third item is "Code map: Build or update graph" (value
  `action:loom:code-graph:update`), which builds a first graph or updates an existing one.
- `graph.json` is read whole and parsed once after the size check, not streamed.
- The user guide is `docs/fork/user/code-graph.md`.

## Pitfalls

- **Never run anything but `--version`, `extract` and `update`.** A single `graphify install`
  rewrites `CLAUDE.md`, `AGENTS.md` and hook files in the repository and home. The runner
  builds argv from a closed union, and a test enforces it.
- **`GRAPHIFY_OUT` is read at import time.** It must be in the child's spawn environment.
  Without it Graphify writes `graphify-out/` into the repository.
- **Relative paths.** Graphify stores `source_file` relative to the folder it scanned.
  `git.changedFiles` strips `rev-parse --show-prefix` so porcelain paths match, and a
  worktree's paths map onto the project graph because the layout is the same.
- **Shrink guard.** `update` refuses to write a smaller graph unless forced. Loom keeps the
  previous graph, marks the error `shrinkRefused` and offers a forced rebuild.
- **Per-repository lock.** A second Graphify process on one repository blocks; the
  one-permit semaphore and one-entry-per-project queue prevent it.
- **Server restart during a build.** The child dies with the server; startup resets
  `building` rows, and the previous `graph.json` stays usable because Graphify writes it
  atomically.
- **Transports stay thin.** Handlers call one service method under `withForkRuntime`; the
  MCP layer binds `ForkRuntime` at construction.
- **Tool cost.** Keep the MCP description to one sentence. The switch cannot hide the tool
  from `tools/list`.
- **Opening projects must stay cheap.** `noteProjectOpened` returns before any git call; the
  staleness check and queueing run in a fiber in the service scope.

## Done when

Met by the branch:

- Graphs build and update with no files written inside the repository and no LLM variables
  passed to the child (service and runner tests).
- Impact lists callers of a changed file in other files, from the diff's files or the
  checkout's changes.
- Without Graphify, the panel, settings and the build RPC explain what to install.
- With automatic updates on, a project-root turn updates the graph and a worktree turn does
  not.

Still to confirm in a real client: the checks under "Manual check" in
[TESTING.md](./TESTING.md#manual-check), including the agent tool from real Claude and Codex
sessions and an update triggered by opening an out-of-date project.
