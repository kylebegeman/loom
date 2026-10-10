# L36 seams

## Extension points created by this packet

None: all existed (L23 created `ext-settings` and `ext-mcp`; the rest predate it).

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                           | Change                                                                                                            | Also edited by                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/contracts/src/fork/model-overhangs.ts`               | New: constants, `OverhangStats`, `overhangStats`.                                                                 | L46 (reads it)                     |
| `packages/contracts/src/fork/index.ts`                         | One export line.                                                                                                  | Any packet adding a contracts file |
| `packages/contracts/src/fork/model-preview-3d.ts`              | `overhangAngleDegrees` setting and default.                                                                       | L32, L33, L34, L40                 |
| `packages/contracts/src/fork/model-workspace.ts`               | `ModelCamera.overhangs`.                                                                                          | L31 (projection), L35, L37         |
| `packages/contracts/src/fork/model-editor.ts`                  | `display` gains `overhangs`.                                                                                      | L31, L32, L35, L37, L42            |
| `apps/server/src/fork/features.ts`                             | Appends `"model-overhangs"`.                                                                                      | Any packet with server support     |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts` | `renderImages` options `overhangs`, mesh export, stats.                                                           | L32, L35, L46                      |
| `apps/server/src/fork/model-preview-3d/openscad.ts`            | Reuses or creates `meshArgs`.                                                                                     | L35, L46, L47                      |
| `apps/server/src/fork/model-preview-3d/mcp.ts`                 | Render tool `overhangs`, `overhangAngle`, result.                                                                 | L32, L35, L46                      |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`    | Shading instance, `setOverhangs`, `setOverhangAngle`, patch in `setModel`, theme colours, snapshot/restore field. | L31, L35, L37, L38, L42            |
| `apps/web/src/fork/model-preview-3d/viewer/ViewerCanvas.tsx`   | `display.overhangs` and angle props.                                                                              | L31, L35, L37, L42                 |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`            | `V` line, display state, editor `display` field, legend placement.                                                | Most packets                       |
| `apps/web/src/fork/model-preview-3d/WorkspaceTools.tsx`        | Display menu item (appended), `HELP` row, `OverhangLegend`.                                                       | L35, L37, L42                      |
| `apps/web/src/fork/model-preview-3d/actions.ts`, `palette.tsx` | One palette toggle.                                                                                               | L35, L44                           |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
