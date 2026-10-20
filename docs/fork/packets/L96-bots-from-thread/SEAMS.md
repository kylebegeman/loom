# L96 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

| File                                                | Marker       | Lines | Why                                                                       |
| --------------------------------------------------- | ------------ | ----- | ------------------------------------------------------------------------- |
| `apps/web/src/components/threadActionMenu.logic.ts` | `fork: bots` | 3     | `save-as-bot` in `ThreadActionMenuId`, a `supports` flag, the item block. |
| `apps/web/src/hooks/useThreadActionMenu.ts`         | `fork: bots` | 3     | The import, the flag and the `case` for the thread header menu.           |
| `apps/web/src/components/Sidebar.tsx`               | `fork: bots` | 3     | The import, the same flag and `case` for the sidebar context menu.        |

Details:

- `threadActionMenu.logic.ts`: `| "save-as-bot"` in the union, `readonly saveAsBot?: boolean;` in
  `supports`, and an item block after `workspace-handoff` in `buildThreadActionMenuItems`: label
  "Save as bot…", icon `bot`. It is an operate action, so it stays off
  `threadActionRequiresOperate`'s read-only list.
- `useThreadActionMenu.ts`: the import, `saveAsBot: threadCanBeSavedAsBot(threadRef)` in the
  `supports` object and `case "save-as-bot": return openSaveAsBot(router, threadRef);` in the
  switch (the `case` line itself is unmarked; the `return` carries the marker).
- `Sidebar.tsx`: the same three lines in the sidebar's own `buildThreadActionMenuItems` call and
  switch.

`threadCanBeSavedAsBot` and `openSaveAsBot` live in `apps/web/src/fork/bots/fromThread/state.ts`,
so each call site is one line. The pure check, `canSaveAsBot(thread, capabilities,
botsEnvironmentId)`, is in `fromThread/logic.ts`.

Precedent: the fork's `workspace-handoff` item takes the same three places. In `Sidebar.tsx` its
lines carry `fork: workspace-handoff`; in `threadActionMenu.logic.ts` and `useThreadActionMenu.ts`
they are unmarked. This packet marks only its own lines. The unmarked precedent is a gap in the
workspace-handoff packet's seam accounting; it is reported for that packet's owner rather than
fixed here.

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

Recorded when the packet landed: `v0.1.1-nightly.20261020.3411`, 68 conflicting files, the same
68 the branch base already had. The three seam files merge cleanly.

## FORK.md rows

- The three files above, slug `bots`, packet L96.
- `docs/fork/seams.tsv`: `apps/web/src/components/threadActionMenu.logic.ts	bots	3`,
  `apps/web/src/hooks/useThreadActionMenu.ts	bots	3`, `apps/web/src/components/Sidebar.tsx	bots	3`.

## Where the build differs from the plan

- Drafting has its own `BotDraftsRpcGroup` rather than joining the bots RPC group, so the
  `bots-from-thread` feature and its scopes stand alone.
- "Save as bot…" navigates to `/loom/bots?fromThread=<threadId>` and the Bots page drafts there,
  rather than passing a draft through router state. The thread menu, the sidebar menu, the
  palette and a suggestion's **Create** share that one path, and a reload drafts again.
- A drafted bot's timeout defaults to 20 minutes, not 30.
- The menu item also requires the thread to live on the environment that hosts bots, and is
  hidden for bot run threads.
- Refinement runs a read-only drafting thread in a scratch workspace with interaction mode
  "default" under approval-required, rather than plan mode. A refinement that times out, fails or
  returns an unusable draft shows the original with a note. The server stops the drafting thread
  after 180 seconds.
- The editor's **Cancel refining** only stops waiting: client commands cannot be cancelled, so the
  server's limit still ends the drafting thread. A drafted id counts as edited, so changing the
  name does not rewrite it.
- Suggestions are keyed by the brief's shape (inputs, quoted values and numbers taken out) and
  store `entries_json` and `total_count` rather than one row per thread. A dismissal records
  `dismissed_total`, and the suggestion comes back once after 5 more matching threads. Threads
  whose first brief came before Loom was watching are recorded with an empty shape key so they
  never count; thread records are pruned after 30 days. The suggestion reactor resubscribes with
  `Effect.forever` after a stream failure.
- A pull request reference keeps its `#` in the draft's text, so `#123` becomes `#{{pr}}`.
- The server tests share `testing/DraftsHarness.ts`.
- The seam files carry 3 marker lines each, not the planned 3/2/2, because the imports carry
  markers too.
- The `bot` icon renders nowhere yet: the desktop menu ignores icons that are not destructive and
  the web menu's fallback set has no `bot`. This matches the workspace-handoff item.
- The web editor dropped a parameter's description (an L89 defect). It is fixed here: the editor
  edits the description and the run form shows it as a hint under the field.
