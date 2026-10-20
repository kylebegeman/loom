# L90 testing

## Server (`vp test run apps/server/src/fork/bots`)

- `starters.test.ts`: each shipped definition decodes with `BotDefinitionInput`; every
  `{{name}}` placeholder in the instructions names a declared parameter; the reviewer's runtime
  mode is `approval-required` and its interaction mode is `plan`.
- `BotsService.starters.test.ts` on `SqlitePersistenceMemory` with a fake settings service:
  first seeding inserts three bots with `origin` revision 1 and three `fork_bots_starters` rows;
  a second seeding inserts nothing; deleting `reviewer` and seeding again leaves it deleted; a
  user bot that already owns the id `verifier` is left untouched and the starter row is recorded;
  no default model postpones seeding without writing rows; `restoreStarter` on an edited starter
  writes a new version equal to the shipped text and clears `archivedAt`; `restoreStarter` on a
  deleted starter recreates it with a version one above the highest `bot_version` among its runs;
  `restoreStarter` on a non-starter id fails `not_found`.
- `BotsService.checkout.test.ts`: a `caller` bot launched by an MCP caller in a worktree uses
  `existing_worktree` with that path; `checkoutThreadId` wins over the caller; a caller with no
  worktree uses the project root; a checkout thread from another project, or no thread at all, is
  refused with `invalid`; a `root` bot ignores `checkoutThreadId`.
- Migration test in `persistence/migrations.test.ts` passes with id 2.

## Clients

- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`; lint
  changed files.

## Real client

When Kyle asks: fresh dev database, open Bots, see three Starter cards, edit the reviewer, see
"Starter, edited", restore it, delete the verifier, restart, confirm it stays deleted and appears
under "Starters you removed".
