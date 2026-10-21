# L89 implementation

1. Contracts: `packages/contracts/src/fork/bots.ts` with schemas, `BOTS_WS_METHODS`,
   `BotsRpcGroup`, `isBotRunThreadId`; export it and merge the group; add `watch` to
   `ForkSubscriptionRpcTag`; add write tags to `FORK_CLIENT_GUARDED_RPC_SCOPES`.
2. Server: migrations, `BotsStore`, `render.ts`, `BotsService` (run lifecycle and restart
   recovery), `rpc.ts`, `mcp.ts`. Register the layer, the service type, the migration set, the
   RPC scopes, the toolkit and the `bots` capability.
3. Client runtime: `packages/client-runtime/src/fork/bots.ts`, exported from the fork index.
4. Hidden-thread seams in `Sidebar.logic.ts`, `threadShell.ts` and
   `ThreadNotificationCoordinator.tsx`.
5. Web: route `loom.bots.tsx`, `apps/web/src/fork/bots/*`, footer entry, utility-page seam,
   palette source.
6. Docs: `docs/fork/user/bots.md`, FORK.md seam rows, `docs/fork/seams.tsv`, index Status.
7. Verify (TESTING.md), run `scripts/fork/loom.sh check` and the merge preview, commit
   `feat(fork-bots): ...`.
