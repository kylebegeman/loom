# L26 testing

Focused tests; no repo-wide checks; no sleeps. Server tests wait on deferreds, receipts or the
service's own status stream. Tests never need Graphify installed: the runner is tested with a
fake executable script, the index with a fixture.

## Automated tests

| File                                                                   | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/fork/code-graph/CodeGraphIndex.test.ts`               | Decoding the fixture; rejecting files missing required fields; `MAX_GRAPH_BYTES`; kind inference; search ordering (prefix, substring, subsequence) and cap; neighborhood grouping and cap; shortest path, including no path and the 8-hop limit; impact: seeds from files, incoming traversal only over impact relations, depth limit, changed files excluded from hits, `unknownFiles`, community count, truncation at 300.                                                                                                         |
| `apps/server/src/fork/code-graph/CodeGraphRunner.test.ts`              | `buildArgv` produces only `--version`, `extract ... --code-only --out <dir>`, `extract ... --force`, or `update <root>`; no argv from any other code path (an exhaustive check over the mode union); `scrubEnvironment` removes every listed key and any `*_API_KEY`, sets `GRAPHIFY_OUT` and `PYTHONUNBUFFERED`; version parsing and the minimum check. Spawning a fake `graphify` shell script from a temp dir: streamed lines arrive in order, non-zero exit maps to `build-failed` with the stderr tail, cancel kills the child. |
| `apps/server/src/fork/code-graph/CodeGraphStore.test.ts`               | Migration applies on `SqlitePersistenceMemory` (`apps/server/src/persistence/Layers/Sqlite.ts:41-44`); row round trip; settings defaults; every created table starts with `fork_code_graph_`.                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/code-graph/CodeGraphService.test.ts`             | With a fake runner: build transitions `none -> building -> ready` observed on the status stream (awaited, not slept); concurrent build requests for one project dedupe; a second project waits for the semaphore; startup resets a `building` row; delete removes the directory and row; staleness from a fake git reader.                                                                                                                                                                                                           |
| `apps/server/src/fork/code-graph/CodeGraphReactor.test.ts`             | A `thread.turn-diff-completed` event with auto-update on queues one update; two events within the coalescing window queue one; auto-update off queues none; `project.deleted` deletes the graph. Uses a test event stream and a `Deferred` signalled by the fake service.                                                                                                                                                                                                                                                            |
| `apps/server/src/fork/code-graph/mcp.test.ts`                          | Tool name `loom_code_graph_query` is unique and starts with `loom_`; the handler fails with the typed error when `agentTool` is off or no graph exists; output stays under the character cap for a large result; it never triggers a build. Runs through `withForkRuntime` with a test `ForkRuntime` context.                                                                                                                                                                                                                        |
| `apps/server/src/fork/rpcAuthorization.test.ts` (extension point test) | Keys still equal the fork group; no collision with upstream tags.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/src/fork/code-graph/radialLayout.test.ts`                    | Deterministic positions, no overlap for up to 80 nodes on two rings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/src/fork/code-graph/impactSummary.test.ts`                   | Summary text is capped at 40 lines and lists files by depth.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/web/src/fork/panels/registry.test.ts` (extension point test)     | Panel id unique, shortcut `Y` unique and not upstream's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Commands

```sh
vp test run \
  apps/server/src/fork/code-graph/*.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/server/src/fork/features.test.ts \
  apps/server/src/fork/persistence/migrations.test.ts \
  apps/web/src/fork/code-graph/*.test.ts \
  apps/web/src/fork/panels/registry.test.ts \
  apps/web/src/fork/commandPalette/registry.test.ts \
  apps/web/src/fork/diffHeader/registry.test.ts
vp lint apps/server/src/fork/code-graph apps/web/src/fork/code-graph \
  packages/contracts/src/fork/code-graph.ts packages/client-runtime/src/fork/code-graph.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

## Manual check

With Kyle's permission, one integrated pass with `test-t3-app` against a worktree-seeded
`.t3`, on web and then desktop:

1. Without Graphify on PATH (set the command to a nonexistent binary): panel, settings and
   palette explain the install command; "Check again" works after fixing the command.
2. Build the graph for a medium repository. Progress lines stream; the panel is usable during
   an update. `git status` in the repository is unchanged afterwards and no `graphify-out/`
   exists.
3. Overview shows counts, communities, hub symbols. Search a function; open its neighborhood;
   "Open file" lands on the line.
4. Change a widely used function in a thread; open the diff panel; click "Impact". Callers in
   other files appear at depth 1, their callers at depth 2. "Add to message" appends the
   summary to the composer.
5. Switch the diff scope to one turn; "Impact" uses that turn's files.
6. Status shows stale after a commit; "Update" refreshes it.
7. Enable the agent tool; in a Claude and a Codex thread ask the agent to use
   `loom_code_graph_query` for callers of a symbol. Disable it; the tool call fails with a
   clear message.
8. Enable auto-update; finish a turn that edits files; one update runs.
9. Delete the project's graph from settings; the directory under
   `<stateDir>/fork/code-graph/` is gone.
10. Connect to an upstream T3 server: launcher entry disabled with "Needs a Loom server", no
    diff button, no palette items.
11. Remote: repeat step 3 from a browser over Tailscale.

## Merge safety

Record the merge preview (SEAMS.md) against the newest nightly. After merge to `main`, run
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`. Until the
`loom.sh` follow-up lands, check by hand that `apps/server`, `packages/contracts` and
`packages/client-runtime` typecheck on the rehearsal branch and that
`git grep -c 'fork: ext-diff-header' -- apps/web/src/components/DiffPanel.tsx` prints 2.

## Acceptance criteria

- All listed tests pass; the listed packages typecheck; lint clean on changed files;
  `pnpm-lock.yaml` untouched; no new npm dependency.
- No file written inside a project repository by any Loom action.
- No RPC response over about 200 KB for the fixture repository; no graph streaming.
- Upstream client against a Loom server: unaffected. Loom client against upstream server:
  feature hidden or explained.
