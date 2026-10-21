# L94 testing

## Server (`vp test run apps/server/src/fork/bots`)

- `inbox.test.ts` (pure, in contracts or server): `isBotInboxRun` matches failed, timed out and
  needs-attention runs; not cancelled, verdict fail, dismissed or retried runs; a run without a
  `verdict` key never matches as needs-attention.
- `BotsService.inbox.test.ts` with fake launch and wait services:
  - `inbox` returns matching runs newest first with an accurate `total` across pages;
  - retry creates a run with the same inputs, links `retryOf` and `retriedBy`, and the old run
    leaves the inbox; a second retry of the old run is refused;
  - retry with a model override records that model on the new run only; the definition is
    unchanged;
  - retry of a batch item replaces the item's run and keeps the old id in `previousRunIds` (with
    L93 present);
  - dismiss and restore round-trip; dismissing a running run is refused;
  - promote dispatches one `thread.fork` with a target id that `isBotRunThreadId` rejects,
    records `promotedThreadId`, and a second promote returns the same thread with
    `created: false`; promoting a running run is refused.
- `BotsStore.test.ts`: rows written before migration 6 decode with absent keys; the SQL inbox
  query agrees with `isBotInboxRun` over a mixed fixture.
- Migration test passes with the new id.

## Clients

- Client runtime: folding a run change that crosses the predicate updates the list and `total`
  without a refetch; `waitingRunsAtom` returns a running bot run whose shell has a pending
  request and ignores ordinary threads.
- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`; lint changed
  files.

## Real client

When Kyle asks: make a bot fail (an invalid model or a 1-minute timeout on a long job), see the
count, retry on another model, dismiss and restore, and open a run as a thread and continue it.
Start a bot in approval-required mode and confirm it appears under Waiting for you.
