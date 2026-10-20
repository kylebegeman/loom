# L99 references

- `apps/server/src/fork/bots/BotsService.ts`: `awaitRun` (subscribe before reading), `recover`
  (queued runs failed, running runs given a new waiter), registration under `forkParked`, and
  the `changes` PubSub.
- `apps/server/src/fork/bots/render.ts:8-9` limits, `:78` `validateInputs`, `:103`
  `PLACEHOLDER`, `:109` `renderInstructions`.
- `apps/server/src/fork/bots/migrations.ts`: the bots migration set (ids 1 and 2 today).
- `packages/contracts/src/fork/bots.ts:26-28` `BOTS_MAX_PARAMETERS`, `BOTS_MAX_ACTIVE_RUNS`,
  `BOTS_RESULT_MAX_BYTES`; `:69` `BotCheckout`; `:168` `BotRunId`.
- `packages/contracts/src/fork/rpc.ts:108` `ForkSubscriptionRpcTag`, `:128` `loom.bots.watch`.
- `docs/fork/packets/L92-bots-verdicts/TECHNICAL.md`: `output: "verdict"` and `BotVerdict`.
- `docs/fork/packets/L93-bots-batches/TECHNICAL.md`: `startRunWith`, the feeder, batch
  recovery and the report shape.
- `docs/fork/packets/L94-bots-inbox/TECHNICAL.md`: `isBotInboxRun`.
- `docs/fork/packets/L95-bots-budgets/TECHNICAL.md`: `BotBudgets.check` and `retryAt`.
- `docs/fork/packets/L97-bots-triggers/TECHNICAL.md`: firings, skipped firings, `untrusted`
  rendering.
- `docs/fork/packets/L98-bots-versions/TECHNICAL.md`: `definitionAt` and version retention.
- Prior art: GitHub Actions jobs with `needs` and matrix fan-out, Temporal and Inngest durable
  steps (step results stored so replays skip finished work), Argo Workflows loops with retry
  limits, and Kyle's own review-fix-verify workflow scripts.
