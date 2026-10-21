# L90 implementation

1. Contracts (`packages/contracts/src/fork/bots.ts`): `BotStarterId`, `BotOrigin`, optional
   `origin` on `BotDefinition`, `checkout` on the project workspace, `checkoutThreadId` on
   `BotsRunInput`, `restoreStarter` and `listStarters` in `BOTS_WS_METHODS` and
   `BotsRpcGroup`, both tags in `FORK_CLIENT_GUARDED_RPC_SCOPES` (restore is operate, list is
   read). Contract tests for the new optional key.
2. Server: `starters.ts` with the three shipped definitions and a revision number; migration 2
   (`fork_bots_starters`); store methods; `BotsService.seedStarters`, `restoreStarter`,
   `listStarters`; checkout resolution in `BotsService.run`; the seeding layer under `forkParked`; `bots-starters` in
   `LOOM_SERVER_FEATURES`.
3. MCP: `loom_bots_restore_starter` (write) and the `origin` field in `loom_bots_list`.
4. Web: the Checkout picker in `BotRunForm.tsx`, Starter chip, "Starter, edited" and "newer starter" states, "Restore starter" in the
   editor, "Starters you removed" section, all gated on `bots-starters`.
5. Docs: a "Starter bots" section in `docs/fork/user/bots.md`.
6. Verify (TESTING.md), `scripts/fork/loom.sh check`, commit `feat(fork-bots): seed starter bots`.
