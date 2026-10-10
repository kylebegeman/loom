# L40 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Many follow-up packets edit these files. Each L40 change replaces a formatting expression in
place, so a parallel branch that edits the same line resolves by keeping its change and
re-applying `formatLength`.

| File                                                           | Change                                                                         | Also edited by                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------- |
| `packages/contracts/src/fork/model-preview-3d.ts`              | `DisplayUnits`, `displayUnits`, default; with L33, the update field.           | L32, L33, L34                       |
| `apps/web/src/fork/model-preview-3d/units.ts`                  | New; the shared length definition.                                             | Every packet that shows a length    |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`            | Provider, status bar, palette action handler.                                  | Most packets                        |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`        | Part dimensions, fit text, plate diagram, printer menu.                        | L32, L33, L34, L35, L46             |
| `apps/web/src/fork/model-preview-3d/BedPicker.tsx`             | Volumes, custom inputs, Units control.                                         | L33, L34                            |
| `apps/web/src/fork/model-preview-3d/SettingsSection.tsx`       | Provider, Units select, volumes, custom inputs.                                | L33, L34                            |
| `apps/web/src/fork/model-preview-3d/buildPlate.ts`             | `formatVolume` removed.                                                        | L32, L33, L34                       |
| `apps/web/src/fork/model-preview-3d/MarkupSection.tsx`         | Measurement row text and copy.                                                 | L38                                 |
| `apps/web/src/fork/model-preview-3d/ViewsSection.tsx`          | Section offset text.                                                           | L31, L37                            |
| `apps/web/src/fork/model-preview-3d/WorkspaceTools.tsx`        | Section offset `Scrub`.                                                        | L37, L43                            |
| `apps/web/src/fork/model-preview-3d/VariantsInspector.tsx`     | Variant sizes and comparison.                                                  | L42, L49                            |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`    | `setLengthFormat`, label at `:260`.                                            | L31, L36 to L39, L42, L43, L48, L49 |
| `apps/web/src/fork/model-preview-3d/viewer/ViewerCanvas.tsx`   | One effect.                                                                    | L31, L34, L42                       |
| `apps/web/src/fork/model-preview-3d/actions.ts`, `palette.tsx` | `"toggle-units"`.                                                              | L44                                 |
| `apps/server/src/fork/model-preview-3d/mcp.ts`                 | Two description sentences.                                                     | L32, L33, L34, L36, L46             |
| `docs/fork/packets/MODEL-3D-FOLLOW-UPS.md`                     | Length formatting definition lists `trim` and `unit`. Done by the coordinator. | All follow-up packets               |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
