# L03 seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points

Used: `ext-web-root`, `ext-keybindings` and `ext-palette`. Run each existence check from
EXTENSION-POINTS.md; create missing ones exactly as specified, one commit each, before any
packet code. Record which ones this packet created and their commits here.

Registrations (fork-owned files only):

| Registry                                       | Entry                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/contracts/src/fork/keybindings.ts`   | `"loom.compaction-and-goals.compact"`, `"loom.compaction-and-goals.goal"` |
| `apps/web/src/fork/ForkRoot.tsx`               | `{ id: "compaction-and-goals", Component: CommandsHost }`                 |
| `apps/web/src/fork/commandPalette/registry.ts` | `compactionAndGoalsPaletteSource,`                                        |

The retired fork goals (2026-10-09, Kyle approved; README, "Retired parts") also used
`ext-core`, `ext-composer`, `ext-turn-input` and a `ChatView.tsx` chip seam. None of those
are needed now.

## Packet seams

None.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here. The packet touches no upstream file, so no conflict is
expected from it.

## FORK.md rows

No "Packet seams" rows. "Extension point seams" rows only for the extension points this
packet creates, as EXTENSION-POINTS.md specifies them.
