# L96 implementation

1. Contracts: `BotDraftResult`, `BotSuggestion`, the four RPC tags with scopes,
   `bots-from-thread`; move `slugFromName` from `apps/web/src/fork/bots/draft.ts:103` into
   `packages/contracts/src/fork/bots.ts` and re-export it from the web draft module.
2. Server: `fromThread/draft.ts` (pure `draftFromBrief`), `fromThread/BotDrafts.ts` (thread read,
   refinement), `fromThread/briefShape.ts` (pure), the suggestion reactor and store, migration 8,
   RPC and MCP.
3. Client runtime: commands for draft and refine, the suggestions atom.
4. Web: `apps/web/src/fork/bots/fromThread/` (state, mapping to `BotDraft`), the editor opened
   with a draft, the Refine button, suggestions on the Bots page, the palette item, the three menu
   seams and FORK.md rows.
5. Docs: "Save a thread as a bot" in `docs/fork/user/bots.md`.
6. Verify (TESTING.md), `scripts/fork/loom.sh check`, commit `feat(fork-bots): bots from threads`.
