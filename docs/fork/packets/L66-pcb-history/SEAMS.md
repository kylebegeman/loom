# L66 seams

## Extension points created by this packet

None.

## Packet seams

None. L66 changes no upstream file. It reads upstream code through existing exports:

| Upstream code                                                                                    | Used for                                    | Why it is not a seam                                                                                              |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ProjectionStoreV2.getThreadRecords` (`apps/server/src/orchestration-v2/ProjectionStore.ts:364`) | Checkpoints, scopes and runs of the thread. | The PCB service already yields `ProjectionStoreV2` (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:199`). |
| `isTerminalRunStatus` (`apps/server/src/orchestration-v2/ThreadManagementService.ts:399`)        | `threadRunning`.                            | An exported pure function.                                                                                        |
| Checkpoint refs in Git                                                                           | Version content.                            | Read-only Git plumbing with a private index file; refs are never written.                                         |
| `useThreadProjection` (`apps/web/src/state/entities.ts:126`)                                     | Refetch when a turn's checkpoint lands.     | Already imported by fork code (`apps/web/src/fork/thread-inspector/useInspectorInputs.ts`).                       |
| `components/ui` `Button`, `Dialog`, tooltip                                                      | Strip and dialog.                           | Existing variants only.                                                                                           |

If upstream renames any of these, the merge fails to typecheck rather than conflict, and the fix
lives in fork files.

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                               | Change                                                                                                                                                                                    | Also edited by                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/server/src/fork/model-preview-3d/history.ts`                 | Created by L49 or L66, whichever lands first; L66 widens `UndoManifest.entries[].restoredOid` to nullable.                                                                                | L49                                                     |
| `apps/server/src/fork/model-preview-3d/historyGit.ts`              | Created by L49 or L66; L66 adds the `recursive` option to `lsTree`.                                                                                                                       | L49, L41 (`repoPrefix`)                                 |
| `apps/server/src/fork/model-preview-3d/historyRestore.ts`          | New shared restore and undo; with L49 landed, L49's inline code moves here unchanged.                                                                                                     | L49                                                     |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts`     | Only when L49 has landed: restore and undo call `historyRestore.ts`.                                                                                                                      | Most 3D packets                                         |
| `packages/contracts/src/fork/pcb-workspace.ts`                     | History schemas; `checkpointId` on `PcbAssetInput`; two editor actions; optional `turnHistory` state.                                                                                     | L52, L58, L60, L61, L62, L69 (editor actions and state) |
| `packages/contracts/src/fork/pcb-preview.ts`                       | Three methods and RPCs; `checkpointId` on `PcbRenderInput`; `"version-not-found"` reason.                                                                                                 | Every PCB packet adding a method                        |
| `packages/contracts/src/fork/clientRpcPermissions.ts`              | Two operate rows.                                                                                                                                                                         | Any packet adding a guarded write                       |
| `apps/server/src/fork/rpcAuthorization.ts`                         | Three rows.                                                                                                                                                                               | Any packet adding a method                              |
| `packages/client-runtime/src/fork/pcb-preview.ts`                  | Three commands.                                                                                                                                                                           | Packets adding RPCs                                     |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`            | Call sites: history wiring, `checkpointId` in `render` and `asset`, `runRender` and `runAsset` frozen option, `assetFor`, `revisions` delegation, `sourceSnapshot` uses `designFiles.ts`. | Most PCB server packets                                 |
| `apps/server/src/fork/pcb-preview/rpc.ts`, `mcp.ts`, `mcp.test.ts` | Handlers, two tools, render and asset option, descriptions.                                                                                                                               | Most PCB packets                                        |
| `apps/web/src/fork/pcb-preview/usePcbPreview.ts`, `Board3D.tsx`    | Optional `checkpointId`.                                                                                                                                                                  | L60 (reload diff), L61 (3D tools)                       |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`                | Strip, viewing state, read-only gating, keys `T` `[` `]`, toolbar button, status label, editor actions.                                                                                   | Every PCB UI packet (key handler, status bar)           |
| `apps/web/src/fork/pcb-preview/RevisionCompare.tsx`                | Optional `initial` prop.                                                                                                                                                                  | None known                                              |
| `apps/web/src/fork/pcb-preview/Inspector.tsx`                      | Read-only notice for Inspect, Checks, Simulate, Parameters while viewing.                                                                                                                 | L52, L53, L68 (new tabs)                                |
| `apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx`                | Two `SHORTCUTS` rows.                                                                                                                                                                     | Every packet adding a key                               |
| `apps/web/src/fork/pcb-preview/palette.tsx`, `actions.ts`          | Three entries and actions; `actions.ts` created if absent.                                                                                                                                | L62, L63                                                |
| `docs/fork/user/pcb-preview.md`                                    | One section.                                                                                                                                                                              | Every PCB packet                                        |

Keys `T`, `[` and `]` are already allocated to L66 in
[PCB-FOLLOW-UPS.md](../PCB-FOLLOW-UPS.md).

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0 with no L66 files listed. Then typecheck the server and web packages
(TESTING.md) against the merged tree, since L66 depends on upstream exports by name.

## FORK.md rows

None. No packet seam, so no `docs/fork/seams.tsv` row.
