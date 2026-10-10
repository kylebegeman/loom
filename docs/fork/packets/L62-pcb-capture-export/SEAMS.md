# L62 seams

## Extension points created by this packet

None: all existed.

## Packet seams

None. L62 changes no upstream file. The menu, clipboard and download APIs it uses are upstream
exports (`~/components/ui/menu`) and browser APIs. Desktop needs no IPC.

## Fork-owned shared files edited

| File                                                                | Change                                                                                              | Collides with                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `apps/web/src/fork/model-preview-3d/captureExport.ts`               | Optional `extension` parameter on `captureFileName`; creates the file per L44 if L44 has not landed | L44                                                      |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`                 | `exportCapture`, `CaptureMenu` props, editor `capture` branch                                       | Every PCB packet touching the panel; L63 (notice roles)  |
| `apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx` (`CaptureMenu`) | Export groups and PNG size; menu shown in 3D                                                        | L63 if it edits `SHORTCUTS` nearby (different component) |
| `apps/web/src/fork/pcb-preview/SvgViewport.tsx`                     | `exportPng`, `exportSvg`, shared `draw`, background and Safari fixes                                | L52, L60, L69 (overlay children); L63 (name and focus)   |
| `apps/web/src/fork/pcb-preview/preferences.ts`                      | `pngScale` with a decoding default                                                                  | Any packet adding PCB preferences                        |
| `packages/contracts/src/fork/pcb-workspace.ts`                      | `format`, `scale`, `svg`                                                                            | PCB packets adding editor actions                        |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`             | SVG capture write and prune filter                                                                  | PCB packets adding service call sites                    |
| `apps/server/src/fork/pcb-preview/mcp.ts`                           | `loom_pcb_editor` description                                                                       | PCB packets adding editor actions                        |
| `docs/fork/user/pcb-preview.md`                                     | One sentence on copy and save                                                                       | L63 and others adding guide text                         |

## Merge check

Run `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly tag>` before
merging. Expect no conflicts: no upstream file changes.

## FORK.md rows

None.
