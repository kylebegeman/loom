# L92 implementation

1. Contracts: `BotOutput`, `BotVerdict`, `BotFinding`, caps, `output` on `BotDefinitionInput`,
   `verdict` on `BotRun`, the `verdict` filter on `BotsListRunsInput`, `bots-verdicts`.
   Contract tests for caps and optional keys.
2. Server: `verdict.ts` (reply request text, lenient decode, clipping, the needs-attention
   fallback); `render.ts` appends the request for verdict bots; migration 4 (verdict columns and
   index; next free id if another landed first); store and service record the verdict at the
   terminal step; `listRuns` filter; MCP output; L91 message header.
3. Starters: bump `BOT_STARTERS_REVISION` and set `output: "verdict"` on the reviewer and
   verifier, with instruction text that no longer describes a prose format.
4. Web: `VerdictChip.tsx`, `BotFindings.tsx`, the filter row and the editor's "Reply" control,
   gated on `bots-verdicts`.
5. Docs: "Verdicts" in `docs/fork/user/bots.md`.
6. Verify (TESTING.md), `scripts/fork/loom.sh check`, commit `feat(fork-bots): structured
verdicts`.
