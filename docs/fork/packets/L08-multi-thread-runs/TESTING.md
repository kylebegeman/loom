# L08 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps. Waiting behavior is tested
with events and `TestClock`, never with real time.

## Automated tests

| File                                                            | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/multi-thread-runs/RunStore.test.ts`       | Runs and members CRUD with `compare_mode`, `rank_json` and `routing_json`; one delegation run per origin; member unique per thread; settings default, missing keys filled from defaults, decode fallback; migrations idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/server/src/fork/multi-thread-runs/ThreadStarter.test.ts`  | Project root and worktree starts (event contents); instance and model validation before any dispatch; cleanup on failed turn start; setup script failure does not stop the thread.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/multi-thread-runs/RunService.test.ts`     | Compare with partial failure; all failing deletes the run; samples mode starts one selection N times, titles "run k of N", rejects two members and more than 6; `stopRun` interrupts running members only; list ordering and archived filter; remove keeps threads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/server/src/fork/multi-thread-runs/decide.test.ts`         | Pure: routing options skip unready instances and unknown models, use `reasoningEffort` or `effort` descriptors, drop efforts the model does not offer, key `c<i>` for models without effort; fewer than two options means no call; rank state labels `A` to `F`, contains no provider or model names, stays within the 28,000-token budget (by `estimateTokens`) with long replies and diffs, and takes `changed_files` from `diffExcerpt`'s `files`; `DELEGATE_ROUTING_FEATURE` has no `agentTool: false`, `COMPARE_RANK_FEATURE` has it, both `packet: "L08"`; `rankFromAnswer` orders by probability with position tie-break.                                                                                                                                                                                                                                                                          |
| `apps/server/src/fork/multi-thread-runs/RunService.jev.test.ts` | A `LoomDecide` test layer returning scripted `DecideResult`s and recording calls (section 18; TypeSafe never called): routing calls `decide` with origin `agent`, the caller's thread and project, and no `threshold`; an `answered` result maps to the candidate's selection and effort and records `routing.by = "jev"` with confidence; scripted `disabled`, `agent-not-allowed`, `no-key`, `project-off`, `error`, `timeout` and `low-confidence` (with answers) each fall back to the caller's full selection with the reason and a `routingNote`, and the child still starts; rank calls `decide` with origin `user`, `timeoutMs: 5000` and no `threshold`; a routed candidate that became unavailable falls back with `candidate-unavailable`. Rank: `not-compare` and `not-ready` errors; answered stores `RunRank`; fallback keeps the previous hint and returns the reason; `clear` removes it. |
| `apps/server/src/fork/multi-thread-runs/mcp.test.ts`            | `disabled`; `depth-exceeded`; `limit-reached`; runtime mode ceiling; default model resolution; default worktree vs `worktree: false` (caller's workspace, read-only note prepended); result carries `effort` and `routedBy`; `not-your-thread`; `waitSeconds` returns on a `thread.session-set` leaving `running`; timeout returns current status (`TestClock`); last message truncation; changes from worktree status vs last checkpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/fork/multi-thread-runs/lineage.test.ts`        | No table: no-op; with L02's DDL: one `delegate` row; duplicate insert ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/server/src/fork/multi-thread-runs/cleanupReactor.test.ts` | Member removal on `thread.deleted`; run removal when empty; project removal; startup sweep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/src/fork/multi-thread-runs/runView.test.ts`           | Aggregate status precedence; filters by status, provider, text; member title formatting and truncation (including "run k of N"); routing label text per `MemberRouting`; rank staleness when a member's `updatedAt` is after `rankedAt`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Extension point tests                                           | As created with the extension points; in particular the MCP test that every fork tool starts with `loom_` and is unique, and `apps/server/src/fork/decide/registry.test.ts` (unique `<slug>.<name>` ids, `packet` like `L08`, thresholds between 0 and 1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Commands

```sh
vp test run apps/server/src/fork/multi-thread-runs apps/web/src/fork/multi-thread-runs \
  apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts \
  apps/web/src/fork/panels/registry.test.ts apps/web/src/fork/settings/registry.test.ts \
  apps/server/src/fork/decide/registry.test.ts

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
   2b. "Same model, several times" with Codex and 3 runs: three threads titled "run 1 of 3" to
   "run 3 of 3". When all are done, "Rank with Jev" (needs a Jev key; ask Kyle before copying
   `secrets` into the worktree `.t3`): the hint line shows a pick, an order and the
   confidence, and the note says Jev saw excerpts. Send one more message in a member: "Results
   changed since this hint." appears. "Clear hint" removes it.
3. Stop all on a running run; archive it; show archived; unarchive; remove (threads stay).
4. Settings > Loom > Multi-thread runs: turn delegation on. In a Claude thread ask: "Use
   loom_multi_thread_runs_start_thread to have Codex list the TODO comments in this repo in
   its own worktree, then wait for it with loom_multi_thread_runs_get_thread and summarize."
   The child appears in the sidebar and under "Delegated by ..." in the Runs panel; the
   parent reports the child's answer.
5. Limits: set active children to 1 and ask for two children: the second call fails with the
   limit message. With depth 1, ask the child to delegate: it gets the depth message.
   5b. Workspace: ask the agent to delegate a read-only review with `worktree: false`: the child
   runs on the caller's branch and path, and its first message starts with the read-only note.
   5c. Routing: add two routing candidates (for example a fast model for small edits, a strong
   model with high effort for design work) and turn "Let agents use this" on for "Delegated
   thread routing". A delegation without a model shows "Picked by Jev" on the child; with
   "Let agents use this" off again it shows "Caller's model" and the tool result says Jev
   routing is not allowed for agents. "Compare ranking hint" has no "Let agents use this"
   switch.
6. Turn delegation off: both tools return the disabled message.
7. If L02 is installed: the delegated child shows under Agent threads in Related threads, and
   "Open side by side" works from the Runs panel.
8. Upstream T3 server: palette items, panel and settings section hidden. A Loom server
   without Jev set up: no rank button, no routing settings, delegation uses the caller's
   model.
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
- No Jev failure (no key, timeout, error, low confidence) makes `start_thread` fail or blocks
  it longer than the `ext-decide` timeout.
- The ranking hint never changes a thread, a run's member order or its archive state.
