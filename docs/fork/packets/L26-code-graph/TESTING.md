# L26 testing

Focused tests; no repo-wide checks; no sleeps. Tests never need Graphify installed: the
runner and service run small shell scripts that stand in for it, and the index reads a
checked-in `graph.json` written by Graphify 0.9.83 (203 nodes, 177 of them in the tree).
Service tests wait on the service's own status stream reaching an idle or building state.

## Automated tests

Server (`apps/server/src/fork/code-graph/`):

| Test file                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CodeGraphIndex.test.ts`   | Parsing the fixture with its Graphify version and commit; file, method and symbol kinds and external nodes; the shape check naming the first bad field; dangling links skipped; search ranking (exact, prefix, substring, with or without `()`), file path matches and the cap; `resolveNode` by id, path or label; neighborhood order, edges and node cap; shortest path both ways and the hop limit; impact listing callers and importers in other files nearest first, deeper with more depth, ignoring non-impact relations, and a file reached only through an import listed without counting as a symbol; summary counts, communities and hubs without external nodes.                                                                                |
| `CodeGraphRunner.test.ts`  | `buildArgv` only ever produces `--version`, `extract` or `update`; the child environment drops LLM credentials and sets `GRAPHIFY_OUT` outside the repository; version parsing and the tested-version check; shrink-refusal detection; `startGraphify` streams lines, reports the exit code and environment, stops a running process, and reports a missing command.                                                                                                                                                                                                                                                                                                                                                                                        |
| `CodeGraphStore.test.ts`   | On `SqlitePersistenceMemory`: a project's record, error and agent switch round-trip; `building` rows reset at startup; settings keep stored values and fill new fields with defaults.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `CodeGraphService.test.ts` | Against a scratch git repository and a stub Graphify script: a missing Graphify reports the pinned 0.9.83 install command and `build` fails `graphify-missing`; `recheck` finds a Graphify installed after the cached check; a full build lands under the state directory with no `graphify-out/` in the repository, answers summary, search and impact, then reads dirty after an edit and stale after a commit; a refused update keeps the previous graph answering until a forced rebuild; cancel returns a slow build to its previous state; automatic updates are off by default, skip worktree turns and run for project-root turns; delete removes the folder, row and agent switch, and `forgetMissingProjects` removes graphs of missing projects. |
| `reactor.test.ts`          | A `checkpoint.captured` event with files calls `noteThreadChanged` and one without files does not; `project.deleted` from the application event stream calls `forgetProject`; the stream starts after `latestApplicationSequence`; the startup catch-up runs. Fake services signal `Deferred`s.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `git.test.ts`              | Porcelain parsing: changed, untracked and renamed files, spaces in paths, a clean tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `mcp.test.ts`              | Access: thread callers only, `agent-tool-off` until the project's switch is on. Agent tool text over the fixture: search matches with place and id and the no-match line; neighbors grouped into uses and used by; a path with each hop's direction; impact by file with files the graph does not know.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Shared extension point tests that now include L26: `apps/server/src/fork/rpcAuthorization.test.ts`
(one scope per fork RPC, no upstream tag reuse, `loom.` prefix),
`apps/server/src/fork/mcp/registration.test.ts` (every fork toolkit registers),
`apps/server/src/fork/persistence/migrations.test.ts` (fork tables only),
`apps/server/src/fork/features.test.ts`, and on the web
`apps/web/src/fork/panels/registry.test.ts` (unique id and launcher letter `Y`),
`commandPalette/registry.test.ts`, `settings/registry.test.ts` and
`diffHeader/registry.test.ts` (unique action ids).

Contracts: `packages/contracts/src/fork/code-graph.test.ts`: tags start with
`loom.code-graph.` and are unique; every install command and the uvx command pin the tested
release; an empty Graphify command is rejected.

Web (`apps/web/src/fork/code-graph/`):

| Test file                   | Covers                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `impactSummary.test.ts`     | Files nearest first and the most direct symbols; at most 40 lines with a count of hidden files; the empty case. |
| `openWatcher.logic.test.ts` | A project is reported once per 10 minute interval; the least recently reported is forgotten beyond 20.          |
| `radialLayout.test.ts`      | Focus centered, direct neighbors grouped by relation on the inner ring, second hops outside, every edge drawn.  |

The agent tool's access path is tested on `queryCodeGraph`, the function the registered
handler runs: a caller outside a thread is refused, a project without a graph or with the
switch off gets `agent-tool-off`, and with the switch on the query reaches the graph.

## Commands

```sh
vp test run \
  apps/server/src/fork/code-graph \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/server/src/fork/mcp/registration.test.ts \
  apps/server/src/fork/features.test.ts \
  apps/server/src/fork/persistence/migrations.test.ts \
  packages/contracts/src/fork/code-graph.test.ts \
  apps/web/src/fork/code-graph \
  apps/web/src/fork/panels/registry.test.ts \
  apps/web/src/fork/commandPalette/registry.test.ts \
  apps/web/src/fork/settings/registry.test.ts \
  apps/web/src/fork/diffHeader/registry.test.ts
vp lint apps/server/src/fork/code-graph apps/web/src/fork/code-graph apps/web/src/fork/diffHeader \
  packages/contracts/src/fork/code-graph.ts packages/client-runtime/src/fork/code-graph.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

## Manual check

With Kyle's permission, one integrated pass with `test-t3-app` against a worktree-seeded
`.t3`, on web and then desktop, with Graphify 0.9.83 installed:

1. Point the command at a missing binary: the panel and settings show the pinned install
   command. Fix the command or install Graphify, then "Check again" finds it without
   waiting a minute.
2. Build a medium repository's graph. Progress lines stream and "Cancel" works. `git status`
   is unchanged and no `graphify-out/` exists; the graph is under
   `<stateDir>/fork/code-graph/`.
3. Overview shows hubs and groups. Search a function, open its neighborhood, refocus on a
   neighbor, and "Open file" lands on the line.
4. Change a widely used function in a thread and open the diff panel. "Show impact of these
   changes" switches the open Code map tab to Impact (no second tab), with callers in other
   files at 1 hop. Change hops; "Add to message" appends the summary to the composer;
   "Use uncommitted changes" switches back. A later turn that reverts the change empties
   Impact without a manual refresh.
5. On a new thread before its first message, the panel opens (no "start the thread" note)
   and Impact traces the project root's uncommitted changes.
6. Select one turn in the diff panel; the button traces that turn's files.
7. Commit: the graph reads out of date; "Update" refreshes it. Delete files and update:
   the shrink refusal keeps the old graph and "Rebuild anyway" replaces it.
8. Turn on "Let agents query the code graph for this project" and ask a Claude and a Codex
   thread to use `loom_code_graph_query` for a symbol's callers and for impact. In a project
   with the switch off, the call fails with the "tool is off" message.
9. Turn on automatic updates. Finish a project-root turn that edits files: one update runs.
   A worktree thread's turn starts none. Commit in a second project with a graph, then open
   one of its threads: an update starts in the background, and a build requested meanwhile
   shows "Waiting for another build".
10. Delete a graph from settings; its folder is gone.
11. Connect to an upstream T3 server: the launcher entry is disabled, there is no diff
    button or palette item, and settings says the server does not have the code graph.
12. Remote: repeat step 3 from a browser over Tailscale.

## Merge safety

Record the merge preview in [SEAMS.md](./SEAMS.md#merge-check) against the newest nightly.
After merge to `main`, run `scripts/fork/loom.sh integrate nightly --dry-run` from a clean,
synced `main`; the `ext-diff-header` row in `docs/fork/seams.tsv` catches a lost
`DiffPanel.tsx` seam.

## Acceptance criteria

- The listed tests pass, the listed packages typecheck, and lint is clean on changed files.
- No new npm dependency; `pnpm-lock.yaml` untouched.
- No file written inside a project repository by any Loom action.
- No RPC answer streams the graph; every list is capped.
- Upstream client against a Loom server: unaffected. Loom client against an upstream server:
  the feature is hidden or explained.
