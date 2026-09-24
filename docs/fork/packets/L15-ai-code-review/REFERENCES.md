# L15 references

## Old Loom

Selection F3 (AI code review) in [selections.md](../../selections.md). Old Loom is
`bagelvault/loom` at `a79ec506` (0.13.10). Keep the lessons, not the code: the engine relied on
a new orchestration command and event, which this fork does not allow.

| File                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Keep / adapt / drop                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [packages/contracts/src/review.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/review.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Adapt the target union (uncommitted, base branch, commit, custom).                                                                                            |
| [packages/contracts/src/provider.ts:120-139](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/provider.ts#L120-L139)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Drop (provider `startReview` input); only relevant to option A1.                                                                                              |
| [packages/contracts/src/orchestration.ts:1666-1674](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/orchestration.ts#L1666-L1674)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Drop: `thread.review.start` command; new orchestration types are not allowed here.                                                                            |
| [apps/server/src/provider/Layers/CodexAdapter.ts:2575-2583](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/CodexAdapter.ts#L2575-L2583) and [CodexSessionRuntime.ts:2262-2296](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L2262-L2296)                                                                                                                                                                                                                                                                                                                                              | Reference for options A1 and A4 (`review/start`, restriction checks, completed-turn replay).                                                                  |
| [apps/server/src/provider/Layers/ClaudeAdapter.ts:5714-5766](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/ClaudeAdapter.ts#L5714-L5766)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Adapt the target descriptions for the brief; drop the text-convention output.                                                                                 |
| [apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:3735-3810](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts#L3735-L3810)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Keep the guard idea: do not start while the target thread has an active turn.                                                                                 |
| [apps/web/src/reviewFindings.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/reviewFindings.ts) (238 lines) and its test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Adapt the finding fields and severity scale; drop the prose regex and the "every message" parsing. Its JSON branch (156-217) is close to the fallback parser. |
| [apps/web/src/hooks/useNativeReview.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/hooks/useNativeReview.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Adapt: child-thread review flow (create, wait, start).                                                                                                        |
| [apps/web/src/components/review/NativeReviewLauncher.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/review/NativeReviewLauncher.tsx) and `.logic.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Adapt the single-launcher idea (target, model, where).                                                                                                        |
| [apps/web/src/components/chat/MessagesTimeline.tsx:2320-2385](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/MessagesTimeline.tsx#L2320-L2385)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Adapt card presentation into the Review panel, not the timeline.                                                                                              |
| Ledgers [0037](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0037-native-review-inline.md), [0039](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0039-native-review-target-launcher.md), [0040](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0040-native-review-finding-cards.md), [0041](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0041-claude-review-fallback.md), [0042](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0042-native-review-roadmap-status.md), [0043](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0043-review-model-thread-launcher.md) | Keep the lessons summarized in DESIGN-SESSION.md, section 1. (0038 is unrelated goal-chip polish.)                                                            |

## Upstream T3 Code

- `apps/server/src/review/ReviewService.ts` (service at 22), `packages/contracts/src/review.ts`
  (preview input and sources, 6-26), `apps/server/src/auth/RpcAuthorization.ts:132-133`: diff
  previews for the uncommitted and branch targets.
- `apps/server/src/checkpointing/Utils.ts` (`refs/t3/checkpoints` prefix at 4,
  `checkpointRefForThreadTurn` at 6, `resolveThreadWorkspaceCwd` at 12),
  `apps/server/src/checkpointing/CheckpointDiffQuery.ts` (`getTurnDiff` at 45, from-ref choice
  at 141-147): the turn target.
- `apps/server/src/vcs/GitVcsDriver.ts:41,277` (`ExecuteGitInput`, `execute`): the commit
  target and the commit list.
- `apps/web/src/reviewCommentContext.ts` (schema 13-26, interface 28-42,
  `buildFileReviewComment` 59-81, `inferReviewCommentFenceLanguage` 84),
  `apps/web/src/composerDraftStore.ts` (`reviewComments` 235, `addReviewComment` 665-669),
  `packages/contracts/src/composerContext.ts` (id pattern 31, text and diff limits 42-43,
  non-empty `filePath` 193): the hand-back.
- `packages/contracts/src/orchestration.ts`: `RuntimeMode` (128-133) and
  `DEFAULT_RUNTIME_MODE` (135), `ProviderInteractionMode` (136-138), `OrchestrationSession`
  (543-563), `OrchestrationLatestTurn` (608-624), `thread.create` (1047-1062),
  `thread.archive` (1071), `thread.settle` (1083), `thread.unsettle` (1095-1103),
  `thread.turn.start` (1238-1258, runtime mode default at 1251), `thread.turn.interrupt`
  (1281), event types (1586-1619), `ThreadSessionSetPayload` (1864),
  `ThreadTurnDiffCompletedPayload` (1874-1883).
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts`:
  `getThreadCheckpointContext` (201), `getThreadShellById` (217), `getThreadDetailById`
  (249).
- `apps/server/src/orchestration/decider.ts`: settle handling (469-520) and activity
  un-settle (around 1884).
- `apps/server/src/ws.ts:734`: `serverCommandId`.
- `apps/server/src/mcp/McpInvocationContext.ts:11-20`: MCP capability union and the
  invocation scope with `threadId`; `apps/server/src/provider/Layers/ProviderService.ts:906-913`:
  capabilities per session.
- `packages/contracts/src/model.ts` (`ProviderOptionSelection` 49-52, `ModelCapabilities`
  125-127), `apps/server/src/provider/ClaudeModelCatalog.ts:196` (`effort`),
  `apps/server/src/provider/Layers/CodexProvider.ts:180` and `GrokProvider.ts:197`
  (`reasoningEffort`): effort mapping.
- `apps/web/src/diffPanelStore.ts` (`DiffPanelSelection` 8-11, scope setters 19-21),
  `apps/web/src/rightPanelStore.ts` (`open` 130, `openFile` 137),
  `apps/web/src/components/DiffPanel.tsx:756` (`ext-diff-header`, EXTENSION-POINTS.md section
  17), `apps/web/src/components/Sidebar.logic.ts:840` (`hasPendingApprovals`): panel actions.
- `packages/effect-codex-app-server/src/_generated/schema.gen.ts:6105-6155,20535-20536`:
  Codex `review/start` and review-mode items (rejected option, kept for history).
- `apps/server/src/textGeneration/CodexTextGeneration.ts:196-217`,
  `ClaudeTextGeneration.ts:199-215`, `TextGeneration.ts:83-114`: headless structured output
  (follow-up A3).
- `apps/server/src/provider/Services/ProviderAdapter.ts:35-43,89`,
  `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:91-94`: the compaction
  capability pattern (rejected option A1).
- `apps/web/src/components/pullRequest/`, `apps/web/src/components/diffs/`: PR review and
  inline annotation UI for follow-ups.

## Other Loom packets

- L02 thread lineage: `fork_thread_lineage_links` columns and kinds
  ([L02 TECHNICAL.md](../L02-thread-lineage/TECHNICAL.md)); L08 uses the same
  `INSERT OR IGNORE` pattern ([L08 TECHNICAL.md](../L08-multi-thread-runs/TECHNICAL.md)).
- L18 project profiles: `ProfileBindingSource` and `PROFILE_BINDING_SOURCES`
  ([L18 TECHNICAL.md](../L18-project-profiles/TECHNICAL.md), "Binding sources").
- L26 code graph: `CodeGraphImpactInput` and `CodeGraphImpactResult`
  ([L26 TECHNICAL.md](../L26-code-graph/TECHNICAL.md), "Impact").
- L29 Jev hub and `ext-decide` (EXTENSION-POINTS.md, section 18).

## Reference repositories

- pbakaus/impeccable, Apache-2.0 (`NOTICE.md`: iOS and Android references derived from an MIT
  project): <https://github.com/pbakaus/impeccable>, reviewed at
  `e0881d2de397d5e9761d7b35ff5017d8f5ebf69b`. Detector CLI `crates/detect/src/cli.rs:24-64`,
  finding shape `crates/foundation/src/findings.rs:13-31`, rule registry
  `crates/foundation/src/registry.rs:15-29,716`, critique skill `skill/reference/critique.md`.
  Never run its `install`, `update` or `link` commands.
- DietrichGebert/ponytail, MIT: <https://github.com/DietrichGebert/ponytail>, reviewed at
  `e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156`. `skills/ponytail-review/SKILL.md` (review format
  and tags), `AGENTS.md` (the rule ladder). Never run its hook installers.
- Graphify-Labs/graphify, Apache-2.0: blast radius via L26 (see that packet).

## External

- Codex app-server protocol (review): generated types above; upstream Codex docs at
  <https://github.com/openai/codex> (app-server README), not re-verified for this packet.
- Claude Code slash commands (`/review`, `/security-review`):
  <https://docs.claude.com/en/docs/claude-code/slash-commands>; whether the Agent SDK path
  runs them is unverified.
- TypeSafe (Jev) documentation, read 2026-09-24:
  - API: <https://docs.typesafe.ai/api> (endpoint, question and answer types, errors).
  - Questions: <https://docs.typesafe.ai/primitives>,
    <https://docs.typesafe.ai/primitives/choice>, <https://docs.typesafe.ai/primitives/score>,
    <https://docs.typesafe.ai/primitives/noul>.
  - State: <https://docs.typesafe.ai/concepts/state>.
  - Confidence: <https://docs.typesafe.ai/confidence>.
  - Models and limits (64k per request, 32k for state plus the longest question):
    <https://docs.typesafe.ai/models>.
  - Jev 1.13 jaggedness (literal reading, no counting or math, irrelevant state hurts):
    <https://docs.typesafe.ai/model-jaggedness/jev-1.13>.
  - Speculative fan-out (many questions in one request):
    <https://docs.typesafe.ai/patterns/fan-out>.
  - Entity alignment (pairwise "same item" decisions, the pattern behind finding merge):
    <https://docs.typesafe.ai/cookbooks/entity_alignment> (listed in the docs index, not read
    for this packet).
