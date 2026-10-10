# L51 seams

## Extension points created by this packet

None: all existed.

## Packet seams

None. Every file this packet touches is fork-owned, so upstream merges cannot conflict with it.

## Fork-owned shared files this packet edits

Parallel model packets edit some of the same files. Keep each change additive.

| File                                                                      | Change                                                                                                                                                                                                                                     | Also edited by                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `packages/contracts/src/fork/model-beds.ts`                               | `BUILT_IN_PRINTERS` becomes the preset source; `listBeds`, `activeBed` and `selectBed` take an optional `{ library }`; `Bed` gains `origin`, `bedShape`, `nozzlesMm`. If L33 has not landed, adds `customBedId` exactly as L33 defines it. | L32, L33, L34                      |
| `packages/contracts/src/fork/model-preview-3d.ts`                         | Three RPC tags and group entries, `"conflict"` error reason.                                                                                                                                                                               | Most model packets                 |
| `packages/contracts/src/fork/model-printers.ts`                           | New.                                                                                                                                                                                                                                       | L47 reads `Material` and `Printer` |
| `packages/contracts/src/fork/model-slicer.ts`                             | Created with only `SlicerApp` if L47 has not landed.                                                                                                                                                                                       | L47                                |
| `packages/contracts/src/fork/clientRpcPermissions.ts`                     | One operate entry.                                                                                                                                                                                                                         | L47, L50                           |
| `apps/server/src/fork/rpcAuthorization.ts`                                | Three entries.                                                                                                                                                                                                                             | L47, L50                           |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts`            | Create `makePrinterLibrary` in `make` and spread its methods into the returned object.                                                                                                                                                     | Most model packets                 |
| `apps/server/src/fork/model-preview-3d/store.ts`                          | `getPrinters`, `savePrinters`.                                                                                                                                                                                                             | None known                         |
| `apps/server/src/fork/model-preview-3d/rpc.ts`, `mcp.ts`                  | Three handlers and three tools, appended.                                                                                                                                                                                                  | L32, L46, L47, L50                 |
| `apps/server/src/fork/model-preview-3d/slicer/profiles.ts`                | Created here if L47 has not landed (shared definition in L47 TECHNICAL.md).                                                                                                                                                                | L47                                |
| `packages/client-runtime/src/fork/model-preview-3d.ts`                    | Three atoms, appended.                                                                                                                                                                                                                     | L47, L50                           |
| `apps/web/src/fork/model-preview-3d/buildPlate.ts`                        | Optional `library` argument on the wrappers; `Plate.shape`.                                                                                                                                                                                | L32, L33, L34                      |
| `apps/web/src/fork/model-preview-3d/viewer/bed.ts`                        | Optional `shape` argument for round beds.                                                                                                                                                                                                  | L34 (zones draw over the plate)    |
| `apps/web/src/fork/model-preview-3d/BedPicker.tsx`                        | Pass the library; "Manage printers" item appended.                                                                                                                                                                                         | L32, L33, L34                      |
| `apps/web/src/fork/model-preview-3d/SettingsSection.tsx`                  | Render `PrintersSection` and `MaterialsSection`; replaces the custom size block or L33's `ManageBeds`.                                                                                                                                     | L33, L34, L47, L50                 |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`, `ModelPanel.tsx` | Pass the library to the bed helpers.                                                                                                                                                                                                       | Most model packets                 |

## Merge check

Run before review:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. Record the tag and result here when the packet is built.

## FORK.md rows

None. No upstream file is touched.
