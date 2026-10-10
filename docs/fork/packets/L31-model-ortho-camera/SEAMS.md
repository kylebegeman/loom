# L31 seams

## Extension points created by this packet

None: all existed.

## Packet seams

None. L31 edits only fork-owned files.

## Fork-owned shared files edited

From the shared touch points in [MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md):

| File                                              | Change                                                                                                   | Collides with                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `viewer/createViewer.ts`                          | `ortho`, `activeCamera()`, `setProjection`; `camera` to `activeCamera()` in render, pick, marks, capture | L35-L38, L42, L48 (all add methods) |
| `ModelPanel.tsx`                                  | `P` key `else if`; `display.projection`; editor `display` case                                           | Every packet adding a key           |
| `WorkspaceTools.tsx` (`DisplayTools`, `HELP`)     | Append "Orthographic" item and help row                                                                  | L36, L42 (display toggles)          |
| `viewer/ViewerCanvas.tsx`                         | `display.projection`                                                                                     | Packets adding display modes        |
| `model-workspace.ts`                              | `ModelProjection`, `ModelCamera.projection`                                                              | Packets adding workspace fields     |
| `model-editor.ts`                                 | `projection` on `ModelEditorAction`                                                                      | Packets adding display modes        |
| `openscad.ts`, `mcp.ts`, `ModelPreviewService.ts` | Render projection                                                                                        | L36 (render tool shading)           |

Merge rule: append, never reorder. Packets landing after L31 render and raycast through
`activeCamera()`.

## Merge check

Run `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly tag>` before
merging. Expect no conflicts: no upstream file changes.

## FORK.md rows

None.
