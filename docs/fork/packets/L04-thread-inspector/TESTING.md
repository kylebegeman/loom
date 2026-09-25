# L04 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no markup tests.

## Automated tests

| File                                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/thread-inspector/model.test.ts` | Status precedence (approval over input over error over working over interrupted over ready) with the detail, tone and Respond flag of each; the working status carries the plan step, step counts and the turn start; a ready plan in plan mode outranks background work; fact chips; non-repo drops Changes; workspace entries with copy text and the short worktree name; linked and known pull requests (state, tone, glyph, action); file ordering by churn; last turn only for a ready checkpoint with files; loading; plan counts and the current step; proposed plan link; attention items; agent summary, order and cap; context tones at 75 and 90 percent; draft threads. |
| `apps/web/src/fork/panels/registry.test.ts`        | Unique ids and letters (I must not collide with another fork panel).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/contracts/src/fork/keybindings.test.ts`  | The two commands decode and start with `loom.`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Palette values test                                | Created with `ext-palette`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

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

1. Open a Codex thread mid-run with a plan: the hero shows Working with the step, the
   elapsed time and the step progress; the panel's Plan lists the steps; Agents rows and
   counts match the Agents panel.
2. Claude thread waiting on approval: the header button shows the dot; the hero says Needs
   approval with the approval kind; Needs you lists the command; "Respond" focuses the
   composer with the approval panel visible, and the card closes without pulling focus back
   to the eye button.
3. Thread with uncommitted changes in a worktree: Workspace shows the branch, ahead and
   behind, and the worktree path, and the copy buttons copy them; Changes lists the largest
   files with their stats and "Open diff" opens the diff panel on uncommitted changes; "Show"
   on Last turn opens it on the last turn.
4. The card opens under the eye button with its right edge on the button's right edge, and
   stays inside the viewport with the right panel open and closed. It closes on: a click in
   the timeline, Escape, a line's jump, "Open inspector panel". It does not close while a
   reply streams. The eye button toggles it without flicker; the tooltip does not show while
   it is open.
5. Keybindings (bind them in Settings > Keybindings first): toggle panel, toggle card, also
   with the terminal focused. On a draft thread both keys do nothing and reach the app
   underneath. The palette items "Show thread inspector" and "Show thread inspector card"
   open (never close) the panel and the card. The card's footer shows the toggle shortcut
   once bound.
6. Upstream T3 server: everything works (client-only).
7. Performance: with the card open during a long streaming reply, the profiler shows no
   continuous re-render and the 1 Hz ticker stops when the tab is hidden.

## Merge safety

- `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly>` on the
  branch; conflicts only on the marked lines in `ChatHeader.tsx` (plus extension point seam
  files if this packet created any).
- After merge to main: `scripts/fork/loom.sh integrate nightly --dry-run`.
