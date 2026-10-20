# L95 testing

## Server (`vp test run apps/server/src/fork/bots`)

- `runUsage.test.ts` (pure summing): all complete turns give `complete`; one turn without tokens
  gives `partial`; no tokens at all gives `unavailable`; a turn with `hasSubagents: true` gives
  `partial`.
- `BotBudgets.test.ts` over a store fixture with a controlled clock:
  - 50 counted runs in 24 hours refuse the 51st with `retryAt` equal to the oldest run plus 24
    hours; at that instant the run is allowed;
  - never-started failed runs do not count;
  - the token ceiling counts finished runs only and computes `retryAt` from the oldest finished
    runs;
  - no budget means no refusal.
- `BotsService.budgets.test.ts` with fake launch and wait services: two concurrent starts at
  `runsPerDay - 1` admit exactly one; the refusal is `invalid` with `retryAt`; the terminal step
  stores usage from fake provider turns and a failing usage read leaves `usage: null` without
  failing the run.
- With L93: a batch over budget sets `pausedUntil`, keeps items pending, and resumes when the
  clock passes `retryAt` (advance the test clock; no sleeps).
- `BotsService.usage.test.ts`: success rate uses verdicts when present and completion otherwise;
  medians over odd and even counts; `byModel` grouping; `usageComplete` false with one partial
  run.
- Migration test passes with the new id.

## Clients

- `BotsUsageSection` window conversion: daily and hourly windows in a non-UTC time zone map to
  the right ISO bounds (unit test of the pure converter).
- Contract tests: `BotBudget` bounds; an L89-era `BotsError` schema decodes an error with
  `retryAt`.
- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`; lint changed
  files including `UsagePage.tsx`.

## Real client

When Kyle asks: set a budget of 2 runs on a test bot, run it three times and read the refusal;
open the Usage page and confirm the Bots section matches the Bots page Usage tab.
