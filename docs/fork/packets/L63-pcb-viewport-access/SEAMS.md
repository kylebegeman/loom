# L63 seams

## Extension points created by this packet

None: all existed.

## Packet seams

None. L63 changes no upstream file. It reads, but does not edit, upstream's `SidebarInset`
landmark (`apps/web/src/components/ui/sidebar.tsx:566`) and uses the `sr-only` utility.

## Fork-owned shared files edited

| File                                                                         | Change                                                                                            | Collides with                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`                          | Live region, announcer input, `pin` state, roles, focus moves, `placeText` and `toolHint` helpers | Every PCB packet touching the panel; L52 (finding step line); L62 (notices) |
| `apps/web/src/fork/pcb-preview/SvgViewport.tsx`                              | Role, name, description, `alt=""`, `restoreFocus`, `data-pcb-drawing`                             | L62 (export methods), overlay packets                                       |
| `apps/web/src/fork/pcb-preview/LayerSheet.tsx`                               | `alt=""`                                                                                          | None known                                                                  |
| `apps/web/src/fork/pcb-preview/Board3D.tsx`                                  | `name`, `describe`, `onStatus`, `restoreFocus`                                                    | L61 (3D projection)                                                         |
| `apps/web/src/fork/pcb-preview/Inspector.tsx`                                | Rail labels with counts; inspector `tabIndex` and ref                                             | Packets appending rail tabs (append only)                                   |
| `apps/web/src/fork/pcb-preview/ChecksView.tsx`                               | `onLocate` label argument; silent run status                                                      | L52, L58, L68 (findings)                                                    |
| `apps/web/src/fork/pcb-preview/OperationStatus.tsx`                          | Optional `silent` prop                                                                            | None known                                                                  |
| `apps/web/src/fork/pcb-preview/workspace.module.css`, `inspector.module.css` | 3D focus ring; reduced-motion block                                                               | None known                                                                  |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`                  | `describe` only, and only if L43 has not landed                                                   | L43                                                                         |
| `docs/fork/user/pcb-preview.md`                                              | One sentence                                                                                      | L62 and others adding guide text                                            |

## Merge check

Run `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly tag>` before
merging. Expect no conflicts: no upstream file changes.

## FORK.md rows

None.
