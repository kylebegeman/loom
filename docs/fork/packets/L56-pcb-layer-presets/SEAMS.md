# L56 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

| File                                                | Change                                                    | Also edited by                         |
| --------------------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| `packages/contracts/src/fork/pcb-layer-presets.ts`  | New; the preset data and resolver.                        | L57, L65 (read)                        |
| `packages/contracts/src/fork/index.ts`              | One re-export line.                                       | Every packet with a new contracts file |
| `packages/contracts/src/fork/pcb-workspace.ts`      | Optional `layerPreset` in editor state.                   | L52, L53, L55, L60, L66, L69           |
| `apps/web/src/fork/pcb-preview/preferences.ts`      | Decoding defaults; `hiddenLayerPresets`.                  | L54 (`lengthUnit`)                     |
| `apps/web/src/fork/pcb-preview/LayersTab.tsx`       | Presets section; saved set reconcile.                     | L61                                    |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx` | Menu group, labels, editor `layers` case, snapshot field. | Most PCB packets                       |
| `apps/server/src/fork/pcb-preview/mcp.ts`           | Editor description sentence.                              | Most PCB packets                       |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
