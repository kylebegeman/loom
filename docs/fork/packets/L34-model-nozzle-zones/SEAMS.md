# L34 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                         | Change                                                                                                                                                                                                           | Also edited by                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `packages/contracts/src/fork/model-beds.ts`                  | Created by the first of L32, L33, L34. L34 adds `BedZone`, zone data on two presets, corrected notes, `sharedZone`, `singleZoneStrips`, `ZoneFit`, `fitBed`, `showZones`, and the summary row `zone` (with L32). | L32, L33, L51                       |
| `packages/contracts/src/fork/model-preview-3d.ts`            | `showZones: true` in the defaults.                                                                                                                                                                               | L33, L40                            |
| `packages/contracts/src/fork/index.ts`                       | One export line, only if L34 creates `model-beds.ts`.                                                                                                                                                            | Any packet adding a contracts file  |
| `apps/web/src/fork/model-preview-3d/buildPlate.ts`           | `Plate.zones`, `Plate.showZones`, `fitPlate`, `describeZoneFit`.                                                                                                                                                 | L32, L33, L40                       |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`  | Optional `strips` on `setBed`, about ten lines.                                                                                                                                                                  | L31, L36 to L39, L42, L43, L48, L49 |
| `apps/web/src/fork/model-preview-3d/viewer/ViewerCanvas.tsx` | Pass strips to `setBed`.                                                                                                                                                                                         | L31, L42                            |
| `apps/web/src/fork/model-preview-3d/BedPicker.tsx`           | Switch and legend.                                                                                                                                                                                               | L33, L40                            |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`      | `PlateFit` strips; zone text on the fit card.                                                                                                                                                                    | L32, L33, L35, L40, L46             |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`          | Status bar fit check (one line).                                                                                                                                                                                 | Most packets                        |
| `apps/web/src/fork/model-preview-3d/SettingsSection.tsx`     | Switch.                                                                                                                                                                                                          | L33, L40                            |
| `apps/web/src/fork/model-preview-3d/workspace.module.css`    | `.model-zone-swatch`.                                                                                                                                                                                            | Most UI packets                     |
| `apps/server/src/fork/model-preview-3d/mcp.ts`               | Render tool description sentence (with L32).                                                                                                                                                                     | L32, L36, L46                       |
| `docs/fork/packets/MODEL-3D-FOLLOW-UPS.md`                   | Zone shape lists optional `heightMm`. Done by the coordinator before this packet starts.                                                                                                                         | All follow-up packets               |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
