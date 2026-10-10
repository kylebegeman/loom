# L03 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                        | Covers                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/compaction-and-goals/compaction.test.ts` | Availability reasons (draft, provider without `compact`, no user message, running, pending request, disconnected) and the available case. |
| `apps/web/src/fork/compaction-and-goals/goals.test.ts`      | Provider gating, disabled reasons, the items shown for each goal state and provider, and the `/goal ...` text each item sends.            |
| Extension point tests                                       | As created with the extension points (palette values, keybinding commands).                                                               |

## Commands

```sh
vp test run apps/web/src/fork/compaction-and-goals/compaction.test.ts \
  apps/web/src/fork/compaction-and-goals/goals.test.ts

vp lint apps/web/src/fork packages/contracts/src/fork

vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
```

## Manual check

With Kyle's permission for a dev server and browser, on a worktree seeded with real data:

1. Claude thread with a few turns: palette "Compact conversation". The timeline shows the
   compaction divider (with token counts when Claude reports them). While a turn runs, the
   item is disabled with "Wait for the current turn to finish".
2. Same on a Codex thread (native compaction) and an OpenCode thread if one is configured.
3. Codex thread: palette "Set goal" with a small objective. Upstream's goal row shows it.
   "Pause goal" pauses it; "Resume goal" resumes it; "Clear goal" removes it.
4. Claude thread: the keybinding opens the set goal dialog; the goal is set; "Pause goal"
   and "Resume goal" are not offered; "Clear goal" removes it.
5. OpenCode or Cursor thread: goal items are disabled with "Goals need Codex or Claude".
6. Upstream T3 server: compaction and goal items still work.
7. Remote over the tailnet share: steps 1 and 3.

## Merge safety

- `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly>` on the
  branch; no conflicts from this packet (it has no packet seams).
- After merge to main: `scripts/fork/loom.sh integrate nightly --dry-run`.
