# L38 seams

## Upstream files touched

None. Every edit is in fork-owned files. The worker import style mirrors upstream's
`apps/web/src/components/DiffWorkerPoolProvider.tsx:3` but does not touch it.

## Fork-owned shared files edited

These are on the shared touch points list in
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md). Keep each change additive.

| File                                                           | Change                                                                                                                                                                                                   | Likely to meet                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`    | `pick()` return shape, measure branches in `pointerMove`/`pointerUp`, circle drawing in `drawOverlay`, new methods `setMeasureMode`, `snapStatus`, `snapPoint`, `circleNear`, `onSnapStatus`, `onCircle` | Every viewer packet; L43 (pointer and keyboard), L36 (section caps) |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`            | Hint content, `tool`/`pick`/`snapshot` editor cases                                                                                                                                                      | Every packet with a key or editor case                              |
| `packages/contracts/src/fork/model-editor.ts`                  | `snap`, `snapRadius`, `measure`; `measureMode`; `measurement` in results                                                                                                                                 | Every packet adding an editor field                                 |
| `packages/contracts/src/fork/model-workspace.ts`               | `kind` and `circle` on `ModelMeasurement`, new `ModelCircle`                                                                                                                                             | L35 (orientation entity), L49                                       |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts` | One spread line in `completeEditor`                                                                                                                                                                      | Any packet returning a new editor result field                      |
| `apps/server/src/fork/model-preview-3d/mcp.ts`                 | One sentence in the editor tool description                                                                                                                                                              | Any packet extending the editor command                             |

New files owned by this packet: `viewer/snap.ts`, `viewer/snapTopology.worker.ts`,
`viewer/snapOverlay.ts` and their tests.

## Keyboard

`Alt` held while picking, already allocated to L38. No new keys.
