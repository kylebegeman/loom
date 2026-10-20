# L95 implementation

1. Contracts: `BotBudget`, `budget` on the definition input, `BotRunUsage` and `usage` on
   `BotRun`, `retryAt` on `BotsError`, `loom.bots.usage` with its scope, `pausedUntil` on
   `BotBatch` (when L93 is present), `bots-budgets`.
2. Server: migration 7; `readRunUsage` at the terminal step; `BotBudgets.ts` (`check`, window
   queries); the check in `run`; the batch feeder wait; `BotsService.usage`; RPC and MCP.
3. Client runtime: the usage query atom.
4. Web: `BotsUsage.tsx` tab, editor budget fields and meter, `BotsUsageSection.tsx`, the
   `UsagePage.tsx` seam and FORK.md row.
5. Docs: "Usage and budgets" in `docs/fork/user/bots.md`.
6. Verify (TESTING.md), `scripts/fork/loom.sh check`, commit `feat(fork-bots): usage and budgets`.
