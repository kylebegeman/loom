# L61 seams

## Extension points created by this packet

None: all existed.

## Packet seams

None. L61 touches no upstream file. Every edit is in fork-owned L23 (3D model viewer) or L24 (PCB
panel) files, or in new fork files.

## New fork files

- `apps/web/src/fork/pcb-preview/board3dParts.ts` and `board3dParts.test.ts`
- `apps/web/src/fork/pcb-preview/heights.ts` and `heights.test.ts`
- `apps/web/src/fork/pcb-preview/Board3DTools.tsx`
- Only when the 3D packet has not landed, the shared files it specifies, in its location:
  `viewer/projection.ts` (L31), `viewer/sectionCaps.ts` (L37), `viewer/weld.ts` (L35, L37 or
  L38), `viewer/snap.ts`, `viewer/snapTopology.worker.ts`, `viewer/snapOverlay.ts` (L38), each
  under `apps/web/src/fork/model-preview-3d/`.

## Fork-owned shared files edited

From the shared touch points in [PCB-FOLLOW-UPS.md](../PCB-FOLLOW-UPS.md) and
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md):

| File                                                             | Change                                                                                                                                                                                                                     | Collides with                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`              | `display3d` state; three key lines (`Escape` in 3D, `M` in 3D, `P`); editor cases `display`, `section`, `measure`, `height`, 3D `tool`; snapshot spread; `measurement3d` in the completion; `default` in the editor switch | Every PCB packet with a key or editor action (L52, L60, L66, L69) |
| `apps/web/src/fork/pcb-preview/Board3D.tsx`                      | Props, display effect, tools, handle methods, `ShortcutHelp` in the nav shelf                                                                                                                                              | L62 (capture), L63 (3D keyboard), L67                             |
| `apps/web/src/fork/pcb-preview/Board3D.test.tsx`                 | Mock viewer gains the new methods                                                                                                                                                                                          | L62, L63                                                          |
| `apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx`              | `SHORTCUTS` row for `P`, `SHORTCUTS_3D`, `rows` prop on `ShortcutHelp`                                                                                                                                                     | L52, L60, L66, L69 (rows)                                         |
| `packages/contracts/src/fork/pcb-workspace.ts`                   | `Pcb3d*` schemas; action literals and fields; result and state fields                                                                                                                                                      | Most packets with editor actions                                  |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`          | One spread at `:2383-2387`                                                                                                                                                                                                 | Packets adding editor result fields                               |
| `apps/server/src/fork/pcb-preview/mcp.ts`                        | `loom_pcb_editor` description (`:27`)                                                                                                                                                                                      | Packets adding editor actions                                     |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`      | `pick` skips hidden objects; `invalidate()`                                                                                                                                                                                | L31, L35-L38, L42, L48 (all add methods)                          |
| `apps/web/src/fork/model-preview-3d/viewer/sectionCaps.ts` (L37) | `syncTransforms` copies source visibility to the helpers                                                                                                                                                                   | L37                                                               |
| `apps/web/src/fork/model-preview-3d/WorkspaceTools.tsx`          | Optional `removeKey` prop on `SectionStrip`                                                                                                                                                                                | L31, L36, L42 (display items)                                     |
| `docs/fork/user/pcb-preview.md`                                  | 3D tools paragraph, `P` and `M` in the shortcuts sentence, agent examples                                                                                                                                                  | Every PCB packet with user-facing changes                         |

Merge rule: append, never reorder. Key lines go before `else return` in the order of the key
table; the 3D `Escape` line goes directly before the `escape && tab` line.

## Merge check

Run `scripts/fork/loom.sh check` and
`git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly tag>` before merging.
Expect no conflicts: no upstream file changes.

## FORK.md rows

None.
