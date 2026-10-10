# L41 seams

## Extension points created by this packet

None. The changed files card slot has one consumer, so by the rule in
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md#shared-points-considered-and-declined) it stays a
packet seam. Promote it to a registry (like `apps/web/src/fork/diffHeader/registry.ts`) when a
second packet wants a turn action. L59 wants one and specifies that registry,
`ext-changed-files`, pending Kyle's decision; once approved, use it and skip the seam below.

L41 refines `ext-panels` inside its fork-owned files only: an optional `TabIcon` on
`ForkPanelDefinition` (`apps/web/src/fork/panels/types.ts`) used by `ForkSurfaceIcon`
(`apps/web/src/fork/panels/surface.tsx`). No upstream line changes. Add one sentence to the
"Fork-owned files" part of EXTENSION-POINTS.md section 6 in the same commit.

## Packet seams

| File                                                | Marker                     | Lines | Why                                                                                                                                                                                                                                         |
| --------------------------------------------------- | -------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/chat/ChangedFilesTree.tsx` | `fork: model-follow-agent` | 2     | Import `ModelTurnChip` after the last import (`:17`), and render `<ModelTurnChip runId={runId} files={files} />` as the first child of the header action group (`:67`). Only this card knows a turn's run id and file list in the timeline. |

```diff
 import { MorphIcon } from "~/components/MorphIcon";
+import { ModelTurnChip } from "~/fork/model-preview-3d/ModelTurnChip"; // fork: model-follow-agent
```

```diff
         <div className="flex shrink-0 items-center gap-1">
+          <ModelTurnChip runId={runId} files={files} /> {/* fork: model-follow-agent */}
           {hasDirectories && (
```

Run `vp fmt` on the file afterwards. If the formatter splits the JSX line, put the marker on its
own line directly above the element instead (CONVENTIONS.md, "Seams"). The component renders
null against servers without the `model-preview-3d` feature, so upstream behavior is unchanged
there.

The file is busy upstream (19 commits since July), but the two lines sit at the top of the
import list and at the start of a flex group; conflicts, if any, will be on the marked lines.

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

Add a paragraph under "Packet seams":

```md
L41 renders the 3D model turn chip at the start of the changed files card's header actions in
`apps/web/src/components/chat/ChangedFilesTree.tsx` (`fork: model-follow-agent`, 2 marker
lines). The chip renders nothing without Loom's 3D feature. See the
[L41 packet](docs/fork/packets/L41-model-follow-agent/SEAMS.md).
```

Add to `docs/fork/seams.tsv`:

```
apps/web/src/components/chat/ChangedFilesTree.tsx	model-follow-agent	2
```
