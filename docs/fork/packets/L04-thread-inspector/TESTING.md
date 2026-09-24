# L04 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no markup tests.

## Automated tests

| File                                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/thread-inspector/model.test.ts` | Status precedence (approval over input over error over working over interrupted over ready); working row uses the plan step and step counts; non-repo hides Changes; top-five file ordering; last-turn row only for a ready checkpoint with files; plan step cap with "and N more"; implemented proposed plan yields an `open-thread` action; `needsAttention`; essential sections in compact density; draft threads show only Status and Workspace. |
| `apps/web/src/fork/panels/registry.test.ts`        | Created with `ext-panels` if missing: unique ids and letters (I must not collide with another fork panel).                                                                                                                                                                                                                                                                                                                                           |
| `packages/contracts/src/fork/keybindings.test.ts`  | Created with `ext-keybindings` if missing: the two commands decode and start with `loom.`.                                                                                                                                                                                                                                                                                                                                                           |
| Palette values test                                | Created with `ext-palette` if missing.                                                                                                                                                                                                                                                                                                                                                                                                               |

## Commands

```sh
vp test run apps/web/src/fork/thread-inspector/model.test.ts apps/web/src/fork/panels/registry.test.ts \
  packages/contracts/src/fork/keybindings.test.ts
vp lint apps/web/src/fork apps/web/src/components/chat/ChatHeader.tsx packages/contracts/src/fork
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/contracts typecheck   # only if keybindings changed contracts
vp run --filter t3 typecheck                   # contracts consumers
vp run --filter @t3tools/client-runtime typecheck
```

## Manual check

With Kyle's permission for a dev server and browser, on seeded data:

1. Open a Codex thread mid-run with a plan: Inspector panel shows Working with the step and
   elapsed time; Plan lists steps; Agents counts match the Agents panel.
2. Claude thread waiting on approval: the header button shows the dot; Attention lists the
   approval; "Respond" focuses the composer with the approval panel visible.
3. Thread with uncommitted changes in a worktree: Workspace shows branch, worktree path
   (copy works), ahead and behind; Changes shows totals and top files; "Review" opens the
   diff panel; "Last turn" opens it on the last turn.
4. Open the card with the eye button. It closes on: a click in the timeline, Escape, a
   window resize, opening the right panel, a jump action. It does not close while a reply
   streams. The eye button toggles it without flicker. At 800 px: compact density.
5. Keybindings (bind them in Settings > Keybindings first): toggle panel, toggle card. The
   two palette items, "Show thread inspector" and "Show thread inspector card", do the
   same.
6. Upstream T3 server: everything works (client-only).
7. Performance: with the card open during a long streaming reply, the profiler shows no
   continuous re-render and the 1 Hz ticker stops when the tab is hidden.

## Merge safety

- `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly>` on the
  branch; conflicts only on the marked lines in `ChatHeader.tsx` (plus extension point seam
  files if this packet created any).
- After merge to main: `scripts/fork/loom.sh integrate nightly --dry-run`.
