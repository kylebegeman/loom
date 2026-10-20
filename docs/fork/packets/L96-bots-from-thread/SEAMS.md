# L96 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

| File                                                | Marker       | Lines | Why                                                                       |
| --------------------------------------------------- | ------------ | ----- | ------------------------------------------------------------------------- |
| `apps/web/src/components/threadActionMenu.logic.ts` | `fork: bots` | 3     | `save-as-bot` in `ThreadActionMenuId`, a `supports` flag, the item block. |
| `apps/web/src/hooks/useThreadActionMenu.ts`         | `fork: bots` | 2     | The flag and the `case` for the thread header menu (`ChatHeader.tsx`).    |
| `apps/web/src/components/Sidebar.tsx`               | `fork: bots` | 2     | The same flag and `case` for the sidebar context menu.                    |

Details:

- `threadActionMenu.logic.ts`: add `| "save-as-bot"` to the union (`:4`), `readonly saveAsBot?:
boolean;` to `supports` (`:82-89`), and an item block after `workspace-handoff` in
  `buildThreadActionMenuItems` (`:110-117`): label "Save as bot…", icon `bot`. It is an operate
  action, so it stays off `threadActionRequiresOperate`'s read-only list (`:93`).
- `useThreadActionMenu.ts`: `saveAsBot: canSaveAsBot(capabilities, thread.id)` in the `supports`
  object (`:126`) and `case "save-as-bot": openSaveAsBot(threadRef); return;` in the switch
  (`:188-191`).
- `Sidebar.tsx`: the same two lines in the sidebar's own `buildThreadActionMenuItems` call
  (`supports` at `:4288-4294`) and switch (`:4315-4318`).

`canSaveAsBot` (`supportsLoomFeature(capabilities, "bots-from-thread") &&
!isBotRunThreadId(threadId)`) and `openSaveAsBot` live in
`apps/web/src/fork/bots/fromThread/state.ts`, so each call site is one line.

Precedent: the fork's `workspace-handoff` item takes the same three places. In `Sidebar.tsx` its
lines carry `fork: workspace-handoff` (`:6-7`, `:4289`, `:4316`); in
`threadActionMenu.logic.ts` and `useThreadActionMenu.ts` they are unmarked. This packet marks only
its own lines. The unmarked precedent is a gap in the workspace-handoff packet's seam
accounting; it is reported for that packet's owner rather than fixed here.

The menu has no item registry, so this is a seam. A third fork thread action would justify an
`ext-thread-menu` extension point that merges a fork item list in `buildThreadActionMenuItems`
and dispatches fork ids in one place; one item does not.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here when the packet lands.

## FORK.md rows

- The three files above, slug `bots`, packet L96.
- `docs/fork/seams.tsv`: `apps/web/src/components/threadActionMenu.logic.ts	bots	3`,
  `apps/web/src/hooks/useThreadActionMenu.ts	bots	2`, `apps/web/src/components/Sidebar.tsx	bots	2`.
