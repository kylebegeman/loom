# L94 technical design

## Overview

```text
fork_bots_runs ── isBotInboxRun ──▶ loom.bots.inbox ──▶ Inbox tab + "2 need attention"
                                           ▲
loom.bots.watch (run changes) ─────────────┘ client re-evaluates membership per change

thread shells (already in the client) ── bot-run threads with pendingRuntimeRequest ──▶ Waiting for you

retry   ─▶ BotsService.run(same inputs, model override?) ─▶ new run with retryOf
dismiss ─▶ dismissed_at
promote ─▶ ThreadManagementService.dispatch(thread.fork) ─▶ sidebar thread, promoted_thread_id
```

The inbox is a view over the runs table, not a second store. Anything that wants Kyle's
attention later (L95 budget refusals for trigger-started runs, L97 skipped firings) writes a run
row that matches the predicate, so the inbox never needs a new item kind.

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BOTS_INBOX_FEATURE = "bots-inbox"`.
- `BotRun` gains, all `Schema.optionalKey` so older servers and clients keep decoding:
  - `dismissedAt: NullOr(String)`;
  - `retryOf: NullOr(BotRunId)` and `retriedBy: NullOr(BotRunId)`;
  - `promotedThreadId: NullOr(ThreadId)`;
  - `modelSelection: ModelSelection`, the model the run actually used;
  - `checkoutThreadId: NullOr(ThreadId)`, the checkout a `caller` bot ran in (L90 accepts it on
    `BotsRunInput` but does not store it, so a retry could not find the same checkout).
- `isBotInboxRun(run)`, a pure predicate shared by server and clients:
  `dismissedAt` is null, `retriedBy` is null, and either `status` is `failed` or `timed_out`, or
  `status` is `completed` with `verdict?.verdict === "needs_attention"` (L92; absent without it).
  `cancelled` and verdict `fail` never match.

| Tag                 | Payload                                       | Success                    | Scope                   |
| ------------------- | --------------------------------------------- | -------------------------- | ----------------------- |
| `loom.bots.inbox`   | `{ dismissed?, before?, limit }` (at most 50) | `{ runs, total, handled?, hasMore }` | `orchestration:read`    |
| `loom.bots.retry`   | `{ runId, modelSelection? }`                  | `BotRun` (the new run)     | `orchestration:operate` |
| `loom.bots.dismiss` | `{ runIds (1 to 50), dismissed }`             | `{ runs }`                 | `orchestration:operate` |
| `loom.bots.promote` | `{ runId }`                                   | `{ threadId, created }`    | `orchestration:operate` |

`dismissed: true` lists dismissed runs instead, for the Restore view. `total` counts every
matching run, so the badge does not depend on paging. `handled` counts the matches whose calling
agent already has the outcome (`isBotRunHandledByCaller`: an agent's `notify` run whose result
was delivered, recorded in `delivered_at`, since `notified_at` also marks a failed delivery).
Older servers omit it, which counts as none. No `BotsChange` member is added; updated
runs flow through the existing `run` change, which older clients decode because the new keys are
optional.

## Server

### Recording what ran

L89's `BotsService.run` (`apps/server/src/fork/bots/BotsService.ts`) writes the run row from the loaded
definition. It now also writes `model_selection_json` (the definition's model or the override)
and `checkout_thread_id` (the resolved L90 checkout thread, or null). Inbox rows, L95 usage and
L98 replay read these from the run, not from a definition that may have changed since.

### Retry

`BotsService.retry({ runId, modelSelection? }, caller)`:

1. Load the run. Refuse with `invalid` unless `isBotInboxRun(run)` holds; a retried run cannot
   be retried twice ("This run was already retried; retry the newer run.").
2. Call `run` with `{ botId, inputs, projectId }` from the old run, the old run's
   `callerThreadId` and `checkoutThreadId` (L90) when set, and the override model. The current
   definition runs; the new row records its own `botVersion`. Archived or deleted bots refuse with
   their L89 errors.
3. In one transaction with the new row: set the new run's `retry_of` and the old run's
   `retried_by`. Publish both runs.

Agent callers keep L89's runtime mode rank check; the model override does not change modes. A
model the provider cannot run fails at launch like any run, which lands the retry back in the
inbox with the launch error.

Runs from a batch (L93) carry `batchId`; a retry from the inbox stays in the same batch by
replacing that item's `runId` (old id into `previousRunIds`), so the batch report matches.

### Dismiss

`dismiss({ runIds, dismissed })` sets or clears `dismissed_at` for terminal runs. Running runs
are refused. Both directions publish the run.

### Promote

`BotsService.promote({ runId }, caller)`:

1. The run must be terminal; a running run is promoted after it ends or is cancelled, so two
   agents never write to the same provider session.
2. If `promoted_thread_id` is set and that thread still exists, return it with `created: false`.
3. Dispatch through `ThreadManagementService.dispatch`
   (`apps/server/src/orchestration-v2/ThreadManagementService.ts:323`) the command
   `thread.fork` (`packages/contracts/src/orchestrationV2.ts:2911`):
   - `commandId: bot-promote:<runId>`, so a retried request is the same command;
   - `sourceThreadId`: the run's thread;
   - `targetThreadId: bot-open-<runId>`, which deliberately does not start with
     `BOT_RUN_THREAD_PREFIX`, so every L89 filter shows it;
   - `sourcePoint: { type: "latest_stable" }`
     (`packages/contracts/src/orchestrationV2.ts:134`);
   - `title: "<bot name>: <first input value>"`, cut to 120 characters;
   - `createdBy` from the caller, `creationSource: "server"`.

   This is the same dispatch `t3_thread_fork` performs
   (`apps/server/src/mcp/toolkits/thread/handlers.ts:114-132`). The fork follows `thread.fork`'s
   own workspace and context-transfer rules; the bot service adds nothing.

4. Store `promoted_thread_id`, publish the run, return `{ threadId, created: true }`.

L89 references describe a `ThreadForkService`; in current source `ThreadForkServiceV2` only plans
a fork, and forking is a `thread.fork` dispatch.

### Waiting runs

A run blocked on an approval or a question is still `running`. The thread shell carries
`pendingRuntimeRequest` with its `kind` and `createdAt`
(`packages/contracts/src/orchestrationV2.ts:1781,1829`), and the client already holds shells for
run threads: L89's filters drop them from the sidebar list and the pending-request list, not from
`environmentThreadsAtom` (`packages/client-runtime/src/state/threadShell.ts:164`). The "Waiting for
you" section is a selector over those shells, joined to running runs by `botRunThreadId`.

It stays client-only. The MCP `loom_bots_inbox` tool returns failed and needs-attention runs; an
agent that started a run reads its state with `loom_bots_run_status`.

### Storage

Migration 6 `RunInbox` (next free id if another bots migration landed first):

```sql
ALTER TABLE fork_bots_runs ADD COLUMN dismissed_at TEXT;
ALTER TABLE fork_bots_runs ADD COLUMN retry_of TEXT;
ALTER TABLE fork_bots_runs ADD COLUMN retried_by TEXT;
ALTER TABLE fork_bots_runs ADD COLUMN promoted_thread_id TEXT;
ALTER TABLE fork_bots_runs ADD COLUMN model_selection_json TEXT;
ALTER TABLE fork_bots_runs ADD COLUMN checkout_thread_id TEXT;
CREATE INDEX fork_bots_runs_inbox ON fork_bots_runs(status, dismissed_at, created_at DESC);
```

Existing rows get null columns; a null `model_selection_json` decodes as an absent key, and a
retry of such a row uses the bot's current model. The
inbox query applies the predicate in SQL with the L92 `verdict` column, so it never loads runs it
will drop. Pruning (L89) treats inbox items like any other run.

## Clients

- `packages/client-runtime/src/fork/bots.ts`: `inboxAtom` (first page and `total`), folded with
  `watch` run changes: a run that starts or stops matching `isBotInboxRun` is inserted or removed
  and `total` and `handled` adjusted, without refetching. `waitingRunsAtom` per environment. Commands for retry,
  dismiss and promote.
- `apps/web/src/fork/bots/BotsInbox.tsx`: Waiting for you, Needs attention, the Dismissed filter.
  Each row: bot, inputs, duration, model, error or verdict summary, batch link, and the actions.
  The model picker reuses the bot editor's picker.
- The Bots footer entry shows `total - handled + waiting` as "N need attention" (singular "1
  needs attention"); hidden at zero. Handled runs fold into a "Handled by the calling agent"
  group at the bottom of Needs you.
- Promote navigates to the returned thread.
- Palette: "Open bots inbox".

## Agent-facing tools

- `loom_bots_inbox` (read): `{ limit? }`, the newest inbox runs with error, verdict summary and
  the model.
- `loom_bots_retry` (write): `{ runId, modelSelection? }`.
- `loom_bots_dismiss` (write): `{ runIds, dismissed }`.

Promotion stays on RPC: an agent that wants a run's conversation forks it with `t3_thread_fork`
on the run's thread id, which it already has.

## Performance

The count comes from one indexed `COUNT(*)` on first load and is then maintained from run
changes. The waiting selector touches only threads whose id has the bot run prefix.

## Alternatives considered

- **Unhide failed run threads in the sidebar.** No new UI, but the sidebar would fill with bot
  noise and lose the batch and verdict context.
- **A separate inbox table.** It would need its own lifecycle and could disagree with the runs it
  describes.
- **Restarting the run thread for retry.** Sending a new message into the failed thread keeps
  history together, but mixes two attempts in one transcript and breaks the one-run-one-thread
  rule L89 relies on.
