# L48 seams

## Extension points created by this packet

None. The service, RPC group, MCP toolkit, panel and command palette registry are L23's and the
fork's existing extension points (`ext-core`, `ext-mcp`, `ext-panels`).

## Packet seams

None of its own when L46 has landed. The fit check and `align` bounds run in L46's worker, which
is bundled through L46's single seam in `apps/server/vite.config.ts` (`fork: model-print-check`,
[L46 SEAMS.md](../L46-model-print-check/SEAMS.md)). L48 adds new modules beside that worker
(`check/interfere.ts`, `check/distance.ts`) that the worker entry imports, so the bundled entry
picks them up without touching the pack configuration.

If L48 is built before L46, it brings L46's readers, grid, worker host and that seam exactly as
L46 writes them, in their own commits, with L46's marker and FORK.md paragraph. No second seam
or marker is introduced.

## Fork-owned shared files edited

Keep each change additive; other follow-up packets edit the same files.

| File                                                                               | Change                                                                                           | Also edited by                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `packages/contracts/src/fork/model-assembly.ts`                                    | New.                                                                                             | None                                       |
| `packages/contracts/src/fork/index.ts`                                             | One export line.                                                                                 | Any packet adding a contracts file         |
| `packages/contracts/src/fork/model-preview-3d.ts`                                  | Three methods, three RPCs, `assemblies` on `listModels`, `conflict` reason.                      | L32, L33, L36, L40, L46, L51               |
| `packages/contracts/src/fork/model-editor.ts`                                      | Three actions, `explode` field, `assembly` state.                                                | L31, L36, L42, L46                         |
| `packages/contracts/src/fork/clientRpcPermissions.ts`                              | Two rows.                                                                                        | Any packet adding a guarded method         |
| `apps/server/src/fork/rpcAuthorization.ts`                                         | Three rows.                                                                                      | Any packet adding a method                 |
| `apps/server/src/fork/features.ts`                                                 | `"model-assemblies"`.                                                                            | Every packet with client-visible behaviour |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts`                     | `makeAssemblies(...)` spread into the service; `listModels` lists assemblies and PCB references. | L32, L35, L36, L46, L51                    |
| `apps/server/src/fork/model-preview-3d/check/protocol.ts`, `model-check-worker.ts` | Two request kinds and the dispatch.                                                              | L46 (owner)                                |
| `apps/server/src/fork/model-preview-3d/rpc.ts`, `mcp.ts`                           | Three handlers; two tools.                                                                       | L32, L35, L36, L46, L51                    |
| `packages/client-runtime/src/fork/model-preview-3d.ts`                             | Three commands.                                                                                  | L46, L51                                   |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`                        | `refreshModel`, `objectAt`.                                                                      | Most viewer packets (added methods only)   |
| `apps/web/src/fork/model-preview-3d/viewer/ViewerCanvas.tsx`                       | `source` prop replaces `url` and `format`.                                                       | L42, L49 (ghost loads use their own path)  |
| `apps/web/src/fork/model-preview-3d/viewer/printCheck.ts`                          | `setPins` generalizes `setFindings`.                                                             | L46 (owner)                                |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`                                | Kind routing in `ModelFile`, `useAssembly`, `E`, Escape order, editor actions.                   | Most packets                               |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`                            | Tab kinds; Parts and Fit tabs.                                                                   | L32, L34, L35, L40, L46                    |
| `apps/web/src/fork/model-preview-3d/ModelPicker.tsx`                               | Assemblies filter, "New assembly".                                                               | None known                                 |
| `apps/web/src/fork/model-preview-3d/WorkspaceTools.tsx`                            | `E` in `HELP`.                                                                                   | Every packet adding a key                  |
| `apps/web/src/fork/commandPalette/registry.ts`                                     | Assembly paths in the model list.                                                                | None known                                 |
| `docs/fork/user/model-preview-3d.md`                                               | "Assemblies" section.                                                                            | Every 3D packet                            |

The `ModelInspector` tab change from a `scad` flag to `kinds` touches every caller of
`inspectorTabs`, `defaultInspectorTab` and `resolveInspectorTab`. It is mechanical; do it in its
own commit so a parallel packet adding a tab rebases easily.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. Every file this packet changes is under `fork/` or is a new fork file,
except the user guide in `docs/fork/`. `scripts/fork/loom.sh check` passes with no new rows in
`docs/fork/seams.tsv`.

## FORK.md rows

None. L48 adds no seam. If it carries L46's seam because L46 has not landed, it also adds L46's
FORK.md paragraph and `seams.tsv` row exactly as L46's SEAMS.md writes them.
