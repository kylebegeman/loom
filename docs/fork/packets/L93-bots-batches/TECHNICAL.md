# L93 technical design

## Overview

```text
Run on many / loom_bots_run_batch
   previewBatch: resolve source ─▶ items (at most 200) ─▶ validateInputs per item
   runBatch: batch row + item rows (all pending, no run rows yet) in one transaction
        │
   feeder fiber (one per running batch, window = min(bot limit, 20))
        │ next pending item ─▶ BotsService internal start (snapshot definition, batchId)
        │                        └▶ L89 lifecycle: bot semaphore, environment semaphore, launch, wait
        │ terminal run change ─▶ item done ─▶ next pending item
        ▼
   all items terminal ─▶ batch finished ─▶ watchBatches + report
```

A batch is a queue in front of L89's run path. It owns no provider work, never takes a permit
itself, and never writes a run row for an item until the feeder hands that item to the service.

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BOTS_BATCHES_FEATURE = "bots-batches"`, `BOTS_BATCH_MAX_ITEMS = 200`.
- `BotBatchId`: same shape as `BotRunId` (`packages/contracts/src/fork/bots.ts:129`).
- `BotBatchSource`, a union on `type`:
  - `{ type: "lines", text }`, text at most 64 KiB; one item per non-empty trimmed line, exact
    duplicates removed in order.
  - `{ type: "glob", pattern, checkoutThreadId? }`, pattern 1 to 500 characters.
  - `{ type: "conflicts", checkoutThreadId? }`.
  - `{ type: "pullRequests", query? }`.
  - `{ type: "search", mode: "files" | "contents", query, caseSensitive?, useRegex? }`.
  - `{ type: "inputs", items: Array(BotInputs) }`, at most 200.
- `BotBatchItem`: `{ index, label, inputs, state: "pending" | "started" | "skipped", runId:
NullOr(BotRunId), previousRunIds: Array(BotRunId), run: NullOr(BotRun) }`. The outcome of a
  started item is its run; the item never copies run status.
- `BotBatchCounts`: `pending`, `queued`, `running`, `completed`, `failed`, `timedOut`,
  `cancelled`, `skipped`, and `pass`, `fail`, `needsAttention` (zero for text bots).
- `BotBatch`: `id`, `botId`, `botVersion`, `botName`, `projectId`, `sourceType`,
  `sourceSummary` (for example "apps/web/src/\*\*/\*.tsx, 31 files"), `itemParameter`,
  `sharedInputs`, `status: "running" | "finished" | "cancelled"`, `total`, `counts`,
  `startedBy`, `callerThreadId`, `createdAt`, `finishedAt`.
- `BotRun` gains `batchId: Schema.optionalKey(Schema.NullOr(BotBatchId))`. An added optional key
  decodes on older clients because struct decoding ignores unknown keys; an added union member
  would not, which is why batch changes get their own stream below.
- `BotBatchChange`: `TaggedStruct("batch", { batch })` or
  `TaggedStruct("batch-item", { batchId, item })`.

| Tag                      | Payload                                                                | Success                                      | Scope                   |
| ------------------------ | ---------------------------------------------------------------------- | -------------------------------------------- | ----------------------- |
| `loom.bots.previewBatch` | `BotsBatchInput`                                                       | `{ total, items (first 20), invalid, note }` | `orchestration:read`    |
| `loom.bots.runBatch`     | `BotsBatchInput`                                                       | `BotBatch`                                   | `orchestration:operate` |
| `loom.bots.listBatches`  | `{ botId?, before?, limit }` (limit at most 50)                        | `{ batches, hasMore }`                       | `orchestration:read`    |
| `loom.bots.getBatch`     | `{ batchId }`                                                          | `{ batch, items }`                           | `orchestration:read`    |
| `loom.bots.cancelBatch`  | `{ batchId }`                                                          | `BotBatch`                                   | `orchestration:operate` |
| `loom.bots.retryBatch`   | `{ batchId, include: "failed" \| "failed_and_attention", useLatest? }` | `BotBatch`                                   | `orchestration:operate` |
| `loom.bots.batchReport`  | `{ batchId }`                                                          | `{ markdown, truncated }`                    | `orchestration:read`    |
| `loom.bots.watchBatches` | `{}`                                                                   | stream of `BotBatchChange`                   | `orchestration:read`    |

`BotsBatchInput = { botId, projectId?, source, itemParameter?, sharedInputs? }`.
`itemParameter` is required for every source except `inputs`. Each new tag gets a row in
`FORK_CLIENT_GUARDED_RPC_SCOPES` (`packages/contracts/src/fork/clientRpcPermissions.ts:36`), and
`watchBatches` joins `ForkSubscriptionRpcTag` (`packages/contracts/src/fork/rpc.ts:108`) so it
resubscribes on reconnect; clients refetch `getBatch` for the open batch after resubscribing.

`BotsError` gains no reason. Batch refusals use `invalid` (bad source, too many items, item
inputs fail validation) and `not_found`, with the specific text in `message`.

## Sources

`apps/server/src/fork/bots/batchSources.ts`. Every resolver is bounded, returns
`{ items: Array<{ label, value }>, note }`, and refuses with the total when it finds more than
200 items ("This source found 312 files. Narrow it to 200 or fewer.").

The checkout for `glob`, `conflicts` and `search` is the project root, or the worktree of
`checkoutThreadId` when given, resolved and checked exactly as L90 resolves `checkoutThreadId`
(the thread must belong to the batch's project).

- **lines.** Pure split. The label is the line, cut to 120 characters.
- **glob.** `GitVcsDriver.execute` (`apps/server/src/vcs/GitVcsDriver.ts:295`, input at :43)
  with `args: ["ls-files", "-z", "--cached", "--", ":(glob)" + pattern]`, `timeoutMs: 10_000`,
  `maxOutputBytes: 1 MiB`. Patterns that start with `:` (other pathspec magic) or contain NUL are
  refused. Tracked files only, which keeps build output and `node_modules` out without a second
  ignore pass.
- **conflicts.** The same driver with `args: ["diff", "--name-only", "--diff-filter=U", "-z"]`,
  the command Loom's own merge helper prints (`scripts/fork/loom.sh:542`). Zero files returns
  "No conflicted files in this checkout."
- **pullRequests.** `PullRequestService.list` (`apps/server/src/pullRequest/PullRequestService.ts:166`)
  with `{ state: "open", projectId, query, limit: 201 }` (`packages/contracts/src/pullRequest.ts:354`).
  Each `PullRequestListEntry` (`packages/contracts/src/pullRequest.ts:316`) becomes value
  `number`, label `#<number> <title>`. Project errors in the result surface in `note`; a missing
  provider connection refuses with the provider's `detail`.
- **search.** `WorkspaceEntries.search` with `kind: "file"` and `limit: 200`, or
  `searchContents` with `limit: 500` deduplicated by path
  (`apps/server/src/workspace/WorkspaceEntries.ts:99-104`; limits at
  `packages/contracts/src/project.ts:18-19`). A `truncated` result is reported in `note`, because
  a search index cap is not the same as "these are all the matches".
- **inputs.** No resolution; each record is one item, labelled by its first string value.

Item inputs are `sharedInputs` plus `{ [itemParameter]: value }` (or the explicit record for
`inputs`), then L89's `validateInputs` (`apps/server/src/fork/bots/render.ts:78`), which already
accepts numbers given as strings. Preview returns the first five invalid items with their
messages; `runBatch` refuses when any item is invalid, so a batch never starts with items that
cannot run.

Workspace guard: the `conflicts` source requires runs to land in the resolved checkout, so the
bot must be a project bot with `checkout: "caller"` (L90) or a root checkout matching the
source, and not `worktree: true`. Otherwise preview refuses with "This bot runs in its own
worktree, so it would not see these conflicts." `glob` and `search` only warn in `note`, since
tracked files also exist in a fresh worktree. When the checkout came from a thread, every run in
the batch gets that `checkoutThreadId`.

## Server

`apps/server/src/fork/bots/BotBatches.ts`, a `Context.Service` in the bots module.

### Start

1. Load the bot (not archived), apply the runtime mode rank check from L89 once for agent
   callers, resolve the source, validate every item.
2. In one SQLite transaction: write the batch row with a snapshot of the definition
   (`definition_json`, the same JSON the definitions table stores), and one item row per item in
   state `pending` with no run.
3. Publish `batch`, fork the feeder into the service scope, return the batch.

The snapshot pins the batch to the version Kyle previewed. Saving the bot mid-batch does not
change the instructions or inputs the remaining items use. L98 later replaces the snapshot with a
reference to a stored version.

### Feeder

`BotsService` gains one internal method, `startRunWith(definition, input, caller, { batchId })`,
the existing `BotsService.run` (`apps/server/src/fork/bots/BotsService.ts`) with the definition supplied
instead of loaded. It is not on RPC or MCP.

The feeder runs `Effect.forEach(pendingItems, feedItem, { concurrency: window })` with
`window = min(liveDefinition.maxConcurrentRuns, BOTS_MAX_ACTIVE_RUNS)`. `feedItem`:

1. In one transaction, call `startRunWith` (which writes the queued run row with `batch_id`) and
   set the item to `started` with its `runId`.
2. Wait for that run's terminal change on the service's change PubSub
   (the `changes` PubSub in `apps/server/src/fork/bots/BotsService.ts`), the same mechanism
   `awaitRun` uses, without a timeout of its own: the run already has one.
3. Publish `batch-item` and an updated `batch` summary.

The per-bot semaphore is always sized from the stored definition (`permitsFor` in
`apps/server/src/fork/bots/BotsService.ts`), not the snapshot, so lowering the bot's limit
mid-batch takes effect for the remaining items. The window only limits how many run rows exist
at once. Without it, 200 queued rows would be written immediately, and L89 recovery
(`recover` in `apps/server/src/fork/bots/BotsService.ts`) would fail all of them after a restart.

Two batches of the same bot share its semaphore and are served in arrival order. A batch never
holds more permits than the bot's own limit, so other bots keep their share of the 20.

When every item is `started` or `skipped` and every started run is terminal, the batch becomes
`finished` with `finishedAt`.

### Cancel, archive, delete

`cancelBatch` marks the batch `cancelled`, sets pending items to `skipped`, stops the feeder,
and calls `BotsService.cancel` for each queued
or running item. Archiving or deleting the bot does the same to its running batches, with the
note "The bot was archived." Cancelling a single run from the run list leaves the batch running;
that item counts as cancelled.

### Retry

`retryBatch` selects items whose current run is `failed` or `timed_out`, plus completed runs
with verdict `needs_attention` for `failed_and_attention`. Each selected item moves its `runId`
into `previousRunIds` and returns to `pending`; the batch returns to `running` with a fresh
feeder. Items are limited to five attempts; beyond that they are left out and named in the
reply. `useLatest: true` replaces the snapshot with the current definition first, for the
common "fix the bot, rerun the failures" loop; each item still records the `botVersion` that
actually ran. Cancelled and skipped items are not retried; Kyle reruns them with a new batch.

### Restart recovery

A second `forkParked` step, ordered after L89's recovery (`recover` in `apps/server/src/fork/bots/BotsService.ts`):

1. For each `running` batch, items whose run is `failed` with `startedAt` null are runs L89
   recovery just failed before launch. They return to `pending` with `runId` cleared; the failed
   row stays in run history.
2. Items whose run is still `running` already have an L89 waiter; the new feeder waits for them
   as in step 2 above.
3. The feeder restarts for the remaining pending items.

Pending items have no run row, so nothing about them can be lost by a restart.

### Report

`renderBatchReport(batch, items)`, pure, in `batchReport.ts`: a heading with the bot, version,
source summary and counts ("26 pass, 3 fail, 1 needs attention" for verdict bots, "28 completed,
2 failed" otherwise), then one section per item that did not pass or complete, with the label,
status, verdict summary or the first 300 characters of the reply, findings as a list with
`path:line`, and the run thread id. Passing items are one line each. Capped at 64 KiB with
`truncated`.

### Storage

Migration 5 `Batches` in `apps/server/src/fork/bots/migrations.ts` (the next free id if another
bots migration landed first):

- `fork_bots_batches(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, bot_version INTEGER NOT NULL,
bot_name TEXT NOT NULL, definition_json TEXT NOT NULL, project_id TEXT, checkout_thread_id
TEXT, source_json TEXT NOT NULL, item_parameter TEXT, shared_inputs_json TEXT NOT NULL, status
TEXT NOT NULL, started_by TEXT NOT NULL, caller_thread_id TEXT, created_at TEXT NOT NULL,
finished_at TEXT)` with an index on `(bot_id, created_at DESC)`.
- `fork_bots_batch_items(batch_id TEXT NOT NULL, item_index INTEGER NOT NULL, label TEXT NOT
NULL, inputs_json TEXT NOT NULL, state TEXT NOT NULL, run_id TEXT, previous_run_ids_json TEXT
NOT NULL DEFAULT '[]', PRIMARY KEY (batch_id, item_index))`.
- `ALTER TABLE fork_bots_runs ADD COLUMN batch_id TEXT` and index `fork_bots_runs_batch(batch_id)`.

Counts are computed from items joined to runs, not stored, so they cannot drift. Retention: the
newest 50 batches per bot; pruning a batch deletes its items, not its runs. L89's run pruning
(`RUNS_KEPT_PER_BOT = 500`, `apps/server/src/fork/bots/BotsStore.ts:16`) skips runs whose batch is
still running. An item whose run was later pruned shows "Run no longer stored".

## Clients

- `packages/client-runtime/src/fork/bots.ts`: `listBatches` and `getBatch` atoms, the
  `watchBatches` subscription folded into both, commands for run, cancel and retry batch.
- `apps/web/src/fork/bots/RunOnManyDialog.tsx`: source picker, item parameter select (defaults to
  the first required string parameter), shared inputs from the generated form, checkout picker
  for file sources, and a debounced `previewBatch`. The primary button names the count ("Run on 19
  items"); with the conflicts source it reads "Resolve all 19 conflicts".
- `apps/web/src/fork/bots/BatchView.tsx`: a CSS grid of 200 fixed squares at most, colored by
  item outcome and verdict, each a button that opens the run; the counts line; Cancel, Retry
  failed, Retry failed and needs attention; the rendered report and Copy report. No transitions.
- The Bots page gains a Batches tab in the route's `tab` search param.
- Palette: "Run bot on many" in the bots palette source.

## Agent-facing tools

- `loom_bots_run_batch` (write): `BotsBatchInput` plus `wait?`. With `wait: true` it waits for the
  batch to finish up to 10 minutes and returns the report; otherwise the batch. Agents usually
  pass `source: { type: "inputs", items }`.
- `loom_bots_batch_status` (read): batch, counts and report markdown.
- `loom_bots_batch_retry`, `loom_bots_batch_cancel` (write).

## Performance

`watchBatches` carries one batch summary or one item per event. A 200-item batch produces about
600 events over its life. `getBatch` returns at most 200 items. Grid squares are static elements
whose class changes on state change.

## Alternatives considered

- **Write all 200 run rows at start.** Simpler, but every queued row is failed by L89 recovery
  on restart, and the run list fills with queued rows that are only waiting on the batch.
- **Add `batch` to `BotsChange`.** One stream, but older clients fail to decode an unknown tag.
- **A batch as a pipeline with one step.** L99 can treat batches as a fan-out primitive later;
  building the pipeline engine first would delay the common case.
