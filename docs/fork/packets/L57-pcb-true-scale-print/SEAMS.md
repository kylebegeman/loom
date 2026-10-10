# L57 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                    | Change                                                                                                                                                        | Also edited by               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `packages/contracts/src/fork/pcb-preview.ts`            | `print` in `PCB_PREVIEW_WS_METHODS` and the RPC group.                                                                                                        | Most PCB packets             |
| `packages/contracts/src/fork/pcb-workspace.ts`          | `PcbPrintSide`, `PcbPrintPaper`, `PcbPrintInput`, `PcbPrintResult`.                                                                                           | Most PCB packets             |
| `packages/contracts/src/fork/clientRpcPermissions.ts`   | `print` as `AuthTerminalOperateScope`.                                                                                                                        | L64, L65, others adding RPCs |
| `apps/server/src/fork/rpcAuthorization.ts`              | `print` as `AuthTerminalOperateScope`.                                                                                                                        | L64, L65, others adding RPCs |
| `apps/server/src/fork/pcb-preview/cache.ts`             | `SIGNED_FILE_TYPES`, created by the first of L57 and L65.                                                                                                     | L65                          |
| `apps/server/src/fork/pcb-preview/http.ts`              | Content type by basename.                                                                                                                                     | L65                          |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts` | `signBoard` becomes `signCacheFile`; `resolveSignedRequest` uses the table; `fab` added to the `sourceSnapshot` exclusions; `print` call site and `of` entry. | Most PCB packets             |
| `apps/server/src/fork/pcb-preview/printPdf.ts`          | New.                                                                                                                                                          | None                         |
| `apps/server/src/fork/pcb-preview/mcp.ts`               | `loom_pcb_print`.                                                                                                                                             | Most PCB packets             |
| `apps/server/src/fork/pcb-preview/rpc.ts`               | One handler line.                                                                                                                                             | Most PCB packets             |
| `packages/client-runtime/src/fork/pcb-preview.ts`       | `print` command.                                                                                                                                              | L64, L65                     |
| `apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx`     | "Print at 1:1…" menu item.                                                                                                                                    | L65                          |
| `apps/web/src/fork/pcb-preview/PrintDialog.tsx`         | New.                                                                                                                                                          | None                         |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`     | Dialog open state and menu handler.                                                                                                                           | Most PCB packets             |

The signed-file table and the `fab` exclusion are shared with L65. If L65 landed first, check
`cache.ts` for `SIGNED_FILE_TYPES` and add only the `print.pdf` row.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
