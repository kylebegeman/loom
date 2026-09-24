# L03 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                  | Covers                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/fork/compaction-and-goals/compaction.test.ts`           | Availability reasons (draft, provider without `compact`, no user message, running, pending request, disconnected) and the available case.        |
| `apps/server/src/fork/turnInput/registry.test.ts`                     | Created with `ext-turn-input` if missing (EXTENSION-POINTS.md, section 16, Tests).                                                               |
| `apps/server/src/fork/compaction-and-goals/goalTurnInput.test.ts`     | Wrapper format; closing-tag escaping; only `active` goals contribute a block, paused and met return `undefined` (with a fake store).             |
| `apps/server/src/fork/compaction-and-goals/ThreadGoalStore.test.ts`   | Upsert keeps `set_at` when only the state changes and resets it when the objective changes; delete by thread and project; migrations idempotent. |
| `apps/server/src/fork/compaction-and-goals/ThreadGoalService.test.ts` | Unknown thread fails `thread-not-found`; `setGoalState` without a goal fails `goal-not-found`; `clearGoal` returns the removed goal.             |
| `apps/server/src/fork/compaction-and-goals/cleanupReactor.test.ts`    | `thread.deleted` and `project.deleted` remove goals; startup sweep removes orphans. Waits on a `Deferred`.                                       |
| Extension point tests                                                 | As created with the extension points (scopes, features, palette values, keybinding commands).                                                    |

## Commands

```sh
vp test run apps/web/src/fork/compaction-and-goals/compaction.test.ts \
  apps/server/src/fork/turnInput/registry.test.ts \
  apps/server/src/fork/compaction-and-goals/goalTurnInput.test.ts \
  apps/server/src/fork/compaction-and-goals/ThreadGoalStore.test.ts \
  apps/server/src/fork/compaction-and-goals/ThreadGoalService.test.ts \
  apps/server/src/fork/compaction-and-goals/cleanupReactor.test.ts \
  apps/server/src/provider/Layers/ProviderService.test.ts

vp lint apps/server/src/fork apps/web/src/fork packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/web/src/components/ChatView.tsx apps/server/src/provider/Layers/ProviderService.ts \
  apps/web/src/components/chat/ChatComposer.tsx   # only if this packet created ext-composer

vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

`ProviderService.test.ts` is upstream's; it runs once to prove the seam changes nothing
without `ForkLayer`.

## Manual check

With Kyle's permission for a dev server and browser, on a worktree seeded with real data:

1. Claude thread with a few turns: palette "Compact conversation". The timeline shows the
   compaction divider (with token counts when Claude reports them). While a turn runs, the
   item is disabled with "Wait for the current turn to finish".
2. Same on a Codex thread (native compaction) and an OpenCode thread if one is configured.
3. Composer footer "Goal" button: "Every answer must end with the word DONE." Send "What is 2+2?". The reply
   ends with DONE; the user bubble shows only "What is 2+2?".
4. Pause the goal; send another message; the reply no longer follows the rule. Resume;
   it does again. Mark met; the chip shows Met and nothing is sent.
5. Edit the goal text; the chip updates on a second browser window after focus.
6. Clear; Undo restores it. The footer button's tooltip switches between "Set goal" and
   "Edit goal"; it is absent on a new draft thread.
7. Send `/compact` with an active goal: compaction runs normally (no goal added to slash
   commands).
8. Delete the thread; the goal row is gone (check the worktree database).
9. Upstream T3 server: goal UI hidden; palette compaction still works.
10. Remote over the tailnet share: steps 3 and 4.

## Merge safety

- `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly>` on the
  branch; conflicts only on marked lines in `ChatView.tsx` and `ProviderService.ts`.
- After merge to main: `scripts/fork/loom.sh integrate nightly --dry-run`.
