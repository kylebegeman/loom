# L92 references

- `packages/shared/src/schemaJson.ts:192` `extractJsonObject`: lenient object extraction.
- `packages/provider-core/src/server/textGenerationOperations.ts:58` `decodeJsonReply`: the
  same extract-then-decode pattern used for text generation.
- `packages/provider-core/src/server/textGeneration.ts:96` `ProviderTextGeneration`: the five
  fixed operations, and why a verdict extraction call would need an upstream seam.
- `docs/fork/packets/L89-bots-core/TECHNICAL.md`: the terminal step and the 16 KiB result cap.
- `docs/fork/packets/L90-bots-starters/`: starter revisions and "newer starter available".
- Prior art: GitHub check runs (`success`, `failure`, `neutral` conclusions plus annotations with
  path and line), SARIF result levels, JUnit pass and fail counts.
