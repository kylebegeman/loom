# L13 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. The four tabs are
independent; ship them in the order below and commit after each.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Work in a worktree; seed its `.t3` with a `VACUUM INTO` copy of real data so there
are idle threads to test Once on. Ask Kyle before starting dev servers or browsers.

## File layout

```
packages/contracts/src/fork/composer-drawers.ts
packages/client-runtime/src/fork/composer-drawers.ts
apps/server/src/fork/composer-drawers/ShellRunner.ts
apps/server/src/fork/composer-drawers/ShellRunner.test.ts
apps/server/src/fork/composer-drawers/rpc.ts
apps/web/src/fork/composer-drawers/registry.ts
apps/web/src/fork/composer-drawers/drawerStore.ts
apps/web/src/fork/composer-drawers/ComposerToolsDrawer.tsx
apps/web/src/fork/composer-drawers/once.ts
apps/web/src/fork/composer-drawers/once.test.ts
apps/web/src/fork/composer-drawers/OnceTab.tsx
apps/web/src/fork/composer-drawers/OnceRestorer.tsx
apps/web/src/fork/composer-drawers/schema.ts
apps/web/src/fork/composer-drawers/schema.test.ts
apps/web/src/fork/composer-drawers/SchemaTab.tsx
apps/web/src/fork/composer-drawers/shell.ts
apps/web/src/fork/composer-drawers/shell.test.ts
apps/web/src/fork/composer-drawers/ShellTab.tsx
apps/web/src/fork/composer-drawers/state.ts
apps/web/src/fork/composer-drawers/clipboard.ts
apps/web/src/fork/composer-drawers/clipboard.test.ts
apps/web/src/fork/composer-drawers/clipboardFilter.ts
apps/web/src/fork/composer-drawers/clipboardFilter.test.ts
apps/web/src/fork/composer-drawers/ClipboardCapture.tsx
apps/web/src/fork/composer-drawers/ClipboardTab.tsx
apps/web/src/fork/composer-drawers/settings.tsx
apps/web/src/fork/composer-drawers/palette.tsx
apps/web/src/fork/composer-drawers/commands.ts
docs/fork/user/composer-drawers.md
```

## Steps

1. Extension points: existence checks for `ext-composer`, `ext-web-root`,
   `ext-keybindings`, `ext-palette`, `ext-settings` (and `ext-core` before step 7);
   create missing ones exactly as specified, one commit each.
2. Drawer frame: `drawerStore.ts`, `ComposerToolsDrawer.tsx` (tabs with roving focus:
   arrow keys move between tabs), `registry.ts` with the footer block and the drawer;
   register both in `fork/composer/registry.tsx`. Four placeholder tabs. Keybinding
   commands and `commands.ts` for `tools`; palette item "Composer tools". Commit
   `feat(fork-composer-drawers): open a composer tools drawer`.
3. Schema tab: `schema.ts` + test, `SchemaTab.tsx`, saved schemas. Commit.
4. Clipboard: `clipboardFilter.ts` + test (write the test cases first), `clipboard.ts` +
   test, `ClipboardCapture.tsx` (append to `FORK_ROOT_COMPONENTS`), `ClipboardTab.tsx`,
   `settings.tsx` (append to `FORK_SETTINGS_SECTIONS`; regenerate the route tree only if
   this packet created `ext-settings`). Palette items "Clipboard history", "Clear
   clipboard history"; command `clipboard`. Commit
   `feat(fork-composer-drawers): keep a local clipboard history for the composer`.
5. Once: `once.ts` (pure snapshot and compare helpers plus the store record type) + test,
   `OnceTab.tsx`, `OnceRestorer.tsx` (append to `FORK_ROOT_COMPONENTS`). Use the thread
   command atoms from `apps/web/src/state/threads` (`threadEnvironment.updateMetadata`,
   `threadEnvironment.setRuntimeMode`, as `ChatView.tsx:1481-1487` does) with
   `useAtomCommand`. Command `once`; palette item. Commit
   `feat(fork-composer-drawers): send one message with different settings`.
6. Manual check of Once with a real provider before moving on (TESTING.md); the restore
   rules are the riskiest part of the packet.
7. Shell, server: contracts file, merge the group, `ShellRunner.ts` with
   `Layer.provide(ProcessRunner.layer)`, `rpc.ts`, registrations, scope
   `terminal:operate`, feature slug. `ShellRunner.test.ts`. Typecheck contracts, server,
   client-runtime, web, mobile.
8. Shell, client: client-runtime atoms, `state.ts`, `shell.ts` + test,
   `ShellTab.tsx`; command `shell`; palette item. Commit
   `feat(fork-composer-drawers): run a command and attach its output`.
9. User doc `docs/fork/user/composer-drawers.md`: the four tabs, the clipboard privacy
   rules, the shell's timeout and cap, that Once restores after the turn.
10. Packet index Status.

## Code sketches

Drawer registration:

```tsx
export const composerToolsDrawer: ForkComposerDrawer = {
  id: "composer-tools",
  useDrawer: ({ environmentId, threadRef, replace }) => {
    const threadKey = scopedThreadKey(threadRef);
    const open = useComposerToolsDrawerStore((s) => (s.openThreadKey === threadKey ? s.tab : null));
    const handle = useComposerHandleContext();
    if (open === null) return null;
    return (
      <ComposerToolsDrawer
        tab={open}
        environmentId={environmentId}
        threadRef={threadRef}
        replace={replace}
        handle={handle}
      />
    );
  },
};
```

Once compare (pure, tested):

```ts
export function onceRestoreActions(input: {
  snapshot: OnceSnapshot;
  shell: Pick<OrchestrationThreadShell, "modelSelection" | "runtimeMode" | "latestTurn">;
  sentAt: string;
}): { ready: boolean; modelSelection?: ModelSelection; runtimeMode?: RuntimeMode } {
  const turn = input.shell.latestTurn;
  if (!turn || turn.requestedAt < input.sentAt || turn.state === "running") return { ready: false };
  return {
    ready: true,
    ...(Equal.equals(input.shell.modelSelection, input.snapshot.thread.modelSelection)
      ? {}
      : { modelSelection: input.snapshot.thread.modelSelection }),
    ...(input.shell.runtimeMode === input.snapshot.thread.runtimeMode
      ? {}
      : { runtimeMode: input.snapshot.thread.runtimeMode }),
  };
}
```

(Check `OrchestrationLatestTurnState` literals in `packages/contracts/src/orchestration.ts:608`
for every non-terminal state; treat all of them like `"running"`.)

## Pitfalls

- The restore must not undo a change the user made after the turn: compare with the
  override values captured at send time as well. Record `overrideAtSend` (the shell's
  `modelSelection` and `runtimeMode` right after the send is observed) and restore a field
  only if the shell still equals `overrideAtSend` for that field.
- `latestUserMessageAt` also advances when an async question answer creates a message
  (decider, `thread.user-input.respond` in message mode). Arm only while no async
  question is pending for the thread, or accept that such an answer counts as "the next
  message" (document the choice in the user doc; the first is simpler to explain).
- Queued follow-ups: Once is disabled while a turn runs, so the send is never queued.
- Wrapping `navigator.clipboard.writeText`: keep a reference to the original bound to
  `navigator.clipboard`; restore it on disable; never wrap twice (HMR re-mounts).
- `document.getSelection()` inside a `copy` event handled by upstream code that calls
  `preventDefault` and sets its own data (for example markdown copy in
  `ChatMarkdown.tsx`'s `onCopy={handleCopy}`): record `event.clipboardData?.getData("text/plain")`
  after upstream's handler ran (listen in the bubble phase on `document`), falling back to
  the selection.
- The shell runs with the server process's environment and the user's login shell; on a
  remote environment that is the remote machine. The UI shows the cwd so this is visible.
- Never log command output on the server.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Once restores the composer on send and the thread after the turn, and never overwrites a
  later user change.
- Clipboard history is empty and captures nothing until enabled; turning it off clears it.
- A shell command that times out, fails to spawn, or prints 1 MB behaves as TESTING.md
  describes.
