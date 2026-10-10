# L42 seams

## Upstream files touched

None. Every edit is in fork-owned files.

## Fork-owned shared files edited

These are on the shared touch points list in
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md). Keep each change additive.

| File                                                           | Change                                                                                                                                                 | Likely to meet                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`    | `ghosts` group, retention branch in `setModel`, ghost calls in `applySection` and `theme`, `keepPrevious`/`showPrevious`/`clearPrevious`/`hasPrevious` | Every viewer packet; L49 (`setGhost`), L35 (`setModel`)     |
| `apps/web/src/fork/model-preview-3d/viewer/ghost.ts`           | Created here unless L49 lands first, per the shared definition plus three methods                                                                      | L49                                                         |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`            | `D` key line, chip, previous state in `onStats`, `display` and `snapshot` editor cases, palette action handler                                         | Every packet with a key or editor case; L49 (`T`, `[`, `]`) |
| `apps/web/src/fork/model-preview-3d/WorkspaceTools.tsx`        | One `DisplayTools` checkbox and prop, one `HELP` row, `PreviousChip`                                                                                   | L31, L36, L49 (display items)                               |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`        | `previousSize` on `PartSection`                                                                                                                        | L32 (fit list in Part), L40                                 |
| `apps/web/src/fork/model-preview-3d/actions.ts`, `palette.tsx` | One `ModelAction` value and one palette item                                                                                                           | Any packet adding a palette action                          |
| `apps/web/src/fork/model-preview-3d/viewer/ViewerCanvas.tsx`   | Two props and effects                                                                                                                                  | L31, L36, L39                                               |
| `packages/contracts/src/fork/model-editor.ts`                  | `previous` on the action and the state                                                                                                                 | Every packet adding an editor field                         |
| `apps/server/src/fork/model-preview-3d/mcp.ts`                 | One phrase in the editor tool description                                                                                                              | Any packet extending the editor command                     |

## Shared definition change requested

The "Ghost overlay" definition lists only `set` and `dispose`. This packet needs
`setVisible`, `setTheme` and `setClipping`, and types the first parameter as `Object3D`. All are
additive. The definition in MODEL-3D-FOLLOW-UPS.md should be updated to match before L49 starts.

## Keyboard

`D`, already allocated to L42.
