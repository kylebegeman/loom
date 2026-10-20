# L91 implementation

1. Commit 1, `feat(fork-composer): add the ext-composer extension point`: the five §11 seams at
   current anchors, `apps/web/src/fork/composer/registry.tsx` with empty registries, seams.tsv row,
   §11 line numbers refreshed.
2. Commit 2, `feat(fork-composer): add the ext-composer-menu extension point`: the §11b seams,
   the slash-source seam, `apps/web/src/fork/composer/menu.ts` with `FORK_COMPOSER_TRIGGERS` and
   `FORK_SLASH_SOURCES`, §11b rewritten as verbatim code, seams.tsv row.
3. Contracts: `callerThreadId?` and `notify?` on `BotsRunInput`; `notify` on `BotRun`;
   `bots-invocation` feature string.
4. Server: caller-thread validation, migration 3 (`notify` column; take the next free id if another
   bots migration landed first), result delivery in `BotsService`, `notify` on `loom_bots_run`,
   `LOOM_BOTS_INSTRUCTIONS` in `packages/provider-core/src/fork/botsInstructions.ts` and the
   2-line seam.
5. Web: `apps/web/src/fork/bots/composer/` with the slash source, the drawer form, the footer
   chip, registered in the two registries.
6. Docs: "Run a bot from a thread" in `docs/fork/user/bots.md`; FORK.md and seams.tsv rows.
7. Verify (TESTING.md), `scripts/fork/loom.sh check`, commit `feat(fork-bots): run bots from the
composer`.
