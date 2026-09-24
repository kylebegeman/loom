# L08 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps. Waiting behavior is tested
with events and `TestClock`, never with real time.

## Automated tests

| File                                                            | Covers                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/fork/multi-thread-runs/RunStore.test.ts`       | Runs and members CRUD; one delegation run per origin; member unique per thread; settings default and decode fallback; migrations idempotent.                                                                                                                                                                 |
| `apps/server/src/fork/multi-thread-runs/ThreadStarter.test.ts`  | Project root and worktree starts (event contents); instance and model validation before any dispatch; cleanup on failed turn start; setup script failure does not stop the thread.                                                                                                                           |
| `apps/server/src/fork/multi-thread-runs/RunService.test.ts`     | Compare with partial failure; all failing deletes the run; `stopRun` interrupts running members only; list ordering and archived filter; remove keeps threads.                                                                                                                                               |
| `apps/server/src/fork/multi-thread-runs/mcp.test.ts`            | `disabled`; `depth-exceeded`; `limit-reached`; runtime mode ceiling; default model resolution; `not-your-thread`; `waitSeconds` returns on a `thread.session-set` leaving `running`; timeout returns current status (`TestClock`); last message truncation; changes from worktree status vs last checkpoint. |
| `apps/server/src/fork/multi-thread-runs/lineage.test.ts`        | No table: no-op; with L02's DDL: one `delegate` row; duplicate insert ignored.                                                                                                                                                                                                                               |
| `apps/server/src/fork/multi-thread-runs/cleanupReactor.test.ts` | Member removal on `thread.deleted`; run removal when empty; project removal; startup sweep.                                                                                                                                                                                                                  |
| `apps/web/src/fork/multi-thread-runs/runView.test.ts`           | Aggregate status precedence; filters by status, provider, text; member title formatting and truncation.                                                                                                                                                                                                      |
| Extension point tests                                           | As created with the extension points; in particular the MCP test that every fork tool starts with `loom_` and is unique.                                                                                                                                                                                     |

## Commands

```sh
vp test run apps/server/src/fork/multi-thread-runs apps/web/src/fork/multi-thread-runs \
  apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts \
  apps/web/src/fork/panels/registry.test.ts apps/web/src/fork/settings/registry.test.ts

vp lint apps/server/src/fork apps/web/src/fork packages/contracts/src/fork packages/client-runtime/src/fork

vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck        # after regenerating the route tree if ext-settings was created
vp run --filter @t3tools/mobile typecheck
```

If `vp test run` does not accept directories, list the test files explicitly.

## Manual check

With Kyle's permission for a dev server and browser, on seeded data, with at least Codex and
Claude instances ready:

1. Palette "Compare models...": prompt "Add a README section describing the build
   commands.", members Codex and Claude, separate worktrees. Both threads start, each on a
   `t3code/...` branch in its own worktree (renamed after the first turn); the setup script
   runs if the project has one. The Runs panel shows the run with both members working, then
   Done.
2. Filter by provider and by "Needs you" (make one member ask for approval with
   approval-required mode).
3. Stop all on a running run; archive it; show archived; unarchive; remove (threads stay).
4. Settings > Loom > Multi-thread runs: turn delegation on. In a Claude thread ask: "Use
   loom_multi_thread_runs_start_thread to have Codex list the TODO comments in this repo in
   its own worktree, then wait for it with loom_multi_thread_runs_get_thread and summarize."
   The child appears in the sidebar and under "Delegated by ..." in the Runs panel; the
   parent reports the child's answer.
5. Limits: set active children to 1 and ask for two children: the second call fails with the
   limit message. With depth 1, ask the child to delegate: it gets the depth message.
6. Turn delegation off: both tools return the disabled message.
7. If L02 is installed: the delegated child shows under Agent threads in Related threads, and
   "Open side by side" works from the Runs panel.
8. Upstream T3 server: palette items, panel and settings section hidden.
9. Remote over the tailnet share: steps 1 and 4.

## Merge safety

- `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly>`; with no
  packet seams, only extension point seam lines (and a regenerated route tree) may conflict.
- After merge to main: `scripts/fork/loom.sh integrate nightly --dry-run`.

## Acceptance criteria

- No new orchestration event types after compare and delegation (the event log holds only
  upstream types).
- Threads created by runs work with upstream T3 after a rollback (they are ordinary
  threads; fork tables are ignored).
