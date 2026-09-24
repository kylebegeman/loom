# L08 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and every
file in this folder. Read the pull request toolkit
(`apps/server/src/mcp/toolkits/pullRequests/tools.ts` and `handlers.ts`) and the bootstrap
path in `apps/server/src/ws.ts:1047-1720` before writing `ThreadStarter`. Seed a worktree
`.t3` with a copy of real data; configure at least two provider instances for the manual
check.

## Steps

### 1. Extension points

Existence checks and creation, in order: `ext-core`, `ext-mcp`, `ext-panels`, `ext-web-root`,
`ext-keybindings`, `ext-palette`, `ext-settings` (regenerate the route tree as its section
says), `ext-decide` (EXTENSION-POINTS.md section 18). One commit each, FORK.md rows.

### 2. Contracts

`packages/contracts/src/fork/multi-thread-runs.ts` (TECHNICAL.md); register and export.
Keybinding commands. Typecheck `@t3tools/contracts`.

### 3. Storage

`migrations.ts`, `RunStore.ts` (+ tests on `SqlitePersistenceMemory`): run and member CRUD
(including `compare_mode`, `rank_json` and `routing_json`), the unique delegation run per
origin thread, settings defaults, missing keys filled from defaults, and decode fallback.

### 4. Thread starter

`ThreadStarter.ts` (+ tests with the engine on in-memory SQLite; model the layer on
`apps/server/src/project/AgentSessionImporter.test.ts:561-577`, plus a fake
`GitWorkflowService` and a fake `ProjectSetupScriptRunner`):

- project root start dispatches `thread.create` then `thread.turn.start`, and the resulting
  `thread.turn-start-requested` event carries the prompt and model selection;
- worktree start calls `createWorktree` with a temporary branch and creates the thread with
  that branch and path;
- invalid instance or model fails before any dispatch;
- a failing turn start deletes the created thread.

First confirm `ProjectSetupScriptRunner` and `ProviderRegistry` are available to services
built in `ForkLayer` (EXTENSION-POINTS.md, "What ForkLayer can use"); if either is not,
record it here and follow the fallback in TECHNICAL.md.

### 5. Run service and RPC

`RunService.ts`: `startCompare` (both modes), `list`, `setArchived`, `remove`, `stopRun`,
`rank`, settings, and the delegation helpers `startDelegated(scope, input)` and
`describeThread(scope, input)`. `rpc.ts` handlers with `auth.effect(TAG, withForkRuntime(...))`;
scopes; feature slug; `ForkServices` and `ForkServicesLive`. Tests: compare with one failing
member returns the run plus a failure; all failing deletes the run; samples start one
selection N times with "run k of N" titles and reject more than one member; `stopRun`
interrupts only running members.

### 5b. Jev routing and ranking

`apps/server/src/fork/multi-thread-runs/decide.ts` (pure parts test first):

- `DELEGATE_ROUTING_FEATURE` (agent tool, default) and `COMPARE_RANK_FEATURE`
  (`agentTool: false`), both `DecideFeature`s with `packet: "L08"`; append both to
  `FORK_DECIDE_FEATURES` in `apps/server/src/fork/decide/registry.ts`.
- `buildRoutingOptions(candidates, providers)`: drops unavailable candidates, finds the
  effort descriptor (`reasoningEffort` or `effort`), builds `c<i>` / `c<i>.<effort>` keys and
  criteria; `resolveRoutingChoice(key, options)` back to a `ModelSelection`.
- `buildRankState(run, members, { prompt, rubric })` with labels `A` to `F`, the 28,000-token
  budget split measured with `estimateTokens`, `diffExcerpt` for each member's diff (its
  `text` and `files`); no redaction here (`decide` does it); `rankFromAnswer(answer, labels)`
  ordering positions by `probabilities`.

Wire routing into `startDelegated` (step 5 of the `start_thread` handler in TECHNICAL.md) and
`rank` into `RunService`. `LoomDecide` comes from `ext-decide`; never call the TypeSafe API
directly, never pass `threshold`, and never re-check confidence (`decide` applies the
threshold). Routing adds no gate of its own: the mode check is `decide`'s.

### 6. MCP toolkit

`mcp.ts` with the two tools and handlers (TECHNICAL.md), registered in
`ForkMcpToolkitsLive`. Tests (with a test `McpInvocationContext` and `ForkRuntime` context,
as EXTENSION-POINTS.md, MCP tools, describes): disabled setting; depth and active-children
limits; runtime mode never above the caller's; `worktree` default creates a worktree and
`worktree: false` uses the caller's branch and path with the read-only note prepended;
routing (with a `LoomDecide` test layer returning scripted results): picked candidate and
effort, and fallback to the caller's full selection, with a `routingNote`, on each fallback
reason;
`not-your-thread`; `waitSeconds` returns when
a `thread.session-set` event moves the child out of `running` (drive it by dispatching
`thread.session.set` in the test and awaiting the handler's fiber, no sleeps) and returns the
current status on timeout (use `TestClock`).

### 7. Optional lineage integration

`lineage.ts`: the guarded `INSERT OR IGNORE` from TECHNICAL.md. Test both cases (table
absent: nothing happens; table present with L02's DDL: a row appears).

### 8. Cleanup reactor

`cleanupReactor.ts` (+ test with a `Deferred`).

### 9. Client runtime

`packages/client-runtime/src/fork/multi-thread-runs.ts`; export. Typecheck.

### 10. Web

1. `state.ts`, `runView.ts` (+ `runView.test.ts`).
2. `CompareDialog.tsx`, `CompareDialogHost.tsx` (register in `ForkRoot`; subscribe to both
   commands). Mode switch "Different models" / "Same model, several times" (the second has
   one provider and model row and a "Runs" stepper, 2 to 6, default 3). Defaults: members are
   the current thread's model plus the next ready instance;
   workspace "Separate worktrees"; base branch from the current thread's branch or the
   project's current branch; runtime mode from the project's default
   (`resolveProjectSettings(...).settings.defaultRuntimeMode`, as `ChatView.tsx:1900`
   reads it); interaction mode default.
3. `RunsPanel.tsx` and `panel.tsx`; after a successful compare, open the panel with the new
   run expanded. Member rows show `routing` for delegated children.
4. `RankHint.tsx`: "Rank with Jev" (rendered only when
   `useDecideFeature(environmentId, "multi-thread-runs.compare-rank").usable`, disabled while
   members work), rubric dialog prefilled from settings, result line, stale note,
   "Re-rank", "Clear hint"; copy from PRODUCT.md.
5. `RunsSettings.tsx` and its registration; `RoutingSettings.tsx` inside it (only when
   `useDecideFeature(environmentId, "multi-thread-runs.delegate-routing").supported`, with the
   "Let agents use this" note when `agentsAllowed` is false): candidate rows with provider and model, description (10 to 300 characters),
   allowed efforts from the selected model's effort descriptor, and the default rubric.
6. `palette.tsx`.

### 11. Documentation and status

- `docs/fork/user/multi-thread-runs.md`: compare (both modes), the Runs panel, enabling
  delegation, the two tools and their limits, the default worktree and the read-only shared
  workspace option, that children are ordinary threads, that setup scripts run but without
  the progress card, Jev routing (candidates, "Let agents use this", fallback) and the
  ranking hint (what Jev sees, that it is a hint).
- Packet index Status.

## Pitfalls

- Never pass `bootstrap` from the server; it is ignored outside `ws.ts`.
- Git locks: creating several worktrees at once can hit `index.lock`; keep concurrency at 3
  and surface git's message on failure.
- The MCP handler runs in the provider's request; keep `start_thread` fast (it returns after
  the turn start is dispatched, not after the child finishes).
- Subscribe to domain events before checking the child's status in `get_thread`, or a
  completion between the check and the subscription is missed.
- Tool descriptions cost tokens in every session; keep them as short as PRODUCT.md's copy.
- Do not read threads that are not the caller's children in `get_thread`.
- Never send provider or model names in the ranking state, and never send more than the
  budgeted excerpts.
- A Jev fallback is never a tool error: `start_thread` always starts the child when the
  caller's model is available.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A compare of three members starts three threads in three worktrees, and the Runs panel
  shows their live status.
- With delegation enabled, a Claude thread starts a Codex thread through
  `loom_multi_thread_runs_start_thread`, waits with `loom_multi_thread_runs_get_thread`
  (`waitSeconds: 60`), and reads its reply and changed files.
- With delegation disabled, both tools return the disabled error.
- A "Same model, several times" compare with 3 runs starts three threads of one model.
- With routing candidates set and "Let agents use this" on, a delegation without a model is
  routed by Jev; with Jev off or a stubbed timeout it uses the caller's model and effort.
- "Rank with Jev" on a finished compare shows a pick, an order and the hint wording; a
  low-confidence stub shows "Jev had no clear pick for this rubric."
- Deleting member threads removes them from their run; deleting all removes the run.
