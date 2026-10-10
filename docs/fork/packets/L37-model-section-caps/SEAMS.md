# L37 seams

## Extension points created by this packet

None: all existed.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                           | Change                                                                                                                           | Also edited by          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `packages/contracts/src/fork/model-workspace.ts`               | `ModelSection.caps` with its decoding default.                                                                                   | L31, L35, L36           |
| `packages/contracts/src/fork/model-editor.ts`                  | `"wall-thickness"` action, `ModelWall`, `wall` on result and complete, `state.sectionCaps`.                                      | L31, L32, L35, L36, L42 |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts` | One line copying `wall` in `completeEditor`.                                                                                     | L32, L35, L36, L46      |
| `apps/server/src/fork/model-preview-3d/mcp.ts`                 | Editor tool description.                                                                                                         | L32, L35, L36, L46      |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`    | `stencil: true`, caps instance and its calls, hover and `dblclick` handlers, cap-aware `pick`, `setClosedHint`, `onWallMeasure`. | L31, L35, L36, L38, L42 |
| `apps/web/src/fork/model-preview-3d/viewer/ViewerCanvas.tsx`   | Cap state and manifold hint props.                                                                                               | L31, L35, L36, L42      |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`            | Editor `wall-thickness` case, `state.sectionCaps`, strip props.                                                                  | Most packets            |
| `apps/web/src/fork/model-preview-3d/WorkspaceTools.tsx`        | "Filled cut" button appended to `SectionStrip`.                                                                                  | L35, L36, L42           |
| `apps/web/src/fork/model-preview-3d/useModelEditing.ts`        | Default `caps: true`; wall measurement save.                                                                                     | L35, L38                |
| `apps/web/src/fork/model-preview-3d/workspace.module.css`      | Chord line style in the marks layer.                                                                                             | Most UI packets         |

The renderer option change (`stencil: true`) is one line but affects every viewer packet's
manual checks; land it in the first commit.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
