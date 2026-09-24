# L04 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and every
file in this folder. For the manual check, seed a worktree `.t3` with real data: threads with
changes, a plan, subagents and a pending approval make the best test set.

## Steps

1. **Extension points.** Existence checks for `ext-panels`, `ext-web-root`,
   `ext-keybindings`, `ext-palette`; create missing ones exactly as specified, one commit
   each, with FORK.md rows.
2. **Model first.** `model.ts` and `model.test.ts` (TESTING.md lists the cases). Build the
   inputs in tests from plain objects typed with the upstream types; do not render
   components.
3. **Hook.** `useInspectorInputs.ts`. Read `ChatView.tsx:2840-2900` and `3020-3031` and pass
   the same arguments to the same derivations. Compute `cwd = thread.worktreePath ??
project.workspaceRoot` and pass `null` to `useEnvironmentQuery` for drafts.
4. **Actions.** `actions.ts` as in TECHNICAL.md.
5. **View.** `ThreadInspector.tsx` with both densities. Use upstream UI primitives
   (`Tooltip`, `Button`, badges) and existing tokens; icons from `lucide-react`.
6. **Panel.** `panel.tsx`; register in `FORK_PANELS`. Check it in the running app (with
   Kyle's permission for a browser).
7. **Card.** `cardStore.ts`, `InspectorCard.tsx`,
   `ThreadInspectorHeaderButton.tsx`; apply the `ChatHeader.tsx` seam from SEAMS.md; run
   `vp fmt` on it; check the marker count. Verify placement with the right panel open and
   closed and at 800 px width (compact density), and every dismissal trigger.
8. **Commands and palette.** Keybinding commands, `InspectorCommandsHost` in `ForkRoot`,
   palette source (items `action:loom:thread-inspector:toggle` and `...:card`, with
   `shortcutCommand` set).
9. **Section registry.** `sections.ts` with an empty `FORK_INSPECTOR_SECTIONS`, rendered
   after the built-in sections (both densities pass `density`).
10. **Docs and status.** `docs/fork/user/thread-inspector.md` (short: how to open, how to
    show the card, what the dot means). FORK.md row; packet index Status.

## Pitfalls

- Do not subscribe to another thread's detail: the inspector only ever shows the thread it
  was opened for, which for the card is the route thread.
- `derivePendingRequests` and `foldSubagentActivities` must be memoized on the activities
  array; calling them on every render of a streaming thread wastes work.
- The header container has fixed right padding for the panel controls (`pr-16` when the
  right panel is closed); the button must not change it.
- The portal card must not trap focus or block clicks outside itself; it is not a modal.
  Clicks on the eye button must not count as "outside" (check the trigger attribute), or the
  button would close and reopen it.
- Keep the elapsed-time ticker off when the tab is hidden.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Every row shows correct values for a running Codex thread with a plan, a Claude thread
  waiting on approval, and an idle thread with uncommitted changes in a worktree.
- Every jump action lands on the right surface.
- The card closes on each dismissal trigger and on its own jump actions, and never on a
  streaming height change.
- Works unchanged against an upstream T3 server.
