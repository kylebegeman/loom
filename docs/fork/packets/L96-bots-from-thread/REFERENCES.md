# L96 references

- `apps/server/src/orchestration-v2/ThreadManagementService.ts:323,350,371,436` `dispatch`,
  `getProjectThreadRecords`, `getThreadShell`, `streamDomainEvents`.
- `apps/server/src/orchestration-v2/Orchestrator.ts:11735-11760` the bounded stored stream and
  the live domain tail.
- `packages/contracts/src/orchestrationV2.ts:355-366` `OrchestrationV2AppThread` (title, model,
  modes, worktree path).
- `packages/contracts/src/orchestrationV2.ts:1085-1104` the conversation message (creator,
  scheduled task, notification, role, streaming).
- `packages/contracts/src/orchestrationV2.ts:1693` `message.updated`; `:2578` `thread.archive`.
- `apps/server/src/fork/project-library/LibraryBriefSuggestions.ts:344-362` the reactor this
  packet copies.
- `apps/server/src/fork/bots/BotsService.ts` `interruptThread`, `awaitThread`, the launch path and the
  scratch project, reused for refinement.
- `packages/provider-core/src/server/textGeneration.ts:96` why refinement is a thread.
- `packages/shared/src/schemaJson.ts:192` `extractJsonObject`.
- `apps/web/src/fork/bots/draft.ts:76,103` `botDraft` and `slugFromName`.
- `apps/web/src/fork/bots/palette.tsx:29` `botsPaletteSource`.
- `docs/fork/packets/L92-bots-verdicts/TECHNICAL.md`: lenient JSON decoding of agent replies.
- Prior art: Raycast "Create Quicklink from current page", Zapier's "Turn this into a Zap"
  suggestions, macOS Shortcuts suggestions from repeated actions.
