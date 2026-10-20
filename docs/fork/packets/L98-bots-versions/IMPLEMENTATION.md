# L98 implementation

1. Contracts: `BotVersion`, `BotVersionSummary`, `stableVersion` on `BotDefinition`, `replayId`,
   `rating` and `note` on `BotRun`, `BotReplay`, the RPC tags with scopes, `bots-versions`.
2. Server storage: migration 10 (tables, columns, backfill of current definitions);
   `BotsStore` version and replay queries; the transactional save; the next-version rule;
   retention.
3. Server service: `definitionAt`; `restoreVersion`; `setStable`; `BotReplays.ts` (start,
   comparison, cancel, recovery under the L93 feeder pattern); `rateRun`; `suggestEdit` on top of
   L96's `BotDrafts`; inbox and usage adjustments for replay runs.
4. Switch L93 batch creation, L97 firing and L99 steps (whichever have landed) to
   `definitionAt`.
5. RPC handlers and MCP tools.
6. Client runtime and web: History tab with compare, Replay tab, rating controls, Suggest an edit,
   "stable" labels in the bot list and trigger editor.
7. Docs: "Versions and replay" in `docs/fork/user/bots.md`.
8. Verify (TESTING.md), `scripts/fork/loom.sh check`, commit `feat(fork-bots): versions and
replay`.
