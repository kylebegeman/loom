# L41 seams

## Extension points created by this packet

L59 created `ext-changed-files` when PCB follow became the second consumer of the card header.
The model chip now registers in `apps/web/src/fork/changedFiles/registry.ts` and receives the
saved route thread from the shared wrapper. There is no packet-specific card seam.
L41 refines `ext-panels` inside its fork-owned files only: an optional `TabIcon` on
`ForkPanelDefinition` (`apps/web/src/fork/panels/types.ts`) used by `ForkSurfaceIcon`
(`apps/web/src/fork/panels/surface.tsx`). No upstream line changes. Add one sentence to the
"Fork-owned files" part of EXTENSION-POINTS.md section 6 in the same commit.

## Packet seams

None. See [ext-changed-files](../EXTENSION-POINTS.md#18-changed-files-card-header-ext-changed-files)
for the two shared card lines and their existence check.

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                           | Change                                                                                                                                                          | Also edited by                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `packages/contracts/src/fork/model-preview-3d.ts`              | `AgentModelsMode`, `agentModels` setting and default, `TurnModel`, `TurnModels`, two methods; `MODEL_EXTENSIONS` and `modelFormatOf` if L50 has not added them. | Every settings packet (L33, L34, L40), L49, L50 |
| `packages/contracts/src/fork/rpc.ts`                           | `turnModelEvents` in `ForkSubscriptionRpcTag`.                                                                                                                  | Any packet adding a stream                      |
| `apps/server/src/fork/rpcAuthorization.ts`                     | Two read-scope rows.                                                                                                                                            | Any packet adding a method (L49)                |
| `packages/client-runtime/src/fork/model-preview-3d.ts`         | Three atoms.                                                                                                                                                    | L49 and packets adding RPCs                     |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts` | Local `formats` map replaced by `modelFormatOf`; `turnModels`, `turnModelEvents`, prefix and parse caches; yields `ThreadManagementService`.                    | Most server packets (L32, L36, L46, L49)        |
| `apps/server/src/fork/model-preview-3d/rpc.ts`                 | Two handlers.                                                                                                                                                   | L49                                             |
| `apps/server/src/fork/model-preview-3d/scadIncludes.ts`        | Created by L41 or L49, whichever lands first.                                                                                                                   | L49                                             |
| `apps/web/src/fork/model-preview-3d/Shortcuts.tsx`             | Renders `AgentModelsHost`; agent-opened tabs get a title.                                                                                                       | None known                                      |
| `apps/web/src/fork/model-preview-3d/ModelPicker.tsx`           | "Changed by the agent" section; rows use `modelSurface`.                                                                                                        | L48 (assemblies may add a picker mode)          |
| `apps/web/src/fork/model-preview-3d/palette.tsx`               | One entry; file entries use `modelSurface`.                                                                                                                     | Packets adding palette entries                  |
| `apps/web/src/fork/model-preview-3d/SettingsSection.tsx`       | One row.                                                                                                                                                        | Every settings packet                           |
| `apps/web/src/fork/model-preview-3d/panel.tsx`                 | `TabIcon`.                                                                                                                                                      | L32 or L34 if they badge the tab                |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`            | Clear the changed mark when the tab becomes visible.                                                                                                            | Most packets (key handler)                      |
| `apps/web/src/fork/panels/types.ts`, `surface.tsx`             | Optional `TabIcon`.                                                                                                                                             | Any panel packet                                |
| `docs/fork/user/model-preview-3d.md`                           | One paragraph.                                                                                                                                                  | Every packet                                    |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0, or a conflict listed only in `ChangedFilesTree.tsx` on the marked lines.

## FORK.md rows

The historical `model-follow-agent` header markers were replaced by `ext-changed-files`.
FORK.md and `docs/fork/seams.tsv` record the shared extension point, with two marker lines.
