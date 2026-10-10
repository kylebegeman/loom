# L47 seams

## Extension points created by this packet

None: all existed.

## Packet seams

None. Every file this packet touches is fork-owned, so upstream merges cannot conflict with it.
"Open in slicer" on Linux and Windows copies the detached-spawn options from
`apps/server/src/process/externalLauncher.ts:96` into the fork's slicer code instead of
importing the upstream launcher, so no upstream file changes.

## Fork-owned shared files this packet edits

Parallel model packets edit some of the same files. Keep each change additive.

| File                                                           | Change                                                                                                                     | Also edited by               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `packages/contracts/src/fork/model-slicer.ts`                  | New. Created by L51 with only `SlicerApp` if L51 lands first; L47 adds the rest.                                           | L51                          |
| `packages/contracts/src/fork/model-preview-3d.ts`              | Four RPC tags and group entries, `slicer` setting with a decoding default, `slicers` on status, `"slicer-missing"` reason. | Most model packets           |
| `packages/contracts/src/fork/model-editor.ts`                  | `"layers"` action, `layer` field, `layers` state.                                                                          | L32, L35, L36, L37, L38, L41 |
| `packages/contracts/src/fork/clientRpcPermissions.ts`          | Three entries (two operate, one terminal).                                                                                 | L50, L51                     |
| `apps/server/src/fork/rpcAuthorization.ts`                     | Four entries.                                                                                                              | L50, L51                     |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts` | Create the slicer in `make`, spread its methods, report `slicers` in `status`, clear `slices/` in `clearCache`.            | Most model packets           |
| `apps/server/src/fork/model-preview-3d/slicer/profiles.ts`     | New. Shared definition; L51 creates it if it lands first.                                                                  | L51                          |
| `apps/server/src/fork/model-preview-3d/rpc.ts`, `mcp.ts`       | Four handlers, one new tool, the `layers` editor action in the tool description.                                           | L32, L46, L50, L51           |
| `packages/client-runtime/src/fork/model-preview-3d.ts`         | Four atoms, appended.                                                                                                      | L50, L51                     |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`        | Render `PrintSection` inside `PartSection`.                                                                                | L32, L36, L40, L46, L50      |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`            | `Y` key, `layers` editor case, layer slider.                                                                               | Most model packets           |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`    | `setLayers`, `showLayersThrough`.                                                                                          | L31, L34, L36, L37, L42      |
| `apps/web/src/fork/model-preview-3d/actions.ts`, `palette.tsx` | Two actions.                                                                                                               | L31, L35, L41, L43, L44      |
| `apps/web/src/fork/model-preview-3d/VariantsInspector.tsx`     | Estimate on the detail line, "Estimate print times".                                                                       | L32                          |
| `apps/web/src/fork/model-preview-3d/SettingsSection.tsx`       | Render `SlicingSettings`.                                                                                                  | L33, L34, L50, L51           |

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
