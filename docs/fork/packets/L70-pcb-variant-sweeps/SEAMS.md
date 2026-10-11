# L70 seams

## Upstream files touched

None. Code, contracts, tests and documentation stay in fork-owned paths. Candidate exports use
L24's existing process runner. No seam manifest or FORK.md change is needed.

## Fork-owned shared files edited

| File                                                    | Change                                                              | Shared with           |
| ------------------------------------------------------- | ------------------------------------------------------------------- | --------------------- |
| `packages/contracts/src/fork/pcb-workspace.ts`          | Variant defaults/stats, shared limits, proposals and editor action  | PCB workspace packets |
| `packages/contracts/src/fork/pcb-preview.ts`            | Candidate render/cancel methods and contracts                       | PCB RPC packets       |
| `packages/contracts/src/fork/clientRpcPermissions.ts`   | Protected terminal scope rows                                       | Fork RPCs             |
| `packages/client-runtime/src/fork/pcb-preview.ts`       | Candidate render/cancel commands                                    | PCB RPC packets       |
| `apps/server/src/fork/rpcAuthorization.ts`              | Server terminal scope rows                                          | Fork RPCs             |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts` | Shared cache commit helper, candidate rendering and agent proposals | PCB service packets   |
| `apps/server/src/fork/pcb-preview/rpc.ts`               | Two service handlers                                                | PCB RPC packets       |
| `apps/server/src/fork/pcb-preview/mcp.ts`               | Proposal tool and editor rendering description                      | PCB agent tools       |
| `apps/web/src/fork/pcb-preview/ParameterEditor.tsx`     | Workbench, review promotion and retained review hash                | Parameter authoring   |
| `apps/web/src/fork/pcb-preview/Inspector.tsx`           | Workbench inputs and stable batch write authorization               | Inspector packets     |
| `apps/web/src/fork/pcb-preview/RevisionCompare.tsx`     | Optional comparison image labels                                    | Revision comparison   |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`     | Queued sweep/render actions and authorization                       | PCB panel packets     |
| `apps/web/src/fork/pcb-preview/actions.ts`              | Scoped sweep action                                                 | PCB palette/actions   |
| `apps/web/src/fork/pcb-preview/palette.tsx`             | Sweep entry                                                         | PCB palette           |

`commitRender` was extracted in its own refactor commit before candidate behavior was added.
L69 already supplied the shared `thumbnail` limit in `captureSheet.ts`; L70 reuses it without an
edit. L55's pure stats function is likewise reused unchanged.
