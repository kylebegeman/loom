# L98 references

- `apps/server/src/fork/bots/BotsService.ts` `save` (next version, `maxRunVersion` for recreated
  ids) and `run`; `apps/server/src/fork/bots/BotsStore.ts` `putDefinition`, `maxRunVersion`,
  `deleteDefinition`.
- `apps/server/src/fork/bots/render.ts:78` `validateInputs`.
- `packages/contracts/src/fork/bots.ts` `BotDefinition` (version at least 1), `BotRun`
  (`botVersion`).
- `apps/web/src/lib/diffRendering.ts:2,99` `parseDiffFromFile` from `@pierre/diffs`.
- `docs/fork/packets/L93-bots-batches/TECHNICAL.md`: `startRunWith`, the feeder and recovery that
  replay reuses, and the batch snapshot this packet replaces.
- `docs/fork/packets/L96-bots-from-thread/TECHNICAL.md`: `BotDrafts` refinement threads.
- `docs/fork/packets/L97-bots-triggers/TECHNICAL.md`: pinned trigger versions.
- Prior art: prompt versioning and dataset replays in LangSmith and Braintrust, OpenAI Evals,
  GitHub Actions workflow history, database migration numbering that never reuses an id.
