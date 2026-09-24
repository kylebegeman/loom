# L28 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no real sleeps. Timers run on
Effect's `TestClock`; asynchronous steps are awaited through `Deferred`s or the service's
snapshot `PubSub`, never by waiting.

## Automated tests

| File                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/fork/auto-resume/classify.test.ts`          | Each prefix classifies to its driver; unrelated errors (`GitHub API rate limit exceeded...`, `Turn failed`) return null; `parseWait` for `12m`, `3h 20m`, `5d 5h`, `2d`, missing; `workspaceCap` for both Codex workspace sentences.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/server/src/fork/auto-resume/upstreamWording.test.ts`   | Imports upstream's `codexUsageLimitMessage` (`apps/server/src/provider/Layers/codexUsageLimits.ts:218`) and checks the classifier accepts its output for an undefined snapshot, a snapshot with an exhausted session window (wait parsed within a minute of the real gap), and each `rateLimitReachedType`. Reads `ClaudeAdapter.ts` and `XAiAcpExtension.ts` as text and asserts every Claude and Grok prefix still occurs. This is the merge tripwire.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/fork/auto-resume/resetTime.test.ts`         | Window rule (latest exhausted future reset; ignores `usedPercent < 100` and past resets); Claude hint used when windows lack data; 30-day cap; message wait fallback; unknown. `pickSwitchTarget`: same group only, skips disabled, unauthenticated, unavailable, exhausted, and model-less instances; picks lowest max usage; deterministic tie-break; none when `continuation` is absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/server/src/fork/auto-resume/AutoResumeStore.test.ts`   | On `SqlitePersistenceMemory` (`apps/server/src/persistence/Layers/Sqlite.ts:41-44`) with the fork migrations: migrations are idempotent and only create `fork_` tables; same-turn duplicate detection is ignored; `claimDue` moves only due rows and only once; attempt carry-over; settings round trip with defaults for missing fields; prune and stale-resuming handling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/fork/auto-resume/AutoResumeReactor.test.ts` | With a fake `OrchestrationEngineService` (a `PubSub` of events, a recorded `dispatch`), fake `ProjectionSnapshotQuery` and fake `ProviderRegistry`, plus `TestClock`: a Codex `thread.session-set` error schedules at reset plus grace and publishes a snapshot; advancing the clock dispatches one `thread.turn.start` with the continue message and a `server:loom-auto-resume:` command id, then a `resumed` marker; resend of the original message when the failed turn produced nothing; a user `thread.turn-start-requested` cancels; our own does not; `thread.archived` cancels; windows still exhausted at resume time defer without consuming an attempt; unknown reset follows the probe schedule and gives up after `maxAttempts`; a dispatch failure marks failed with no retry; disabled driver ignores stops; catch-up from a stored cursor processes events missed while stopped and the first run starts at `latestSequence`; switching on with a qualifying instance dispatches with that `instanceId` after 10 s. |
| `apps/web/src/fork/auto-resume/format.test.ts`               | `formatWait` output matches upstream's style for minutes, hours, days, and clamps negative waits to "now".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Also run the extension point invariant tests this packet adds entries to:
`apps/server/src/fork/rpcAuthorization.test.ts`, `apps/server/src/fork/features.test.ts`,
`apps/server/src/fork/persistence/migrations.test.ts`.

## Commands

```sh
vp test run apps/server/src/fork/auto-resume apps/web/src/fork/auto-resume \
  apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts \
  apps/server/src/fork/persistence/migrations.test.ts
vp lint packages/contracts/src/fork apps/server/src/fork apps/web/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

## Manual check

Ask Kyle before starting a dev server or browser. A real usage limit cannot be produced on
demand, so the manual check has two parts.

1. **In a worktree dev server** (seeded `.t3` per AGENTS.md "Test data", never
   `~/.t3/userdata`). A usage-limit stop cannot be faked through the UI, and this packet
   deliberately adds no debug RPC. Use a disposable Codex instance whose account is already
   at its limit (Kyle's second account near the end of a window is the realistic case), set
   `continueMessage` to something recognizable and a short grace, send a message, and
   observe:
   - the "scheduled" marker in the timeline on web and on the upstream mobile app;
   - the chip with countdown, and the tooltip with local time and account;
   - Cancel removes the chip and adds the "cancelled" marker; sending a message does too;
   - Resume now dispatches immediately (and, if the account is still limited, the marker
     says the limit has not reset and a new schedule appears).
2. **Real overnight run** (Kyle): leave one long Codex thread running with auto-resume on.
   Next morning, the thread shows the scheduled and resumed markers and continued work.
   With two shadow-home Codex accounts and switching on, the thread moved to the second
   account immediately.

Upstream server case: connect to an upstream T3 server; no chip, the settings section says
"Needs a Loom server with auto-resume", palette items absent.

## Merge safety

- Before review: the `git merge-tree` preview in SEAMS.md; then run
  `upstreamWording.test.ts` on the merged tree (a throwaway branch) because wording changes
  do not conflict textually.
- After Kyle merges to main: `scripts/fork/loom.sh integrate nightly --dry-run` from a clean,
  synced `main`. Until `loom.sh` runs fork tests generally (CONVENTIONS.md, "Known gap"),
  run the wording test by hand after each upstream integration.
