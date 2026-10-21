# L97 implementation

1. Contracts: `BotTriggerId`, `BotTriggerEvent`, `BotTriggerMapping`, `BotTrigger`,
   `BotTriggerFiring`, `BotTriggerChange`, `triggerId` on `BotRun`, the RPC tags with scopes
   (all operate tags in `CLIENT_GUARDED_RPC_SCOPES`), `bots-triggers`.
2. Server storage: migration 9 and `triggers/BotTriggersStore.ts`.
3. Server firing: `triggers/BotTriggers.ts` (`fire`, filters, dedupe, limits, version, mapping,
   budget, skipped run rows); the `untrusted` option in `render.ts`.
4. Server sources: `BotTriggerReactor.ts` (cursors, two streams, PR state), `BotTriggerSchedule.ts`,
   `webhookFields.ts` and `BotTriggers.webhook`, then the `webhookRoute.ts` seam and its FORK.md
   and `seams.tsv` rows.
5. RPC handlers, `watchTriggers`, MCP tools.
6. `scripts/fork/loom.sh`: the optional conflict hook post in `cmd_integrate`.
7. Client runtime and web: atoms, Triggers tab, editor, firing log, palette item.
8. Docs: "Triggers" in `docs/fork/user/bots.md`, including how to paste a webhook into GitHub and
   set `LOOM_BOTS_CONFLICT_HOOK`.
9. Verify (TESTING.md), `scripts/fork/loom.sh check`, commit `feat(fork-bots): event triggers`.
