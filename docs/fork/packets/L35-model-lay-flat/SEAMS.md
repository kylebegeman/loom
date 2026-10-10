# L35 seams

## Extension points created by this packet

None: all existed (L23 registered the panel, palette, MCP tools and editor command).

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                           | Change                                                                                                                                             | Also edited by                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/contracts/src/fork/model-workspace.ts`               | Creates `ModelQuaternion`, `ModelOrientation`, `ModelWorkspace.orientation`, the `orientation` operation and two pure helpers (shared definition). | L36, L37 (`ModelCamera`/`ModelSection` fields), L42, L48 |
| `packages/contracts/src/fork/model-editor.ts`                  | `"orientation"` action, `"lay-flat"` tool, `state.orientation`.                                                                                    | L31, L32, L36, L37, L42                                  |
| `apps/server/src/fork/features.ts`                             | Appends `"model-lay-flat"`.                                                                                                                        | Any packet with server support                           |
| `apps/server/src/fork/model-preview-3d/workspace.ts`           | `orientation` branch in `applyWorkspaceOperation`.                                                                                                 | Packets adding workspace entities                        |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts` | `renderImages` options object, oriented wrapper, SCAD mesh export step.                                                                            | L32, L36, L46                                            |
| `apps/server/src/fork/model-preview-3d/openscad.ts`            | `meshArgs` builder.                                                                                                                                | L36 (reuses it), L46, L47                                |
| `apps/server/src/fork/model-preview-3d/mcp.ts`                 | Render tool `orientation` parameter and result; `save_workspace` description.                                                                      | L32, L36, L46                                            |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`    | `root` group, `setOrientation`, `faceOrientationAt`, `autoOrientation`, `"lay-flat"` pick mode, overlay under `root`.                              | L31, L36, L37, L38, L42                                  |
| `apps/web/src/fork/model-preview-3d/viewer/ViewerCanvas.tsx`   | `orientation` prop and effect.                                                                                                                     | L31, L36, L37, L42                                       |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`            | `L` key line, editor `orientation` case, `message` variable, status bar chip.                                                                      | Most packets                                             |
| `apps/web/src/fork/model-preview-3d/WorkspaceTools.tsx`        | `PickTool`, a `ToolRail` button, a `HELP` row.                                                                                                     | L36, L37, L42                                            |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`        | Orientation row in `PartSection`.                                                                                                                  | L32, L34, L40, L46                                       |
| `apps/web/src/fork/model-preview-3d/useModelEditing.ts`        | `"lay-flat"` picking.                                                                                                                              | L37 (wall measurement), L38                              |
| `apps/web/src/fork/model-preview-3d/actions.ts`, `palette.tsx` | Two palette actions.                                                                                                                               | L36, L44                                                 |

`viewer/createViewer.ts` gets the largest change: the `root` group changes where the model and
the overlay live. Land it as its own first commit
(`refactor(fork-model-lay-flat): keep the model and its marks under one root group`) with no
behaviour change, so parallel viewer packets can rebase onto it early.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
