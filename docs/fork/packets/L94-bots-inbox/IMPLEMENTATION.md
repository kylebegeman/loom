# L94 implementation

1. Contracts: `isBotInboxRun`, new `BotRun` keys, the four RPC tags with scopes, `bots-inbox`.
2. Server: migration 6; store queries (`inbox`, `dismiss`, `setPromotedThread`); record
   `modelSelection` and `checkoutThreadId` at run start; `BotsService.retry`, `dismiss`, `promote`; RPC and MCP
   transports.
3. Client runtime: the inbox query atom, the count atom, the waiting-runs selector over thread
   shells, commands.
4. Web: `BotsInbox.tsx`, the count on the footer entry, the Inbox tab, palette item.
5. Docs: "Inbox" in `docs/fork/user/bots.md`.
6. Verify (TESTING.md), `scripts/fork/loom.sh check`, commit `feat(fork-bots): inbox`.
