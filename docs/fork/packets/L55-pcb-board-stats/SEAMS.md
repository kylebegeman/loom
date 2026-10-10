# L55 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

| File                                                                 | Change                                                                                 | Also edited by                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/server/src/fork/pcb-preview/boardStats.ts`                     | New; the shared "Board stats" definition.                                              | L64, L67 (read stats), L70 (calls on variant Circuit JSON) |
| `apps/server/src/fork/pcb-preview/glb.ts`                            | `readGlbBounds`.                                                                       | L67 (may read bounds)                                      |
| `apps/server/src/fork/pcb-preview/semantics.ts`                      | Export the s-expression helpers if needed.                                             | L53, L60, L66                                              |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`              | `cachedModel` extracted from `runAsset`; stats call and inspection cache in `inspect`. | Most PCB packets (call sites only)                         |
| `apps/server/src/fork/pcb-preview/mcp.ts`                            | `loom_pcb_inspect` description.                                                        | Most PCB packets                                           |
| `packages/contracts/src/fork/pcb-workspace.ts`                       | `PcbBoardStats`; optional `stats` on `PcbInspection`.                                  | L53, L56, L60, L66, L69                                    |
| `apps/web/src/fork/pcb-preview/BoardStatsCard.tsx`                   | New.                                                                                   | L64 (may add a fab row)                                    |
| `apps/web/src/fork/pcb-preview/InspectTab.tsx`                       | "Board" section replaced by the card.                                                  | L53, L54                                                   |
| `apps/web/src/fork/pcb-preview/Inspector.tsx`, `PcbPreviewPanel.tsx` | Three callbacks passed to Inspect.                                                     | Most PCB packets                                           |
| `apps/web/src/fork/pcb-preview/summary.ts`                           | `boardStatsText`.                                                                      | L52, L54, L58                                              |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
