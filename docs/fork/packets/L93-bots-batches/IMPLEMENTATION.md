# L93 implementation

1. Contracts: batch schemas, sources, the new RPC tags (`previewBatch`, `runBatch`,
   `listBatches`, `getBatch`, `cancelBatch`, `retryBatch`, `batchReport`,
   `watchBatches`), `batchId` on `BotRun`,
   scopes in `FORK_CLIENT_GUARDED_RPC_SCOPES`, `watchBatches` in `ForkSubscriptionRpcTag`,
   `bots-batches`.
2. Server: migration 5 (tables; next free id if another bots migration landed first);
   `batchSources.ts` (six resolvers, each bounded); `BotBatches.ts` (create, feed, cancel, retry,
   report, recovery); `batchReport.ts`; store methods; RPC and MCP transports; the recovery layer under
   `forkParked` after L89's run recovery.
3. Client runtime: batch atoms, the `watchBatches` subscription, commands.
4. Web: `RunOnManyDialog.tsx` (source picker, mapping, preview), `BatchView.tsx` (grid, report,
   retry, cancel), Batches tab, palette item "Run bot on many".
5. Docs: "Batches" in `docs/fork/user/bots.md`.
6. Verify (TESTING.md), `scripts/fork/loom.sh check`, commit `feat(fork-bots): batches`.
