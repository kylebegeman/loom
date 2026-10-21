# L97 testing

## Server (`vp test run apps/server/src/fork/bots apps/server/src/scheduledTasks/webhookRoute.test.ts`)

- `triggers/matchers.test.ts` (pure):
  - checks state `pending` then `failing` fires once; `failing` again on the same head does not;
    a new head sha while failing fires again;
  - a pull request key seen first as `open` fires opened once; seen first as merged never fires;
  - thread settled fires only for the trigger's project and never for `bot-run-` threads;
  - branch patterns: `release/*` matches `release/1.2`, not `main`.
- `triggers/BotTriggers.test.ts` over a store fixture with fake `BotsService` and a test clock:
  - the same event key twice starts one run;
  - cooldown and daily limit skip with a reason and write an inbox run row with `started_at`
    null;
  - a changed bot without L98 and without `followLatest` skips with "Bot changed"; with
    `followLatest` it runs the current version;
  - a missing required mapped field skips; mapped values reach `startRunWith`;
  - an agent-created trigger keeps the agent's runtime mode and is refused for a broader bot;
  - a budget refusal (L95 fake) skips with its message.
- `triggers/BotTriggerReactor.test.ts` with an in-memory event sink:
  - first start sets the cursor to the latest sequence and does not replay;
  - after a simulated restart, events committed while stopped are handled once;
  - a stream failure resubscribes from the stored cursor (drive the failure, then await the
    persisted cursor; no sleeps).
- `triggers/BotTriggerSchedule.test.ts`: interval due while stopped runs once; a fixed time
  missed by more than 10 minutes moves to the next time.
- `triggers/webhook.test.ts`: wrong token gives `not_found`; disabled gives `disabled`; a bad
  signature gives `rejected_signature`; the 61st delivery in a minute gives `rate_limited`;
  body, header and query fields resolve; GitHub's delivery header dedupes; rendered instructions
  wrap webhook values in data tags.
- `webhookRoute.test.ts` (existing upstream test file, one added case): a `bot-trigger-` hook id
  reaches the bot handler and a scheduled task id still reaches `triggerWebhook`.
- Migration test passes with the new id.

## Script

- `scripts/fork/loom.sh`: with `LOOM_BOTS_CONFLICT_HOOK` unset, the conflict output is unchanged;
  with it pointing at an unreachable address, integrate still exits 2 within the timeout. Checked
  by hand in a scratch repository.

## Clients

- Mapping validation in the editor (pure): every required parameter mapped; field names offered
  per event kind.
- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`; lint changed
  files including `webhookRoute.ts`.

## Real client

When Kyle asks: create a thread-settled trigger in a test project, settle a thread, and see the
run and the firing log; create a webhook trigger and `curl` it with a JSON body.
