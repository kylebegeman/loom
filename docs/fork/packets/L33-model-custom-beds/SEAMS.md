# L33 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                           | Change                                                                                                                                                                                                                         | Also edited by                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `packages/contracts/src/fork/model-beds.ts`                    | Created by the first of L32, L33, L34 (bed definitions moved here). L33 adds three fields to `BuildPlateSetting`, `CustomBed`, `BuildPlateSettingUpdate` and the edit helpers, and extends `listBeds`/`activeBed`/`selectBed`. | L32, L34, L51                      |
| `packages/contracts/src/fork/model-preview-3d.ts`              | `ModelPreviewSettingsUpdate`; `updateSettings` payload; defaults.                                                                                                                                                              | L34, L40                           |
| `packages/contracts/src/fork/index.ts`                         | One export line, only if L33 creates `model-beds.ts`.                                                                                                                                                                          | Any packet adding a contracts file |
| `apps/web/src/fork/model-preview-3d/buildPlate.ts`             | "Custom size" label; `bedGroups` over named beds.                                                                                                                                                                              | L32, L34, L40                      |
| `apps/web/src/fork/model-preview-3d/BedPicker.tsx`             | Named beds, "Save as bed", "Manage beds".                                                                                                                                                                                      | L34, L40                           |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`        | Printer menu selects by bed id; link label.                                                                                                                                                                                    | L32, L34, L35, L40, L46            |
| `apps/web/src/fork/model-preview-3d/SettingsSection.tsx`       | Custom size block replaced by `ManageBeds`.                                                                                                                                                                                    | L34, L40                           |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts` | `updateSettings` merges the bed setting.                                                                                                                                                                                       | L32, L36, L46                      |
| `apps/server/src/fork/model-preview-3d/mcp.ts`                 | Save tool parameter type and description.                                                                                                                                                                                      | L32, L36, L46                      |

If L33 lands first, the move into `model-beds.ts` goes in its own commit
(`refactor(fork-model-custom-beds): keep bed data in one contracts module`), as L32 SEAMS.md
describes.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
