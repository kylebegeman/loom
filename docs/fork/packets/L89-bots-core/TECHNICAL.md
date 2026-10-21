# L89 technical design

## Overview

```text
Bots page / palette ──RPC loom.bots.*──┐
Agent ──MCP loom_bots_*────────────────┤
                                       ▼
                               BotsService (fork)
          definitions + runs in fork_bots_* ── change PubSub ──▶ loom.bots.watch
                                       │ run
                                       ▼
  semaphores (environment 20, per bot N) ─▶ ThreadLaunchService.launch(thread bot-run-<id>)
                                       │
                ThreadManagementService.waitForThread(timeout) ─▶ interruptThread on timeout
                                       │
                         final assistant message ─▶ run row (capped 16 KiB)
```

A run is an ordinary thread. The service never talks to a provider; it composes the same launch,
wait and interrupt methods that `t3_thread_launch` and `t3_thread_wait` use.

## Contracts

`packages/contracts/src/fork/bots.ts`, exported from `fork/index.ts`, merged in `fork/rpc.ts`.

- `BOTS_FEATURE = "bots"`.
- `BotId`: `^[a-z0-9][a-z0-9-]{0,63}$`. `BotParameterName`: `^[A-Za-z_][A-Za-z0-9_]{0,39}$`.
- `BotParameter`: `name`, `label`, optional `description`, `type` in
  `string | text | number | boolean | choice`, `required`, optional `default` (string),
  optional `choices` (1 to 20 strings, required for `choice`). At most 12 parameters.
- `BotWorkspace`: `{ type: "scratch" }` or
  `{ type: "project", projectId: ProjectId | null, worktree: boolean, baseRef?: string }`.
  `projectId: null` means the caller picks the project when it runs the bot.
- `BotDefinitionInput`: `id`, `name`, `description`, `instructions` (1 to 20,000 chars),
  `parameters`, `modelSelection`, `runtimeMode`, `interactionMode`, `workspace`,
  `timeoutMinutes` (1 to 120), `maxConcurrentRuns` (1 to 20), `scopeProjectId` (null for a
  global bot).
- `BotDefinition`: the input plus `version`, `createdBy` (`user | agent`), `createdAt`,
  `updatedAt`, `archivedAt`.
- `BotInputs`: `Record<BotParameterName, string | number | boolean>`.
- `BotRun`: `id`, `botId`, `botVersion`, `botName`, `threadId`, `projectId`, `inputs`,
  `status` in `queued | running | completed | failed | cancelled | timed_out`, `startedBy`
  (`user | agent`), `callerThreadId`, `createdAt`, `startedAt`, `finishedAt`, `result`
  (final reply, capped), `resultTruncated`, `error`.
- `BotsChange`: `{ _tag: "bot", bot }`, `{ _tag: "bot-deleted", botId }` or `{ _tag: "run", run }`.
- `BotsError`: `reason` in `not_found | invalid | archived | permission | storage | launch`
  plus a user-facing `message`.
- `BOT_RUN_THREAD_PREFIX = "bot-run-"` and `isBotRunThreadId(id)`, the one predicate every
  client filter uses.

| Tag                  | Payload                                   | Success                | Scope                   |
| -------------------- | ----------------------------------------- | ---------------------- | ----------------------- |
| `loom.bots.list`     | `{}`                                      | `{ bots }`             | `orchestration:read`    |
| `loom.bots.save`     | `BotDefinitionInput` + `expectedVersion?` | `BotDefinition`        | `orchestration:operate` |
| `loom.bots.archive`  | `{ botId, archived }`                     | `BotDefinition`        | `orchestration:operate` |
| `loom.bots.delete`   | `{ botId }`                               | `{}`                   | `orchestration:operate` |
| `loom.bots.run`      | `{ botId, inputs, projectId? }`           | `BotRun`               | `orchestration:operate` |
| `loom.bots.cancel`   | `{ runId }`                               | `BotRun`               | `orchestration:operate` |
| `loom.bots.listRuns` | `{ botId?, before?, limit }`              | `{ runs, hasMore }`    | `orchestration:read`    |
| `loom.bots.watch`    | `{}`                                      | stream of `BotsChange` | `orchestration:read`    |

Every RPC error union includes `EnvironmentAuthorizationError`. `watch` is a durable
subscription in `ForkSubscriptionRpcTag`, resubscribed on reconnect; clients refetch `list` and
`listRuns` after resubscribing.

## Server

`apps/server/src/fork/bots/`:

- `BotsStore.ts`: repository over `fork_bots_definitions` and `fork_bots_runs`; decodes JSON
  columns with schemas and skips rows a future version wrote.
- `render.ts`: `validateInputs(definition, inputs)` (required, type, choice membership, defaults
  applied) and `renderInstructions(instructions, inputs)` using the scheduled-task placeholder
  syntax `{{name}}` (`apps/server/src/scheduledTasks/webhookTemplate.ts`). Unknown placeholders
  are left as written so a typo is visible in the transcript.
- `BotsService.ts`: `Context.Service` with `list`, `save`, `archive`, `delete`, `run`,
  `cancel`, `listRuns`, `getRun`, `awaitRun`, `changes`. Added to `ForkServicesLive` and
  `ForkServices`; `bots` appended to `LOOM_SERVER_FEATURES`.
- `rpc.ts`, `mcp.ts`: thin transports.

### Run lifecycle

1. `run` loads the definition (not archived), validates inputs, resolves the project:
   scratch uses `ManagedProjectFolders.ensureScratchProject`; a project workspace uses the
   definition's project or the caller's `projectId`. A worktree workspace uses
   `{ type: "worktree", baseRef: workspace.baseRef ?? "HEAD" }` and is checked with
   `ThreadLaunchService.checkWorktreeBase` before any row is written.
2. Agent callers pass their own runtime mode; a bot whose `runtimeMode` ranks above it fails with
   `permission`. Rank order: `approval-required < auto-accept-edits < auto < full-access`.
3. The run row is written `queued` and a change is published. A fiber forked into the service
   scope takes a permit from the environment semaphore (`BOTS_MAX_ACTIVE_RUNS = 20`) and from the
   bot's semaphore (`maxConcurrentRuns`, rebuilt when the limit changes), then calls
   `ThreadLaunchService.launch` with `threadId = bot-run-<runId>`, `commandId = bot-run:<runId>`,
   the rendered prompt as the initial message, and the bot's model, modes and workspace.
   `createdBy` is the caller, `creationSource` is `server`.
4. The row turns `running`. `ThreadManagementService.waitForThread` waits with the bot's
   timeout. On timeout the service calls `interruptThread` and records `timed_out`.
5. The terminal row records the final assistant message of that run, capped at 16 KiB, and maps
   `completed` to `completed`, a requested cancel to `cancelled`, and anything else to `failed`
   with the run status as `error`.
6. `cancel` on a queued run interrupts its fiber and records `cancelled`; on a running run it
   interrupts the thread and lets step 5 record the outcome.

Launch failures record `failed` with the launch error's message. A fiber's own failure is caught
and recorded; it never escapes the service scope.

### Restart recovery

A `Layer.effectDiscard` under `forkParked` runs once after activation: `queued` rows become
`failed` ("The server restarted before this run started."), and each `running` row gets a new
waiter fiber (step 4 onward) with the remaining timeout measured from `startedAt`.

## Storage

Migration set `bots` in `apps/server/src/fork/bots/migrations.ts`, registered in
`FORK_MIGRATION_SETS`.

- `fork_bots_definitions(id TEXT PRIMARY KEY, version INTEGER NOT NULL, definition_json TEXT
NOT NULL, scope_project_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
updated_at TEXT NOT NULL, archived_at TEXT)`.
- `fork_bots_runs(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, bot_version INTEGER NOT NULL,
bot_name TEXT NOT NULL, thread_id TEXT NOT NULL, project_id TEXT, inputs_json TEXT NOT NULL,
status TEXT NOT NULL, started_by TEXT NOT NULL, caller_thread_id TEXT, created_at TEXT NOT
NULL, started_at TEXT, finished_at TEXT, result TEXT, result_truncated INTEGER NOT NULL
DEFAULT 0, error TEXT)` with indexes on `(bot_id, created_at DESC)` and `(status)`.

Deleting a bot keeps its runs (they name the bot by `bot_name`). Retention: the newest 500 runs
per bot are kept; older rows are pruned when a run finishes. Run threads follow the normal
thread lifecycle and storage cleanup.

## Clients

- `packages/client-runtime/src/fork/bots.ts`: query atoms for `list` and `listRuns`, the
  `watch` subscription folded into a map of changes (`foldBotsChange`) that `applyBotChanges`
  and `applyRunChanges` lay over the fetched lists, and `createEnvironmentRpcCommand` commands
  for save, archive, delete, run and cancel with `permissionAtom` gating. `isBotRunThreadId` is
  reused from contracts. Changes missed while disconnected never arrive, so the page refetches
  both lists on reconnect.
- `apps/web/src/fork/bots/`: `BotsPage.tsx` (bots on the left, the selected bot or all runs on
  the right), `BotEditor.tsx`, `BotRunForm.tsx` (generated from parameters), `BotRuns.tsx`
  (status, inputs, reply, cancel and an "Open thread" link), `draft.ts` (form state to
  `BotsSaveInput`, run form values to typed inputs), `palette.tsx`, `state.ts`.
- Route `apps/web/src/routes/loom.bots.tsx` with search `{ bot?, run? }`: `bot` selects a bot and
  `run` opens its run form, which is how the palette's "Run bot..." lands. `routeTree.gen.ts`
  regenerates.
- Bots live on the primary environment. The footer entry is always shown; the page explains an
  offline or outdated server. Palette items require `supportsLoomFeature(..., "bots")` there.

## Agent-facing tools

`apps/server/src/fork/bots/mcp.ts`, registered in `FORK_MCP_TOOLKITS`:

- `loom_bots_list` (read): bots visible to the caller's project, with parameters, and how many
  runs each has active.
- `loom_bots_define` (write): create or update a definition; `createdBy: "agent"`.
- `loom_bots_run` (write): `{ botId, inputs, projectId?, wait? }`. With `wait: true` it waits for
  the terminal row up to the bot's timeout, capped at 10 minutes, and returns the run; otherwise it
  returns the queued run.
- `loom_bots_run_status` (read): one run by id, including the reply.
- `loom_bots_cancel` (write).

Agents need these so an orchestrator stops rewriting the same brief and instead calls a pinned,
measured job.

## Performance

The change stream carries one bot or one run per event, never a list. `listRuns` caps `limit` at 50. Results are capped at 16 KiB in storage and the page shows a three-line preview until opened.
No animation repaints continuously; the running indicator is a static badge with the start time.

## Alternatives considered

- **Delegated tasks as the only path.** `delegate_task` hides children behind a parent thread, but
  a run from the Bots page has no parent, and a fake parent thread would leak into the sidebar.
- **Archiving finished runs to hide them.** Zero seams, but runs would show while running and
  would flood the Archive view.
- **A one-shot text-generation call** (`packages/provider-core/src/server/textGenerationOperations.ts`).
  Fast, but no tools, no transcript, no interruption and a fixed 180-second limit. It may become an
  optional fast path for simple bots later.
