# L15 implementation plan

Implements [PRODUCT.md](./PRODUCT.md) with the design in [TECHNICAL.md](./TECHNICAL.md). Each
phase ends in a working, tested state and its own commit
(`feat(fork-ai-code-review): ...`). Phases 1 to 5 give a usable single-reviewer feature
without Jev; later phases add fan-out, Jev, suggestions, agents, lenses and integrations.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md (sections 1,
2, 4 to 12, 17 and 18) and this folder. Seed a worktree `.t3` with real threads that have
uncommitted changes, several turns and a branch (AGENTS.md, "Test data"). For the manual pass,
have at least Codex and Claude signed in; a Jev key and an installed `impeccable` binary are
needed only for their phases.

## File layout

```
packages/contracts/src/fork/ai-code-review.ts
packages/client-runtime/src/fork/ai-code-review.ts
apps/server/src/fork/ai-code-review/
  migrations.ts  AiCodeReviewStore.ts  targetDiff.ts  diffStats.ts  ReviewBrief.ts
  findingValidation.ts  fallbackParser.ts  mergeRule.ts  effort.ts  decide.ts
  impeccable.ts  integrations.ts  AiCodeReviewService.ts  AiCodeReviewReactor.ts
  rpc.ts  mcp.ts  *.test.ts
apps/web/src/fork/ai-code-review/
  state.ts  panel.tsx  ReviewPanel.tsx  ReviewCard.tsx  FindingCard.tsx  FindingFilters.tsx
  StartReviewDialog.tsx  startDialogStore.ts  handBack.ts  markdown.ts  palette.tsx
  diffHeaderAction.tsx  composerChip.tsx  keybinding.ts  settings.tsx  profileBinding.ts
  *.test.ts
docs/fork/user/ai-code-review.md
```

## Phases

0. **Extension points.** Run the existence checks for `ext-core`, `ext-mcp`, `ext-panels`,
   `ext-palette`, `ext-settings`, `ext-diff-header`, `ext-composer`, `ext-web-root`,
   `ext-keybindings` and `ext-decide`; create each missing one exactly as specified, one
   commit each, before any packet code. `ext-decide` is first used in phase 7.
1. **Contracts.** Schemas, errors, RPC group, `subscribeThread` in `ForkSubscriptionRpcTag`,
   defaults and constants from TECHNICAL.md. Typecheck contracts, server, client-runtime, web
   and mobile.
2. **Pure server pieces with tests.** `diffStats.ts` (parse, buckets, estimate),
   `ReviewBrief.ts` (per target and lens, diff inline or file list, submit instructions at
   start and end), `findingValidation.ts`, `fallbackParser.ts`, `effort.ts`, `mergeRule.ts`
   (candidate pairs, rule, union-find, group fields, state carry-over).
3. **Storage.** `migrations.ts` and `AiCodeReviewStore.ts` for every table, including cleanup
   by source thread.
4. **Engine, one reviewer.** `targetDiff.ts` for all four targets; `AiCodeReviewService`
   `prepare`, `start` (one resolved reviewer), `cancel`, `askAgain`; the submit tool with the
   caller check and validation; `AiCodeReviewReactor` (session-set turn end, fallback,
   settle, thread deletion, startup reconciliation); `rpc.ts` with scopes; capability entry.
5. **Web, one reviewer.** Client-runtime atoms; panel (letter W), start dialog host through
   `ForkRoot`, review and finding cards, filters, low-confidence toggle, dismiss and restore,
   "Fix this" and "Fix selected" through `getHandBack` and `addReviewComment`, "Copy as
   Markdown", "Open file", "Open in diff"; palette source; diff header action; keybinding
   command and its `onForkCommand` subscription; settings section (without Jev fields yet).
   Unavailable states for upstream servers.
6. **Fan-out and merge.** Up to three reviewer slots in the dialog and `start`; provisional
   rule merge after each run and final merge at the end; "Found by N of M"; per-reviewer rows
   with "Waiting for approval", "Ask again", "Open review thread"; re-merge after Ask again.
7. **Jev.** Add `aiCodeReviewDecideFeatures` (in `ai-code-review/decide.ts`,
   `packet: "L15"`, `agentTool: false` on turn-suggest and finding-merge) to
   `FORK_DECIDE_FEATURES`. Reviewer-pick for Auto slots (the `resolveAuto` RPC, scope
   `orchestration:operate`, for the dialog's pick with confidence and fallback reason; server
   pick in `start` for unresolved Auto; a low-confidence fallback keeps the model when only
   effort was unsure), offered in the web only when
   `useDecideFeature(...).usable`; candidate pool and effort presets in settings; effort
   mapping to provider options; finding-merge in the final merge with the Noul bands and
   per-pair rule fallback. Add the three features to L29's catalog if L29's PRODUCT.md lists
   consumers.
8. **Suggestions.** Turn-suggest in the reactor with the code pre-gates, Jev score and the
   threshold fallback; the suggestion row and snapshot field; the composer chip (`ext-composer`
   block) and the panel banner; dismiss; project settings with "Start suggested reviews
   automatically"; large suggestions.
9. **Agent tool.** `loom_ai_code_review_start` gated by "Let agents use this"; origin `agent`;
   large reviews become suggestions; the "Started by the agent" label.
10. **Lenses.** Simplicity lens section (ponytail-style, with the MIT attribution comment).
    impeccable: binary lookup, argv builder, run, mapping, the `impeccable` run kind and its
    card label; lens toggle shown only when available.
11. **Optional integrations.** L26 impact summary in the brief; L02 lineage rows with kind
    `review`; L18 reviewer binding source and server read. Each checks for the other packet
    and does nothing when it is absent; build and test with and without them if they exist
    in the tree.
12. **Docs.** `docs/fork/user/ai-code-review.md` (what it does, how to start, reviewer
    approvals, Auto and Jev, suggestions, agent use, impeccable needs a user-installed
    binary). Update the packet status in the packets index.

## Pitfalls

- Never parse findings from non-reviewer threads; the fallback reads only a reviewer thread's
  final assistant message.
- Set `runtimeMode: "approval-required"` explicitly on `thread.turn.start` (for the first turn
  and for Ask again): the command's decoding default is `full-access`.
- The submit tool is listed to every agent session; its description says it is only for Loom
  review threads, and the handler enforces it with the run lookup.
- The brief tells the reviewer not to modify files; `approval-required` makes any attempt
  visible in its thread.
- Do not add orchestration commands or events; reuse `thread.create`, `thread.turn.start`,
  `thread.turn.interrupt`, `thread.settle`.
- Hand-back never sends a turn.
- Jev never counts or does arithmetic: sizes go in as buckets, merge transitivity is
  union-find in code, and every Jev call has a fallback that does not wait on Jev.
- Do not re-gate `answered` results or pass a `threshold` to `decide`: the extension point
  applies the feature threshold (tunable in L29). Do not add a second agent gate for Jev; the
  start tool's own `allowAgents` gate is about starting reviews, not about Jev.
- Never run `impeccable install`, `update`, `link` or hook commands; the argv builder only
  produces `detect`.
- Keep the subscription payload to summaries; findings only through `get`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus the
acceptance criteria in [TESTING.md](./TESTING.md#acceptance-criteria).
