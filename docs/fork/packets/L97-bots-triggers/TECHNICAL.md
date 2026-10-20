# L97 technical design

## Overview

```text
event store ── EventSinkV2.stream({ afterSequence: cursor, eventType }) (unbounded, internal)
   thread.pull-request-link-updated ─▶ checks-failing / pr-opened matcher
   thread.settled                   ─▶ thread-settled matcher
/api/hooks/bot-trigger-<id>/<token> ─▶ (seam) BotTriggers.webhook ─▶ webhook / merge-conflict
schedule loop (Schedule.ts helpers) ─▶ schedule

matcher ─▶ BotTriggers.fire(trigger, event)
   filter ─▶ dedupe key (unique) ─▶ cooldown, daily limit ─▶ version check ─▶ BotBudgets.check
   ok      ─▶ BotsService.startRunWith(definition, inputs, caller, { triggerId })
   refused ─▶ skipped run row (failed, started_at null) ─▶ inbox (L94)
   firing row either way ─▶ firing log
```

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BOTS_TRIGGERS_FEATURE = "bots-triggers"`.
- `BotTriggerId`: `trg_` plus 20 lowercase hex characters.
- `BotTriggerEvent`, a union tagged by `kind`:
  - `{ kind: "pull-request-checks-failing", projectId?, repository?, branchPattern? }`;
  - `{ kind: "pull-request-opened", projectId?, repository?, branchPattern? }`;
  - `{ kind: "thread-settled", projectId }` (required, so a trigger never fires on every thread);
  - `{ kind: "merge-conflict" }`;
  - `{ kind: "webhook", signature?: ScheduledTaskWebhookSignature }`
    (`packages/contracts/src/scheduledTask.ts:71`);
  - `{ kind: "schedule", schedule: ScheduledTaskIntervalSchedule | ScheduledTaskFixedTimeSchedule }`
    (`packages/contracts/src/scheduledTask.ts:127`, without the webhook member).
- `BotTriggerMapping = Record<BotParameterName, { field: String } | { value: BotInputValue }>`.
  Fields are dotted paths into the event's fields (below).
- `BotTrigger = { id, botId, name, event, mapping, enabled, pinnedVersion: Int, followLatest:
Boolean, cooldownMinutes (0 to 1,440, default 10), dailyLimit (1 to 500, default 20),
createdBy: BotCreator, createdAt, updatedAt, lastFiredAt, webhookUrl? }`. `webhookUrl` is
  computed per request and never stored; the token and secret never leave the server except in
  that URL, shown to callers with `orchestration:operate`.
- `BotTriggerFiring = { id, triggerId, eventKey, eventSummary, firedAt, outcome: Literals(["run",
"skipped"]), runId: NullOr(BotRunId), reason: NullOr(String) }`.
- `BotRun` gains `triggerId: Schema.optionalKey(Schema.NullOr(BotTriggerId))`. Triggered runs use
  the existing `startedBy` literal of the trigger's creator; a new `"trigger"` literal would break
  older clients' decoding.

| Tag                            | Payload                                   | Success                | Scope                   |
| ------------------------------ | ----------------------------------------- | ---------------------- | ----------------------- |
| `loom.bots.listTriggers`       | `{ botId? }`                              | `{ triggers }`         | `orchestration:read`    |
| `loom.bots.saveTrigger`        | trigger fields, `expectedUpdatedAt?`      | `BotTrigger`           | `orchestration:operate` |
| `loom.bots.deleteTrigger`      | `{ triggerId }`                           | `{}`                   | `orchestration:operate` |
| `loom.bots.setTriggerEnabled`  | `{ triggerId, enabled }`                  | `BotTrigger`           | `orchestration:operate` |
| `loom.bots.repinTrigger`       | `{ triggerId, version?, followLatest? }`  | `BotTrigger`           | `orchestration:operate` |
| `loom.bots.testTrigger`        | `{ triggerId, fields }`                   | `BotTriggerFiring`     | `orchestration:operate` |
| `loom.bots.triggerFirings`     | `{ triggerId, before?, limit (1 to 50) }` | `{ firings, hasMore }` | `orchestration:read`    |
| `loom.bots.rotateTriggerToken` | `{ triggerId }`                           | `BotTrigger`           | `orchestration:operate` |

Trigger and firing updates reach the Bots page through `loom.bots.watchTriggers`, a separate
stream of `BotTriggerChange` (`trigger`, `trigger-deleted`, `firing`), because adding members to
`BotsChange` (`packages/contracts/src/fork/bots.ts:152`) would break older clients.

## Event fields

Each kind exposes a fixed set of fields for mapping and for the dedupe key:

| Kind                        | Fields                                                                                                      | Dedupe key                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| pull-request-checks-failing | `repository`, `number`, `url`, `title`, `headBranch`, `baseBranch`, `failedChecks` (comma list), `threadId` | `host/repository#number@headSha` (or `@syncedAt` day when no head sha)   |
| pull-request-opened         | same without `failedChecks`                                                                                 | `host/repository#number`                                                 |
| thread-settled              | `threadId`, `title`, `branch`, `projectId`                                                                  | `threadId@settledSequence`                                               |
| merge-conflict              | `tag`, `branch`, `file` (one firing per file)                                                               | `tag:file`                                                               |
| webhook                     | `body.<path>`, `headers.<name>`, `query.<name>`                                                             | `x-github-delivery`, else the relay delivery id, else a new id each time |
| schedule                    | `firedAt`                                                                                                   | the due time                                                             |

## Reading the event store

`apps/server/src/fork/bots/triggers/BotTriggerReactor.ts`, a `Layer.effectDiscard` that forks
under `forkParked` (`apps/server/src/serverActivation.ts:27`):

- One stream per event type: `EventSinkV2.stream({ afterSequence: cursor, eventType })`
  (`apps/server/src/orchestration-v2/EventSink.ts:177-183`), without `bounded`. The comment on
  that option says internal workers must not drop their subscription under load. The RPC-facing
  `streamStoredEventsFrom` sets `bounded: true` (`apps/server/src/orchestration-v2/Orchestrator.ts:11735-11736`)
  and fails a slow subscriber after its buffer fills; `streamDomainEvents` starts at the latest
  sequence (`:11744-11751`) and would miss events that happened while the server was down.
- The cursor per event type lives in `fork_bots_trigger_cursors`. The first start initializes it
  with `EventSinkV2.latestSequence()` (`EventSink.ts:184`), so installing the packet does not
  replay history. After each event the handler writes firings and advances the cursor in one
  transaction, so a crash replays at most the event in flight, and dedupe absorbs it.
- On stream failure the reactor logs and resubscribes from the stored cursor after 5 seconds.
- Events are handled one at a time per stream. Starting a run is asynchronous (L89 queues it), so
  a slow bot never blocks the stream.

`thread.pull-request-link-updated` (`packages/contracts/src/orchestrationV2.ts:1628`) carries a
`ThreadPullRequestLink` (`packages/contracts/src/threadPullRequest.ts:101`) with `snapshot`
(`checksState`, `:54`, one of `passing`, `failing`, `pending`,
`packages/contracts/src/pullRequest.ts:53`) and, when a thread watches it, `watch.headSha` and
`watch.failedChecks` (`threadPullRequest.ts:86-87`). The matcher keeps the last seen checks state
per pull request key in `fork_bots_trigger_pr_state` and fires checks-failing only on a change to
`failing`, and opened only the first time a key appears with state `open`. Snapshots come from
`PullRequestSyncReactor`, which re-syncs idle pull requests every 15 minutes
(`apps/server/src/orchestration-v2/PullRequestSyncReactor.ts:39`), so an unwatched pull request
can be noticed up to that late. The trigger editor says so.

`thread.settled` is one of the thread lifecycle events carrying `OrchestrationV2AppThread`
(`packages/contracts/src/orchestrationV2.ts:1606,1624`). Bot run threads (`isBotRunThreadId`) and
the drafting threads of L96 never fire, so a bot cannot trigger itself by settling.

## Webhooks

Bot trigger hooks share the scheduled task route `/api/hooks/:hookId/:token`
(`packages/contracts/src/environmentHttp.ts:745`), because that is the only path the T3 Connect
relay forwards (`infra/relay/src/hooks/upstream.ts:90`). The hook id is `bot-trigger-<triggerId>`.
The seam in `webhookRoute.ts` routes those ids to `BotTriggers.webhook` before
`scheduledTasks.triggerWebhook` (`apps/server/src/scheduledTasks/webhookRoute.ts:84`); everything
before that line (body cap, relay proof, header normalization) is shared. `BotTriggers.webhook`
returns the same result union the route already maps to status codes (`:111-126`).

`BotTriggers.webhook`:

1. Load the trigger; unknown id, wrong token (`constantTimeEquals`,
   `apps/server/src/scheduledTasks/webhookVerification.ts:7`) or disabled give `not_found` or
   `disabled`, matching scheduled tasks so the URL does not reveal which hooks exist.
2. Verify the optional signature with `verifyWebhookSignature` (`webhookVerification.ts:13`).
3. Rate limit: 60 accepted deliveries per trigger per minute, the same constant scheduled tasks
   use (`apps/server/src/scheduledTasks/ScheduledTaskService.ts:64`).
4. Resolve mapped fields with `resolveWebhookField(request, path)` in
   `triggers/webhookFields.ts`: JSON body paths, lowercase header names, query names.
   `webhookTemplate.ts`'s resolver is not exported, and exporting it would be a second seam for
   about 20 lines.
5. `fire` and return `accepted` with the firing id.

Webhook values are untrusted. `renderInstructions` (`apps/server/src/fork/bots/render.ts:109`)
gains an `untrusted` option that wraps each substituted value in `<webhook-data-ID>` tags with a
fresh id and appends the same closing note scheduled task prompts use
(`apps/server/src/scheduledTasks/webhookTemplate.ts:147-165`).

The URL shown to Kyle is built like a scheduled task's: the relay base from
`ScheduledTaskWebhookOrigin` (`ScheduledTaskService.ts:84`, `relayHookBaseUrl` at `:72`) when T3
Connect is on, otherwise the server's own origin.

### Merge conflicts

A merge-conflict trigger is a webhook trigger with a fixed body shape. `scripts/fork/loom.sh`
(fork-owned) reads an optional URL from `LOOM_BOTS_CONFLICT_HOOK` (set in the gitignored
`.env`), and in the conflict branch of `cmd_integrate` (`scripts/fork/loom.sh:541-549`) posts
`{ "tag", "branch", "files": [...] }` from `git diff --name-only --diff-filter=U` with a 5-second
timeout, ignoring failures so integrate's own output is unchanged. The trigger fires once per
file. With L93 present, the files run as one batch named after the tag instead of separate runs.

## Schedules

`triggers/BotTriggerSchedule.ts` keeps `next_fire_at` on each schedule trigger and wakes at the
earliest one (re-evaluated when a trigger is saved), using `nextScheduledRunAt` and
`isMissedFixedTimeRun` (`apps/server/src/scheduledTasks/Schedule.ts:12,70`) so the rules match
scheduled tasks exactly. These helpers are plain exported functions, so no seam is needed.

## Firing

`BotTriggers.fire(trigger, event)`:

1. **Filter.** Project, repository and `branchPattern` (glob with `*`).
2. **Dedupe.** Insert into `fork_bots_trigger_firings` with `UNIQUE(trigger_id, event_key)`;
   a conflict ends here silently.
3. **Limits.** Within `cooldownMinutes` of the last run firing, or at `dailyLimit` in the last 24
   hours, the firing is skipped with a reason.
4. **Version.** When the bot's version differs from `pinnedVersion` and `followLatest` is false:
   with L98, start the pinned version's stored definition; without it, skip with "Bot changed
   since this trigger was set."
5. **Inputs.** Apply the mapping, then `validateInputs` (`render.ts:78`). A missing required
   field skips the firing.
6. **Budget.** `BotBudgets.check` from L95 when present.
7. **Start.** `startRunWith(definition, inputs, caller, { triggerId })`, the internal entry L93
   added. The caller is the trigger's creator with the runtime mode stored at creation, so an
   agent-created trigger can never start a broader bot than the agent could
   (`BotCaller`, `apps/server/src/fork/bots/BotsService.ts:54`).

A skipped firing writes a run row with status `failed`, `started_at` null, the trigger id and the
reason as `error`. That row is an inbox item (L94), does not count against the budget (L95), and
retry from the inbox starts it normally. Skips for dedupe never write a run.

## Storage

Migration 9 `Triggers` (next free id if another bots migration landed first):

- `fork_bots_triggers(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, trigger_json TEXT NOT NULL,
enabled INTEGER NOT NULL, pinned_version INTEGER NOT NULL, follow_latest INTEGER NOT NULL,
created_by TEXT NOT NULL, creator_runtime_mode TEXT, webhook_token TEXT, webhook_secret TEXT,
next_fire_at TEXT, last_fired_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`.
- `fork_bots_trigger_firings(id TEXT PRIMARY KEY, trigger_id TEXT NOT NULL, event_key TEXT NOT
NULL, event_summary TEXT NOT NULL, fired_at TEXT NOT NULL, outcome TEXT NOT NULL, run_id TEXT,
reason TEXT, UNIQUE(trigger_id, event_key))`, pruned to 500 per trigger.
- `fork_bots_trigger_cursors(event_type TEXT PRIMARY KEY, after_sequence INTEGER NOT NULL)`.
- `fork_bots_trigger_pr_state(pr_key TEXT PRIMARY KEY, checks_state TEXT, head_sha TEXT,
seen_open INTEGER NOT NULL, updated_at TEXT NOT NULL)`, pruned after 90 days without updates.
- `ALTER TABLE fork_bots_runs ADD COLUMN trigger_id TEXT`.

The webhook token and secret are stored like scheduled task hooks store theirs (in the row).
Deleting a bot deletes its triggers.

## Clients

- `packages/client-runtime/src/fork/bots.ts`: `triggersAtom` folded from `watchTriggers`,
  firing pages, commands.
- `apps/web/src/fork/bots/BotTriggers.tsx` (tab and per-bot section),
  `BotTriggerEditor.tsx` (event, filters, mapping table, version, limits, webhook URL with copy
  and rotate), `BotTriggerFirings.tsx`.
- Palette: "New bot trigger".

## Agent-facing tools

- `loom_bots_triggers` (read): list with last firing.
- `loom_bots_save_trigger` (write): create or update; the creator's runtime mode is recorded.
- `loom_bots_set_trigger_enabled` (write).

Webhook URLs are returned to agents only from `loom_bots_save_trigger` on creation, so an agent
that needs to register one can.

## Performance

Two filtered event subscriptions; each event costs one indexed lookup of enabled triggers for
that kind (cached in memory, refreshed on trigger changes) and at most a few writes when a
trigger matches. The schedule loop sleeps until the next due time.

## Alternatives considered

- **Bot triggers as scheduled tasks.** Scheduled tasks launch a thread with a prompt; a bot run
  needs the bot's settings, caps and run row. Wrapping one in the other would launch two threads.
- **A separate hook path.** Simpler routing, but the relay only forwards `/api/hooks/...`, so
  webhook triggers would not work through T3 Connect.
- **Reading the PR watch's wake messages.** Those go to one thread and only while it watches; the
  link snapshot covers every linked pull request.
