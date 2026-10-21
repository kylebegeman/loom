# L91 technical design

## Overview

```text
ChatComposer "/" trigger ─ fork: ext-composer-menu slash source ─▶ /bot:<id> items
   select ─▶ selectForkComposerItem ─▶ bots drawer store (open, botId)
   drawer (fork: ext-composer) ─ Enter ─RPC loom.bots.run { callerThreadId, projectId, notify }─┐
   footer chip (fork: ext-composer) ◀── listRuns filtered by callerThreadId ◀── watch ──────────┤
                                                                                                ▼
                                                                      BotsService (L89 lifecycle)
                                                       terminal row + notify ─▶ ThreadManagementService.sendToThread
Agent ─ loom_bots_run { notify: true } ─────────────────────────────────────────▲
```

## Composer extension points

### `ext-composer` (§11)

Lands as specified, at current anchors in `apps/web/src/components/chat/ChatComposer.tsx`:
the import, the key handler call in `onComposerCommandKey` (:4147, after the Shift+Tab block),
`useForkComposerDrawer` after it, `...forkComposerBlockDefs(...)` at the end of
`restingBlockDefs` (:5051), and the drawer render after the stash drawer (:6610) inside
`ComposerCommandMenuLayer` (:977). The registry `apps/web/src/fork/composer/registry.tsx` exposes
`FORK_COMPOSER_BLOCKS`, `FORK_COMPOSER_KEY_HANDLERS` and `FORK_COMPOSER_DRAWERS`; at most one
drawer is open at a time, chosen by a small atom in the registry.

### `ext-composer-menu` (§11b) and the slash source

The §11b seams land as outlined, with one addition. `/` is detected upstream
(`detectComposerTrigger`, `apps/web/src/composer-logic.ts:261`, kind `slash-command`), and the
slash branch of `composerMenuItems` (`ChatComposer.tsx:2618`, branch at :2638) builds its list
from built-in commands, provider commands and skills, filters by prompt position
(`slashCommandItemsForPromptPosition`, :2696) and ranks with `searchSlashCommandItems` (:2700).
`searchSlashCommandItems` only accepts upstream item types
(`apps/web/src/components/chat/composerSlashCommandSearch.ts:10-13`), so fork items cannot pass
through it. The seam:

```diff
+      // fork: ext-composer-menu
+      const forkSlash = searchForkSlashItems(forkSlashItems, query);
-      return searchSlashCommandItems(slashCommandItems, query);
+      return [...searchSlashCommandItems(slashCommandItems, query), ...forkSlash]; // fork: ext-composer-menu
```

`forkSlashItems` comes from `useForkSlashMenuItems({ environmentId, threadRef })`, called next to
the §11b `useForkComposerMenuItems` hook. Both live in `apps/web/src/fork/composer/menu.ts`, which
also holds `FORK_SLASH_SOURCES: ReadonlyArray<{ id; useItems(context); }>`. Items are §11b's
`ForkComposerCommandItem` (`{ id, type: "loom", triggerId, label, description, value }`), so
selection goes through the single §11b branch in `onSelectComposerItem` (:3763).
`searchForkSlashItems` ranks with `scoreQueryMatch` from `@t3tools/shared/searchRanking`, using the
same bases as `composerSlashCommandSearch.ts` so ordering feels the same.

## Bots in the composer

`apps/web/src/fork/bots/composer/`:

- `slashSource.ts`: registered in `FORK_SLASH_SOURCES`. Reads the bots list atom from
  `packages/client-runtime/src/fork/bots.ts` for the thread's environment, keeps bots that are not
  archived and whose `scopeProjectId` is null or the thread's project, and maps each to
  `{ id: "bot:<botId>", type: "loom", triggerId: "bots", label: "/bot:<botId>", description:
bot.description || bot.name, value: botId }`. Returns nothing unless the environment advertises
  `bots-invocation`.
- `select.ts`: `selectForkComposerItem` handler for `triggerId: "bots"`: replaces the trigger
  range with `""` through `applyPromptReplacement` with `expectedText`, then opens the bots drawer
  for `botId`.
- `BotRunDrawer.tsx`: registered in `FORK_COMPOSER_DRAWERS`. Renders the L89 `BotRunForm` in a
  compact layout, plus the "Post result to this thread" switch. Enter submits when the form is
  valid; Escape closes. A bot with no parameters skips the drawer and runs immediately.
- `AttachedRunsChip.tsx`: registered in `FORK_COMPOSER_BLOCKS`. Shows a static badge with the
  number of active runs whose `callerThreadId` is this thread; it hides when there are none. Its
  popover lists those runs (status, bot, start time) with Open (the L89 run view) and Cancel.

Run request from the drawer:

```ts
loom.bots.run({
  botId,
  inputs,
  projectId: thread.projectId, // ignored by the server if the bot pins its own project
  callerThreadId: thread.id,
  notify,
});
```

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BotsRunInput` gains `callerThreadId: Schema.optionalKey(ThreadId)` and
  `notify: Schema.optionalKey(Schema.Boolean)`.
- `BotRun` gains `notify: Schema.optionalKey(Schema.Boolean)`; absent means false, so an older
  server's rows decode unchanged.
- `BOTS_INVOCATION_FEATURE = "bots-invocation"`.

No new RPC tags.

## Server

- Caller validation in `BotsService.run`: when `callerThreadId` is given from RPC, the service
  reads `ThreadManagementService.getThreadShell` (exposed on the shape, `ThreadManagementService.ts`
  near :370) and refuses with `invalid` if the thread is missing, deleted or archived, or is itself
  a bot run (`isBotRunThreadId`). From MCP, `callerThreadId` stays the authenticated caller as in
  L89 and cannot be overridden.
- Migration 3 `RunNotify`: `ALTER TABLE fork_bots_runs ADD COLUMN notify INTEGER NOT NULL DEFAULT
0`.
- Delivery: after the terminal row is written (L89 lifecycle step 5) and `notify` is true and
  `callerThreadId` is set, the run fiber calls `ThreadManagementService.sendToThread`
  (`ThreadManagementService.ts:376`, input at :121) with:
  - `projectId` from the caller's shell, `threadId: callerThreadId`;
  - `commandId` and `messageId` derived from `bot-run-notify:<runId>`, so a retry after a crash
    replays the recorded receipt instead of sending twice (`hasReceipt`, same file);
  - `senderThreadId: run.threadId`, so the message is attributed to the run thread;
  - `mode: "auto"` (`ThreadManagementSendMode`, :60), which starts an idle thread, steers an
    active one, or queues, matching how delegated completions wake a parent;
  - `createdBy: "system"`, `creationSource: "server"` (`OrchestrationV2Actor`,
    `OrchestrationV2CreationSource`, `packages/contracts/src/orchestrationV2.ts:76,79`).
- Message text: one header line (`Bot run finished: Reviewer (completed, 2m 10s)`), the run id,
  then the captured reply (already capped at `BOTS_RESULT_MAX_BYTES`). Failure, cancel and timeout
  send the status and error instead.
- Delivery failure (caller archived meanwhile, provider disabled) is logged and appended to the
  run's `error` text as `Result delivery failed: <reason>`. It never changes the run status.
- Restart recovery: a terminal run with `notify` whose delivery has no receipt is delivered once
  on startup, inside the same `forkParked` recovery layer.

## Agent guidance

`packages/provider-core/src/fork/botsInstructions.ts` exports `LOOM_BOTS_INSTRUCTIONS`, appended
to `T3_CODE_ORCHESTRATION_SECTIONS` (`packages/provider-core/src/server/orchestrationInstructions.ts:9`)
by the 2-line seam. Draft text (keep it short; every agent turn carries it):

```text
## Loom bots

When exposed, `loom_bots_list` lists pinned, reusable jobs (for example merge conflict
resolution, review, verification). Before writing a `delegate_task` brief for a routine job,
check the list; if a bot fits, call `loom_bots_run` with its inputs instead. A bot keeps its own
model, modes and workspace. Use `wait: true` when you need the reply now, or `notify: true` to
continue working and be woken with the result. Do not run a bot from inside a bot run.
```

The sections are a static array, so the instructions cannot list the bots themselves; agents read
the live list from `loom_bots_list`.

`loom_bots_run` gains `notify?: boolean`. `wait` and `notify` together are refused as `invalid`.
A bot run thread calling `loom_bots_run` is refused with `permission`, which stops recursive bot
fan-out until L99 adds pipelines with explicit limits.

## Performance

The slash source reads an atom that L89 already keeps current through `loom.bots.watch`; opening
the `/` menu adds no request. The footer chip derives from the same runs atom and renders nothing
when idle. Delivery is one command per finished run that asked for it.

## Alternatives considered

- **A new trigger prefix such as `!`.** §11b supports it with no extra seam, but Kyle expects bots
  where commands and skills already are.
- **Inserting the rendered instructions into the composer.** That runs the brief in the current
  thread with the thread's model, losing the bot's pinned settings.
- **Listing bots inside the orchestration instructions.** They are static strings built at module
  load; making them dynamic needs a provider-path seam (EXTENSION-POINTS §16) for a list the
  agent can fetch on demand.
