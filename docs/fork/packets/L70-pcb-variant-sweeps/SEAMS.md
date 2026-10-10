# L70 seams

## Upstream files touched

None. The packet stays inside fork directories and fork contract files. `tsci` runs through L24's
existing process runner; no upstream service is imported.

## Fork-owned shared files edited

| File                                                        | Change                                                                                                    | Also edited by                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `packages/contracts/src/fork/pcb-workspace.ts`              | `PcbVariantStats`; six defaulted fields on `PcbVariant`; `render-variants` and `ids` on `PcbEditorAction` | PCB packets that add saved fields              |
| `packages/contracts/src/fork/pcb-preview.ts`                | `renderVariant` and `cancelVariant` methods, inputs and RPCs                                              | PCB packets with RPCs                          |
| `packages/contracts/src/fork/clientRpcPermissions.ts`       | Two scope rows                                                                                            | Every fork RPC                                 |
| `packages/client-runtime/src/fork/pcb-preview.ts`           | Two commands                                                                                              | PCB packets with RPCs                          |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`     | Extract `commitRender` from `runRender`; `makeVariantBuilds` call; three public methods                   | PCB packets with server work (call sites only) |
| `apps/server/src/fork/pcb-preview/rpc.ts`                   | Two handlers                                                                                              | PCB packets with RPCs                          |
| `apps/server/src/fork/pcb-preview/mcp.ts`                   | `loom_pcb_propose_variants`; `render-variants` in the editor tool description                             | All PCB agent tools                            |
| `apps/web/src/fork/pcb-preview/ParameterEditor.tsx`         | Replace the Variants section (`:149-213`) with `VariantWorkbench`; `onUse`                                | L55 if it shows stats there                    |
| `apps/web/src/fork/pcb-preview/RevisionCompare.tsx`         | Export `ComparisonImages`; optional alt labels                                                            | L69 (reads it, no edit)                        |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`         | One `render-variants` case in the editor switch                                                           | Packets with editor actions (L69, L62)         |
| `apps/web/src/fork/pcb-preview/palette.tsx`                 | One palette action                                                                                        | PCB packets with actions                       |
| `apps/web/src/fork/model-preview-3d/viewer/captureSheet.ts` | Optional `limit` argument on `thumbnail`                                                                  | L23, L69                                       |

Keep each edit additive. The `commitRender` extraction is the one move of existing code: do it in
its own step with no behavior change, so a packet editing `runRender` at the same time conflicts
on a small, obvious block. The `thumbnail` change is shared with L69; whichever packet lands
second finds it done and skips that edit.
