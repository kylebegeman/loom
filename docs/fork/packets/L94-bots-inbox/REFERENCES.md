# L94 references

- `packages/contracts/src/orchestrationV2.ts:2911` `thread.fork`, `:134` fork source points,
  `:79` creation sources, `:1781,1829` pending runtime request summary on the thread shell.
- `apps/server/src/orchestration-v2/ThreadManagementService.ts:323` `dispatch`.
- `apps/server/src/mcp/toolkits/thread/handlers.ts:114-132` `t3_thread_fork`: the same dispatch.
- `packages/client-runtime/src/state/threadShell.ts:164` `environmentThreadsAtom`; L89's
  `fork: bots` filter in the same file.
- `apps/server/src/fork/bots/BotsService.ts` `run`.
- `docs/fork/packets/L92-bots-verdicts/TECHNICAL.md`: the `verdict` column the inbox query reads.
- `docs/fork/packets/L93-bots-batches/TECHNICAL.md`: batch items and `previousRunIds`.
- Prior art: GitHub Actions "re-run failed jobs", Sentry's resolve and ignore states, Linear's
  triage inbox with a count and snooze.
