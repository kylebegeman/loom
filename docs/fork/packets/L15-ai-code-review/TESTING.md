# L15 testing (provisional)

For the recommended v1; revise after the design session. Focused tests, no repo-wide checks,
no sleeps.

## Automated tests

| File                                                              | Covers                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/ai-code-review/ReviewBrief.test.ts`         | Brief per target and lens set; submit instructions present at start and end; L26 summary included only when provided.                                                                                                                                                                                                                                                                                   |
| `apps/server/src/fork/ai-code-review/findingValidation.test.ts`   | Paths outside the checkout rejected; absolute paths made relative when inside; lines clamped; `endLine < startLine` fixed; duplicate findings merged; confidence bounds.                                                                                                                                                                                                                                |
| `apps/server/src/fork/ai-code-review/fallbackParser.test.ts`      | One fenced JSON block accepted and validated; prose with `[P1]` lines ignored; multiple blocks take the last valid one; invalid JSON gives no findings.                                                                                                                                                                                                                                                 |
| `apps/server/src/fork/ai-code-review/ReviewRunStore.test.ts`      | Migration, run and finding round trips, state updates, cleanup; tables prefixed `fork_ai_code_review_`.                                                                                                                                                                                                                                                                                                 |
| `apps/server/src/fork/ai-code-review/AiCodeReviewService.test.ts` | With a test orchestration engine: start dispatches `thread.create` then `thread.turn.start` with the expected fields (`approval-required`, same worktree); "no changes" refusal; a submit before turn end completes the run and dispatches `thread.settle`; turn end without submit runs the fallback, else fails; cancel interrupts; deletion cleanup. Waits on deferreds tied to dispatched commands. |
| `apps/server/src/fork/ai-code-review/mcp.test.ts`                 | Submit from a non-reviewer thread rejected; from an active reviewer accepted and stored; second submit replaces; completed runs reject late submits; tool name prefix.                                                                                                                                                                                                                                  |
| `apps/web/src/fork/ai-code-review/handBack.test.ts`               | Finding to `ReviewCommentContext` with and without a diff excerpt; never calls send.                                                                                                                                                                                                                                                                                                                    |
| Extension point registry tests                                    | Panel id and letter unique; palette values prefixed; fork RPC scopes complete.                                                                                                                                                                                                                                                                                                                          |

## Commands

```sh
vp test run apps/server/src/fork/ai-code-review/*.test.ts apps/web/src/fork/ai-code-review/*.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts apps/web/src/fork/panels/registry.test.ts
vp lint apps/server/src/fork/ai-code-review apps/web/src/fork/ai-code-review \
  packages/contracts/src/fork/ai-code-review.ts packages/client-runtime/src/fork/ai-code-review.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

## Manual check (with Kyle's permission)

1. In a thread with uncommitted changes containing a planted bug, start a review with Codex,
   then with Claude. The reviewer thread appears, runs, submits; findings list the bug with the
   right file and line; the reviewer thread is settled.
2. "Fix this" adds a review comment chip to the source thread's composer; nothing is sent.
3. Cancel a running review; the run shows "cancelled".
4. A reviewer that ignores the tool: "Ask again" recovers or the run fails clearly.
5. Branch target against the automatic base.
6. Upstream T3 server: entry points hidden or disabled.
7. Remote browser over Tailscale: start and read a review.

## Merge safety

Merge preview against the newest nightly; after merge to `main`,
`scripts/fork/loom.sh integrate nightly --dry-run`.
