# L91 testing

## Server (`vp test run apps/server/src/fork/bots`)

- `BotsService.invocation.test.ts` with fake `ThreadLaunchService` and `ThreadManagementService`:
  an RPC run with `callerThreadId` records it; a missing, archived or bot-run caller is refused
  with `invalid`; a completed run with `notify` sends exactly one message with the
  `bot-run-notify:<runId>` command id, `senderThreadId` set to the run thread and mode `auto`; a
  failed run sends the status and error; a run without `notify` sends nothing; a send failure
  leaves the run `completed`; restart recovery delivers a pending notification once and skips one
  whose receipt exists.
- `mcp.test.ts`: `wait` plus `notify` is refused; a call from a `bot-run-` thread is refused with
  `permission`.
- `packages/provider-core`: a test that `T3_CODE_ORCHESTRATION_SECTIONS` contains
  `LOOM_BOTS_INSTRUCTIONS` once.

## Web

- `apps/web/src/fork/composer/menu.test.ts`: `searchForkSlashItems` ranks exact, prefix and
  description matches like the upstream helper, and returns all items for an empty query.
- `apps/web/src/fork/bots/composer/slashSource.test.ts`: archived bots and bots scoped to another
  project are excluded; nothing is returned without `bots-invocation`.
- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`; lint changed
  files; `git grep -cE 'fork: ext-composer([^a-z0-9-]|$)' -- apps/web/src/components/chat/ChatComposer.tsx`
  prints 5.

## Real client

When Kyle asks: in a thread, type `/rev`, pick the reviewer, choose `surfaces`, press Enter, see
the footer chip, open the run, then repeat with "Post result" on and watch the reply arrive and the
agent respond.
