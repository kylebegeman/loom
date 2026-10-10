# L67 seams

## Upstream files touched

None. Every file is fork-owned: L24's PCB directories, L23's model directories, the fork
contracts and the L46 and L48 files under `apps/server/src/fork/model-preview-3d/`.

## Fork-owned shared files edited

| File                                                                      | Change                                                                                                                                                               | Also edited by                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `apps/server/src/fork/features.ts`                                        | Append `"pcb-enclosure-fit"` to `LOOM_SERVER_FEATURES`.                                                                                                              | Every packet with a slug                 |
| `packages/contracts/src/fork/index.ts`                                    | `export * from "./pcb-enclosure.ts";`                                                                                                                                | Packets adding contract files            |
| `packages/contracts/src/fork/pcb-preview.ts`                              | `enclosure` method tag and RPC.                                                                                                                                      | Most PCB packets                         |
| `packages/contracts/src/fork/pcb-workspace.ts`                            | Hole `plated` and `footprint` with defaults; `relativePath` on `PcbReferenceResult`; enclosure input and result.                                                     | Most PCB packets                         |
| `packages/contracts/src/fork/clientRpcPermissions.ts`                     | `[P.enclosure]` scope.                                                                                                                                               | Packets adding RPCs                      |
| `packages/client-runtime/src/fork/pcb-preview.ts`                         | `enclosure` command.                                                                                                                                                 | Packets adding RPCs                      |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`                   | Call sites only: `referenceData` in `exportReference`, `makeEnclosure` wiring, the service entry, the `.loom-assembly.json` skip in the tscircuit scan (`:557-561`). | Most PCB packets (new work in new files) |
| `apps/server/src/fork/pcb-preview/semantics.ts`                           | Plated mounting holes and hole footprint (`:145-158`, `:426-440`).                                                                                                   | L55 (reads holes), L64                   |
| `apps/server/src/fork/pcb-preview/glb.ts`                                 | `readGlbJson`; `readGlbBounds` or its `nodes` and `materials` fields.                                                                                                | L55                                      |
| `apps/server/src/fork/pcb-preview/outline.ts`                             | New, or reused if L55 created it.                                                                                                                                    | L55                                      |
| `apps/server/src/fork/pcb-preview/mcp.ts`                                 | `loom_pcb_enclosure` tool and handler; `relativePath` in the export reference description.                                                                           | Packets adding tools                     |
| `apps/server/src/fork/pcb-preview/rpc.ts`                                 | `[M.enclosure]` handler.                                                                                                                                             | Packets adding RPCs                      |
| `apps/web/src/fork/pcb-preview/Inspector.tsx`                             | Append `"Enclosure"` to `INSPECTOR_TABS`, `TAB_META`, `NEEDS_EXECUTION`, `inspectorTabs`, one `case`. Append only.                                                   | L69 ("Requests"), others adding tabs     |
| `packages/contracts/src/fork/model-assembly.ts` (L48)                     | Phase B: `enclosure` field, versions 2, four operations, report field.                                                                                               | L48                                      |
| `apps/server/src/fork/model-preview-3d/assemblyOps.ts` (L48)              | Phase B: four operations.                                                                                                                                            | L48                                      |
| `apps/server/src/fork/model-preview-3d/assembly.ts` (L48)                 | Phase B: features, key, report.                                                                                                                                      | L48                                      |
| `apps/server/src/fork/model-preview-3d/check/protocol.ts` (L46, L48)      | Phase B: `AssemblyRequest.enclosure`.                                                                                                                                | L46, L48                                 |
| `apps/server/src/fork/model-preview-3d/check/model-check-worker.ts` (L46) | Phase B: call `checkEnclosure` after the pairs.                                                                                                                      | L46, L48                                 |
| `apps/server/src/fork/model-preview-3d/check/grid.ts` (L46)               | Phase B: `nearestHit` if missing.                                                                                                                                    | L46, L48                                 |
| `apps/web/src/fork/model-preview-3d/AssemblyFitSection.tsx` (L48)         | Phase B: render `EnclosureFitSection`.                                                                                                                               | L48                                      |

No keyboard key, so `PcbPreviewPanel.tsx`'s key handler and the shortcut list are untouched.

## Merge risk

The PCB contract files and the inspector rail are the busiest shared files among the PCB
follow-ups; L67's edits there are appends. The phase B edits land inside L48's files, so build
phase B after L48 has merged rather than in parallel with it.
