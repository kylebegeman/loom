# L07 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps. Test the pure logic each
phase adds; do not render components to markup to assert attributes.

## Automated tests

| Phase | File                                                       | Covers                                                                                                                                                                                                                                                                                                                                        |
| ----- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `apps/web/src/fork/bottom-dock/dockView.test.ts`           | Every row of the one-tab table: closed; terminal with and without registered tabs; fork tab; terminal plus fork tab resolves to terminal; an unknown persisted tab id resolves to closed.                                                                                                                                                     |
| 1     | `apps/web/src/fork/bottom-dock/layout.test.ts`             | Clamp at 180 px and 75% of the window height; tiny windows never go below the minimum.                                                                                                                                                                                                                                                        |
| 1     | `apps/web/src/fork/bottom-dock/store.test.ts`              | `showDockTab`, `showTerminalTab`, `hideDock` leave upstream's terminal store and the dock store in the expected combination (drive the real zustand stores); `lastForkTab` is remembered; persisted state with an unknown version or tab id loads safely; pruning keeps at most 200 threads.                                                  |
| 1     | `apps/web/src/fork/bottom-dock/registry.test.ts`           | Tab ids unique, kebab-case, not `"terminal"`; every `command` is in `FORK_KEYBINDING_COMMANDS`.                                                                                                                                                                                                                                               |
| 2     | `apps/web/src/fork/bottom-dock/tasks/taskModel.test.ts`    | Terminal id helpers and `isTaskTerminalId` (never matches `term-N` or `setup-*`); row state for each `TerminalSummary` combination; ad-hoc index allocation skips existing ids; recent commands dedupe and cap.                                                                                                                               |
| 3     | `apps/web/src/fork/bottom-dock/activity/rows.test.ts`      | Built from a real-shaped thread fixture (copy one from `apps/web/src/session-logic.test.ts` fixtures where possible): each source maps to its kind and tone; noise kinds excluded; streaming assistant partials skipped; newest-first order with sequence tie-break; payloads are not stringified until `detail()`; `detail()` caps at 20 KB. |
| 3     | `apps/web/src/fork/bottom-dock/activity/search.test.ts`    | Multi-token matching, case-insensitive; chips combine with the query; group by turn keeps order; empty query returns all.                                                                                                                                                                                                                     |
| 4     | `apps/web/src/fork/bottom-dock/approvals/grouping.test.ts` | Only shells with pending flags; archived excluded; oldest first; first 20 marked for details; badge counts threads with approvals only.                                                                                                                                                                                                       |

Also run the extension point invariant tests this packet adds entries to:
`packages/contracts/src/fork/keybindings.test.ts` and the palette registry test.

## Commands

Phase 1:

```sh
vp test run apps/web/src/fork/bottom-dock packages/contracts/src/fork/keybindings.test.ts
vp lint apps/web/src/fork apps/web/src/components/ChatView.tsx packages/contracts/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
```

Phases 2 to 4: the same `vp test run` path (it covers the new subfolder), lint on
`apps/web/src/fork packages/contracts/src/fork`, and the same two typechecks.

If phase 1 created `ext-core` or `ext-keybindings`, also typecheck `t3`,
`@t3tools/client-runtime` and `@t3tools/mobile` (contracts changed).

## Manual check

Ask Kyle before starting a dev server or a browser. With permission, on web and once on
desktop, with a seeded worktree `.t3`.

Phase 1 (with no tabs registered, then with one tab registered locally for the check):

1. No tabs: Cmd+J, the header button, splitting, new terminal, closing, resizing, switching
   threads with terminals open, and running a project script all behave as on upstream.
2. One tab registered: the strip appears above the open terminal; clicking the tab swaps
   the terminal for the tab at the same height with a steady transition; Cmd+J swaps back;
   the collapse button closes; each thread remembers its own tab; dragging the tab's top edge
   changes the terminal's height too.
3. Right panel terminal surface still works and its shortcuts still go to it when focused.

Phase 2: add scripts to a project; run the dev server and tests as tasks; select each to
see live output; type into a task that prompts; Stop and Restart; close the dock, switch
threads, come back: tasks still running; "Open in Terminal tab" activates the session; run
and remove an ad-hoc command; reload: recent commands remain.

Phase 3: open a long thread; search for a tool name; filter Errors; expand and copy a row;
"Load older turns" extends results; typing stays responsive.

Phase 4: two threads in Ask mode waiting for approval, one in another environment if
available; both appear; approve one, decline the other; both threads continue; a question
(user input) shows with "Open thread".

Upstream server: connect to an upstream T3 server and repeat phase 3 on one of its threads;
the dock works (client-only).

Remote: from a second browser over the tailnet, run a task and answer an approval.

## Merge safety

- Before review: the `git merge-tree` preview in SEAMS.md. Expected clean or a ChatView
  conflict on the two marked hunks only.
- After Kyle merges to main: `scripts/fork/loom.sh integrate nightly --dry-run` from a clean,
  synced `main`. Record the result here.
- After each upstream integration, re-check the seam placement (SEAMS.md, Merge check).
