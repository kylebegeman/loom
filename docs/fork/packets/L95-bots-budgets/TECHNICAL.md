# L95 technical design

## Overview

```text
run terminal step (L89)
   readReply ─▶ result            (existing)
   readRunUsage ─▶ providerTurns[].turnTokenUsage summed ─▶ input/cached/output tokens + status

BotsService.run (any caller) ─▶ BotBudgets.check(bot, now)
   runs created in last 24 h  >= runsPerDay    ─▶ refuse (invalid, message, retryAt)
   tokens of runs finished in last 24 h >= tokensPerDay ─▶ refuse
   otherwise ─▶ L89 lifecycle

loom.bots.usage { since, until } ─▶ per bot: runs, outcomes, durations, tokens ─▶ Usage tab,
                                                                          Usage page section
```

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BOTS_BUDGETS_FEATURE = "bots-budgets"`.
- `BotBudget = Schema.Struct({ runsPerDay: optionalKey(Int 1 to 10,000), tokensPerDay:
optionalKey(Int 1,000 to 10,000,000,000) })`.
- `BotDefinitionInput` gains `budget: Schema.optionalKey(BotBudget)`. Absent means unlimited,
  which keeps every saved definition valid. A budget change is a definition save, so it bumps the
  version and shows in L98's diff.
- `BotRunUsage = Schema.Struct({ inputTokens, cachedInputTokens, outputTokens, status:
Literals(["complete", "partial", "unavailable"]) })`. Input includes cache reads and writes and
  output includes reasoning, the same meaning `TurnTokenUsage` documents
  (`packages/contracts/src/providerRuntime.ts:321-324`).
- `BotRun` gains `usage: Schema.optionalKey(Schema.NullOr(BotRunUsage))`; null until terminal.
- `BotsError` gains `retryAt: Schema.optionalKey(Schema.String)`. Budget refusals use the
  existing reason `invalid`. A new reason literal would make older clients fail to decode the
  error and show a generic failure instead of the message; an optional field decodes everywhere.
- `BotUsageRow = { botId, botName, runs, completed, failed, timedOut, cancelled, pass, fail,
needsAttention, successRate: NullOr(Number), medianDurationMs: NullOr(Int),
maxDurationMs: NullOr(Int), tokens: { input, cachedInput, output, total }, usageComplete:
Boolean, byModel: Array({ model, runs, successRate, medianDurationMs, totalTokens }) }`.
- `BotBudgetState = { runsInWindow, tokensInWindow, runsPerDay?, tokensPerDay?, retryAt? }`.

| Tag               | Payload                    | Success                                                    | Scope                |
| ----------------- | -------------------------- | ---------------------------------------------------------- | -------------------- |
| `loom.bots.usage` | `{ since, until, botId? }` | `{ rows, totals, budgets: Record<BotId, BotBudgetState> }` | `orchestration:read` |

`since` and `until` are ISO timestamps at most 92 days apart. `budgets` is always for the
current rolling 24 hours, independent of the window, so the editor meter and the refusal agree.

## Recording usage

At the terminal step (`awaitThread` in `apps/server/src/fork/bots/BotsService.ts`), beside
`readReply`, `readRunUsage(projectId, threadId)` calls
`ThreadManagementService.getProjectThreadRecords({ projectId, threadId }, ["providerTurns"])`
(`apps/server/src/orchestration-v2/ThreadManagementService.ts:350`) and sums every provider turn
of the run thread:

- `turnTokenUsage` (`packages/contracts/src/orchestrationV2.ts:984`; union at
  `packages/contracts/src/providerRuntime.ts:333`) contributes its input, cached input and output.
- The run's status is `complete` when every turn reports `usageStatus: "complete"`,
  `unavailable` when none reports tokens, and `partial` otherwise.

A run thread holds one bot request (L89), so summing its turns is the run's cost. A promoted
thread (L94) is a different thread and is never counted. Turns of a provider that reports no
token usage give `unavailable`. `turnTokenUsage` has `usageScope: "main_agent"`: subagent work
inside a run is not included, which the UI states when `hasSubagents` was true on any turn
(stored as `partial`).

Reading usage failing never fails the run; the run records `usage: null` and logs.

## Budgets

`apps/server/src/fork/bots/BotBudgets.ts`, used by `BotsService.run`
(`apps/server/src/fork/bots/BotsService.ts`) right after `validateInputs`, before any row is
written:

- **Runs.** `COUNT(*)` of the bot's runs with `created_at > now - 24h` and `started_at IS NOT
NULL OR status IN ('queued', 'running')`. Runs that were refused or never launched (L89 restart
  failures, L97 skipped firings) do not use the budget. When the count reaches `runsPerDay`,
  `retryAt` is the creation time of the oldest counted run plus 24 hours.
- **Tokens.** Sum of `input_tokens + output_tokens` over the bot's runs with
  `finished_at > now - 24h`. When it reaches `tokensPerDay`, `retryAt` is when enough of the
  oldest finished runs leave the window to drop below the ceiling.
- The refusal is `BotsError({ reason: "invalid", message, retryAt })` with message
  "<Bot> reached its budget of <n> runs per 24 hours. The next run is possible at <local time>."
  (or "... <n> tokens per 24 hours ...").

The check and the queued row are not in one transaction with other callers, so two simultaneous
starts can both pass at `runsPerDay - 1`. The service serializes the check and the row write per
bot with a one-permit semaphore beside the bot's run semaphore, which is enough for one server
process.

Every caller goes through the same check: the Bots page, the composer (L91), MCP, retries (L94),
batches (L93), triggers (L97) and pipelines (L99).

### Batches

When L93 is present, the feeder calls `BotBudgets.check` before starting each item. On refusal
it does not start the item, sets `pausedUntil` on the batch (`BotBatch` gains
`pausedUntil: Schema.optionalKey(Schema.NullOr(String))`), publishes, and sleeps until
`retryAt`, then checks again. Items stay `pending` throughout, so a restart during the pause
loses nothing: recovery restarts the feeder, which checks again. Cancel ends the wait.

### Triggers

`BotBudgets.check` is exported for L97, which records a refused firing as a failed run with
`started_at` null and the refusal message, so it lands in the inbox (L94) and does not count
against the budget.

## Usage query

`BotsService.usage({ since, until, botId? })` reads the bot's runs with `created_at` in the window
(bounded by L89's 500 runs per bot, so at most `500 x bots` rows) and computes in TypeScript:

- outcome counts by status, and verdict counts from the L92 `verdict` column;
- `successRate`: pass over (pass + fail + needs attention) when the bot had verdict runs in the
  window, otherwise completed over (completed + failed + timed out); null with no finished runs;
- median and maximum of `finished_at - started_at` over runs that started and finished;
- token sums, and `usageComplete` false when any run has `partial`, `unavailable` or null usage;
- `byModel`, grouped by the run's recorded `modelSelection` (L94). Runs recorded before L94 group
  under the bot's current model, marked as such.

SQLite has no median function and the row count is small, so computing in TypeScript is simpler
than SQL window functions.

## Storage

Migration 7 `RunUsage` (next free id if another bots migration landed first):

```sql
ALTER TABLE fork_bots_runs ADD COLUMN input_tokens INTEGER;
ALTER TABLE fork_bots_runs ADD COLUMN cached_input_tokens INTEGER;
ALTER TABLE fork_bots_runs ADD COLUMN output_tokens INTEGER;
ALTER TABLE fork_bots_runs ADD COLUMN usage_status TEXT;
CREATE INDEX fork_bots_runs_finished ON fork_bots_runs(bot_id, finished_at);
```

There is no daily rollup table. Run rows are the source of truth and the volume is bounded by
retention. A rollup would need its own retention and could disagree with the runs.

## Clients

- `packages/client-runtime/src/fork/bots.ts`: `usageAtom({ since, until })`, refetched on
  window change and after a run finishes (folded from `watch`, debounced to one refetch per
  5 seconds).
- `apps/web/src/fork/bots/BotsUsage.tsx`: the Usage tab. One row per bot with the summary line,
  expandable to `byModel`. Windows: 24 hours, 7 days, 30 days.
- `apps/web/src/fork/bots/BotEditor.tsx`: a Budget group with the two optional fields and a
  static meter from `budgets[botId]`.
- `apps/web/src/fork/bots/BotsUsageSection.tsx` (rendered by the seam): converts the Usage page's
  `shownWindow` (`sinceDay`/`untilDay`, or `sinceTime`/`untilTime` for hourly windows, in
  `timeZone`) to ISO bounds, calls `usage` on each selected environment that supports
  `bots-budgets`, and sums. The share is `botTokens / totalTokens`. Both measure processed tokens
  as input including cache reads and writes plus output: the Usage page sums uncached, cached,
  cache creation and output (`packages/shared/src/usageMerge.ts:513`). They come from different
  sources (provider transcripts there, live turn events here), so the share is labelled
  approximate, and shown as "at least" when `usageComplete` is false for any environment.
- Run refusals show `message` as a toast; `retryAt` is formatted in local time.

## Agent-facing tools

- `loom_bots_usage` (read): `{ days? (1 to 30, default 7), botId? }`, the rows and budget states.
  An orchestrator uses it to pick the bot or model that works, and to see a budget before it
  plans a batch.
- `loom_bots_define` accepts `budget`. `loom_bots_run` refusals carry `retryAt` in the tool error.

## Performance

`usage` touches only fork SQLite and is called on demand. Reading provider turns happens once
per run at the terminal step, never on page load.

## Alternatives considered

- **Usage from the Usage page's transcript scan.** It already prices tokens, but it is keyed by
  provider session files, which do not map back to bot runs without a second index.
- **Dollar budgets.** Pricing lives in the Usage service and depends on provider rate tables and
  overrides; a token ceiling is predictable and needs no prices.
- **A new `budget` error reason.** Clearer in code, but older clients fail to decode it.
