# L32 seams

## Extension points created by this packet

None: all existed (L23 created `ext-settings` and `ext-mcp`; the rest predate it).

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                           | Change                                                                                                            | Also edited by                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `packages/contracts/src/fork/model-beds.ts`                    | Created by the first of L32, L33, L34 (bed definitions moved here); L32 adds the fit helpers and `BedFitSummary`. | L33, L34, L51                                     |
| `packages/contracts/src/fork/model-preview-3d.ts`              | Bed definitions removed (moved).                                                                                  | Every settings packet (L33, L34, L40)             |
| `packages/contracts/src/fork/model-editor.ts`                  | `ModelEditorState.fit`.                                                                                           | Packets adding display modes (L31, L36, L42, ...) |
| `packages/contracts/src/fork/index.ts`                         | One export line.                                                                                                  | Any packet adding a contracts file                |
| `apps/web/src/fork/model-preview-3d/buildPlate.ts`             | Wrappers over `model-beds.ts`, `describeFit`.                                                                     | L33, L34, L40                                     |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`        | Part renders the list; advice uses `fitOnBed`.                                                                    | L34, L35, L40, L46                                |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`            | `state.fit` in the snapshot branch only.                                                                          | Most packets (key handler)                        |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts` | `renderImages` returns `fit`.                                                                                     | L36, L46                                          |
| `apps/server/src/fork/model-preview-3d/mcp.ts`                 | Render tool schema and description.                                                                               | L36, L46                                          |

The move into `model-beds.ts` is the one change that is not purely additive. Land it in its own
commit (`refactor(fork-model-bed-fit): keep bed data in one contracts module`) so a parallel
branch that edited the presets can replay its change onto the new file.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
