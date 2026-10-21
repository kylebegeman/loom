# L89 testing

## Server (`vp test run apps/server/src/fork/bots`)

- `render.test.ts`: required inputs, defaults, number and boolean coercion, choice membership,
  unknown inputs refused, placeholders rendered, unknown placeholders kept.
- `BotsStore.test.ts` on `SqlitePersistenceMemory`: save bumps the version; a stale
  `expectedVersion` is refused; archive and delete; run rows round-trip; paging by `before`;
  rows with an unknown status are skipped; retention prunes beyond the cap.
- `BotsService.test.ts` with a fake `ThreadLaunchService` and `ThreadManagementService`:
  a run launches with the bot's model, modes and workspace and the `bot-run-` thread id; a
  completed wait records the final assistant reply; a timed-out wait interrupts the thread and
  records `timed_out`; a second run beyond `maxConcurrentRuns` stays `queued` until the first
  finishes (driven by `Deferred`s, no sleeps); cancel of a queued run never launches; a launch
  failure records `failed`; an agent caller with a narrower runtime mode is refused; restart
  recovery fails queued rows and resumes running ones.
- `mcp.test.ts`: the toolkit registers with read and write access guards.
- Existing registration tests (`rpcAuthorization.test.ts`, `features.test.ts`,
  `persistence/migrations.test.ts`, `fork/mcp/registration.test.ts`) pass with the new entries.

## Clients

- `packages/contracts/src/fork/bots.test.ts`: `isBotRunThreadId` and schema bounds.
- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`,
  `@t3tools/mobile`; lint changed files.

## Real client

One pass in a dev web client when Kyle asks: define a bot, run it from the form, watch it move
from queued to completed, confirm the run thread is absent from the sidebar, open it from the
Bots page.
