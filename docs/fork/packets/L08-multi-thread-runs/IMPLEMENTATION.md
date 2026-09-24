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
says). One commit each, FORK.md rows.

### 2. Contracts

`packages/contracts/src/fork/multi-thread-runs.ts` (TECHNICAL.md); register and export.
Keybinding commands. Typecheck `@t3tools/contracts`.

### 3. Storage

`migrations.ts`, `RunStore.ts` (+ tests on `SqlitePersistenceMemory`): run and member CRUD,
the unique delegation run per origin thread, settings defaults and decode fallback.

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

`RunService.ts`: `startCompare`, `list`, `setArchived`, `remove`, `stopRun`, settings, and the
delegation helpers `startDelegated(scope, input)` and `describeThread(scope, input)`.
`rpc.ts` handlers with `auth.effect(TAG, withForkRuntime(...))`; scopes; feature slug;
`ForkServices` and `ForkServicesLive`. Tests: compare with one failing member returns the run
plus a failure; all failing deletes the run; `stopRun` interrupts only running members.

### 6. MCP toolkit

`mcp.ts` with the two tools and handlers (TECHNICAL.md), registered in
`ForkMcpToolkitsLive`. Tests (with a test `McpInvocationContext` and `ForkRuntime` context,
as EXTENSION-POINTS.md, MCP tools, describes): disabled setting; depth and active-children
limits; runtime mode never above the caller's; `not-your-thread`; `waitSeconds` returns when
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
   commands). Defaults: members are the current thread's model plus the next ready instance;
   workspace "Separate worktrees"; base branch from the current thread's branch or the
   project's current branch; runtime mode from the project's default
   (`resolveProjectSettings(...).settings.defaultRuntimeMode`, as `ChatView.tsx:1900`
   reads it); interaction mode default.
3. `RunsPanel.tsx` and `panel.tsx`; after a successful compare, open the panel with the new
   run expanded.
4. `RunsSettings.tsx` and its registration.
5. `palette.tsx`.

### 11. Documentation and status

- `docs/fork/user/multi-thread-runs.md`: compare, the Runs panel, enabling delegation, the
  two tools and their limits, that children are ordinary threads, that setup scripts run but
  without the progress card.
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

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A compare of three members starts three threads in three worktrees, and the Runs panel
  shows their live status.
- With delegation enabled, a Claude thread starts a Codex thread through
  `loom_multi_thread_runs_start_thread`, waits with `loom_multi_thread_runs_get_thread`
  (`waitSeconds: 60`), and reads its reply and changed files.
- With delegation disabled, both tools return the disabled error.
- Deleting member threads removes them from their run; deleting all removes the run.
