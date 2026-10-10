# L49 seams

## Extension points created by this packet

None.

## Packet seams

None. L49 changes no upstream file. It reads upstream code through existing exports:

| Upstream code                                                                                    | Used for                                        | Why it is not a seam                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ProjectionStoreV2.getThreadRecords` (`apps/server/src/orchestration-v2/ProjectionStore.ts:364`) | Checkpoints, scopes and runs of the thread.     | The fork service already yields `ProjectionStoreV2` (`apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:107`). |
| `isTerminalRunStatus` (`apps/server/src/orchestration-v2/ThreadManagementService.ts:399`)        | `threadRunning`.                                | An exported pure function; importing it changes nothing upstream.                                                         |
| Checkpoint refs in Git                                                                           | Version content.                                | Read-only Git plumbing with a private index file; refs are never written.                                                 |
| `useThreadProjection` (`apps/web/src/state/entities.ts:126`)                                     | Refetch trigger when a turn's checkpoint lands. | Already imported by fork code (`apps/web/src/fork/thread-inspector/useInspectorInputs.ts:33`).                            |
| `components/ui` `Button`, `Dialog`, tooltip                                                      | Strip and dialog.                               | Used with existing variants only.                                                                                         |

If upstream renames any of these, the merge fails to typecheck rather than conflict, and the fix
lives in fork files.

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                                           | Change                                                                                                                                                   | Also edited by                                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `packages/contracts/src/fork/model-preview-3d.ts`                              | `"conflict"` error reason; history schemas; five methods and RPCs.                                                                                       | L41 and every settings packet (L33, L34, L40) |
| `packages/contracts/src/fork/model-workspace.ts`                               | `resolvedIn` on `ModelAnnotation` with a decoding default.                                                                                               | Any packet that adds a workspace field        |
| `packages/contracts/src/fork/model-editor.ts`                                  | `turn-history`, `turn-compare`; optional `turnHistory` state.                                                                                            | L42 (`previous`), most viewer packets         |
| `packages/contracts/src/fork/clientRpcPermissions.ts`                          | Four operate rows.                                                                                                                                       | Any packet adding a guarded write             |
| `apps/server/src/fork/rpcAuthorization.ts`                                     | Five rows.                                                                                                                                               | L41 and any packet adding a method            |
| `packages/client-runtime/src/fork/model-preview-3d.ts`                         | Five commands.                                                                                                                                           | L41 and packets adding RPCs                   |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts`                 | History methods, `runRender` snapshot mode, `renderImages` checkpoint and timeout fix, `resolvedIn` in `updateWorkspaceMany`, `clearCache` covers trees. | Most server packets (L32, L36, L41, L46)      |
| `apps/server/src/fork/model-preview-3d/rpc.ts`                                 | Five handlers.                                                                                                                                           | L41                                           |
| `apps/server/src/fork/model-preview-3d/mcp.ts`, `mcp.test.ts`                  | Two tools, render option, editor description.                                                                                                            | L42, L44, L46, L47                            |
| `apps/server/src/fork/model-preview-3d/scadIncludes.ts`, `formats.ts`          | Created by L41 or L49, whichever lands first.                                                                                                            | L41, L50 (`formats.ts`)                       |
| `apps/web/src/fork/model-preview-3d/viewer/ghost.ts`, `viewer/createViewer.ts` | `ghost.ts` if L42 has not created it; `setCompareModel`.                                                                                                 | L42, L35, L37, L38                            |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`                            | Strip, viewing state, keys `T` `[` `]`, toolbar button, status bar label.                                                                                | Most packets (key handler, status bar)        |
| `apps/web/src/fork/model-preview-3d/MarkupSection.tsx`                         | "Accepted in turn N" and "View turn N".                                                                                                                  | L38 if it touches markup                      |
| `apps/web/src/fork/model-preview-3d/useModelEditing.ts`                        | `resolvedIn: null` where annotations are created (`:68`, `:157`).                                                                                        | Markup packets                                |
| `apps/web/src/fork/model-preview-3d/actions.ts`, `palette.tsx`                 | Three actions and palette entries.                                                                                                                       | L41, L42, L44                                 |
| `docs/fork/user/model-preview-3d.md`                                           | One section.                                                                                                                                             | Every packet                                  |

Keys `T`, `[` and `]` are already allocated to L49 in
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md).

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0 with no L49 files listed. Then typecheck the server and web packages
(TESTING.md) against the merged tree, since L49 depends on upstream exports by name.

## FORK.md rows

None. No packet seam, so no `docs/fork/seams.tsv` row.
