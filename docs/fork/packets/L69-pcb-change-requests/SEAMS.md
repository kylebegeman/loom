# L69 seams

## Upstream files touched

None.

The server imports upstream `CheckpointStore` (`apps/server/src/checkpointing/CheckpointStore.ts`)
and calls `isGitRepository`, `captureCheckpoint` and `deleteCheckpointRefs`. It does not edit that
file or `apps/server/src/server.ts`; the service is already composed above the layer that provides
`CheckpointStore` (`server.ts:499-502`, `:580-582`). If an upstream integration renames those
methods, only `apps/server/src/fork/pcb-preview/changeRequests.ts` changes.

## Fork-owned shared files edited

| File                                                         | Change                                                                                                       | Also edited by                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `packages/contracts/src/fork/pcb-workspace.ts`               | New request schemas; `requests` on `PcbWorkspace`; `requestId` on `PcbEditorAction`                          | PCB packets that add saved fields              |
| `packages/contracts/src/fork/pcb-preview.ts`                 | `changeRequest` method and RPC                                                                               | PCB packets with RPCs                          |
| `packages/contracts/src/fork/clientRpcPermissions.ts`        | One scope row                                                                                                | Every fork RPC                                 |
| `packages/client-runtime/src/fork/pcb-preview.ts`            | One command                                                                                                  | PCB packets with RPCs                          |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`      | `CheckpointStore` yield, `makeChangeRequests` call, `requests` kept in `updateWorkspace`, two public methods | PCB packets with server work (call sites only) |
| `apps/server/src/fork/pcb-preview/rpc.ts`                    | One handler                                                                                                  | PCB packets with RPCs                          |
| `apps/server/src/fork/pcb-preview/mcp.ts`                    | Two tools, one description line                                                                              | All PCB agent tools                            |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` | Provide a fake `CheckpointStore` in `create`                                                                 | All PCB service tests                          |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`          | `R` key line, tool entry, badge, `RequestPins` beside two `DrawingOverlays`, editor `requestId`              | Packets with keys or overlays (L52, L60, L66)  |
| `apps/web/src/fork/pcb-preview/Inspector.tsx`                | Append the Requests tab                                                                                      | Packets that append tabs                       |
| `apps/web/src/fork/pcb-preview/SvgViewport.tsx`              | Optional `onBox` drag mode                                                                                   | L52, L60                                       |
| `apps/web/src/fork/pcb-preview/MarksTab.tsx`                 | Request tool entry; "Turn into change request"                                                               | L54 (units)                                    |
| `apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx`          | One `SHORTCUTS` row                                                                                          | Every packet with a key                        |
| `apps/web/src/fork/pcb-preview/usePcbWorkbench.ts`           | `changeRequest`; `requests: []` in `mutate`                                                                  | PCB packets that save state                    |
| `apps/web/src/fork/pcb-preview/palette.tsx`                  | One palette action                                                                                           | PCB packets with actions                       |
| `apps/web/src/fork/model-preview-3d/viewer/captureSheet.ts`  | Optional `limit` argument on `thumbnail`                                                                     | L23, L70                                       |

Keep each edit additive: append to lists, add one `else if` line, add a prop with a default. The
`updateWorkspace` change is the only change to existing behavior; keep it to the single
`requests: current.requests` line and the unique-id list entry so other packets' edits to that
method merge cleanly.
