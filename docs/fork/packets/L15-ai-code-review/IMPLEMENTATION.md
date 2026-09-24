# L15 implementation plan (provisional)

**Blocked on the design session.** Do not start until PRODUCT.md records the session outcome
and the README status is "Ready". The steps below implement the recommended v1 from
[DESIGN-SESSION.md](./DESIGN-SESSION.md#5-recommended-v1) and exist so the session can judge
its size; rewrite them to match the decisions.

## Before starting (after the session)

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Seed a worktree `.t3` with real threads that have uncommitted changes (AGENTS.md,
"Test data"). Have Codex and Claude signed in for the manual pass.

## File layout

```
packages/contracts/src/fork/ai-code-review.ts
packages/client-runtime/src/fork/ai-code-review.ts
apps/server/src/fork/ai-code-review/
  migrations.ts  ReviewRunStore.ts  ReviewBrief.ts  findingValidation.ts  fallbackParser.ts
  AiCodeReviewService.ts  AiCodeReviewReactor.ts  rpc.ts  mcp.ts  *.test.ts
apps/web/src/fork/ai-code-review/
  state.ts  panel.tsx  ReviewPanel.tsx  StartReviewDialog.tsx  FindingCard.tsx
  handBack.ts  palette.tsx  settings.tsx  *.test.ts
docs/fork/user/ai-code-review.md
```

## Phases

1. **Extension points** as listed in SEAMS.md; create missing ones, one commit each. If the
   session keeps the diff panel button, create `ext-diff-header` if missing (EXTENSION-POINTS.md
   section 17).
2. **Contracts** (schemas, RPC group, subscription tag) and typecheck consumers.
3. **Pure server pieces**: `ReviewBrief.ts` (brief text per target and lens set, the finding
   schema described in prose, submit instructions at the start and the end),
   `findingValidation.ts` (relative paths inside the checkout, line clamping, dedupe of
   identical findings), `fallbackParser.ts` (one fenced JSON block from the reviewer's final
   message, validated with the same schema; never prose regexes).
4. **Storage** (`fork_migrations_ai_code_review`, tables in TECHNICAL).
5. **Service and reactor**: start (diff stats, "no changes" refusal, reviewer thread creation
   with existing commands, run row), completion detection from domain events, fallback,
   settle on completion, cancel, ask again, cleanup on thread deletion. Append
   `"ai-code-review"` to `LOOM_SERVER_FEATURES`.
6. **MCP tool** `loom_ai_code_review_submit`, rejecting callers that are not an active
   reviewer thread.
7. **RPC handlers** and scopes.
8. **Client runtime atoms**; **web**: panel, start dialog, cards, hand-back via
   `addReviewComment`, palette, settings; optional diff button per the session.
9. **Docs**: `docs/fork/user/ai-code-review.md`; FORK.md rows for any seam; packets index.

## Pitfalls

- Never parse findings from non-reviewer threads.
- The submit tool is listed to every agent session; its description must say it is only for
  Loom review runs, and the handler must enforce it.
- Keep the reviewer from editing: `approval-required`, and the brief says it must not modify
  files. Approval requests from the reviewer surface in its own thread like any other.
- Do not add orchestration commands or events; reuse `thread.create`, `thread.turn.start`,
  `thread.turn.interrupt`, `thread.settle`.
- Hand-back must never send a turn.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus the
acceptance criteria the session sets.
