# L54 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Each change replaces a formatting expression in place or adds one small block. A parallel
branch that edits the same line resolves by keeping its change and applying `formatLength`.

| File                                                                        | Change                                            | Also edited by                      |
| --------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------- |
| `apps/web/src/fork/pcb-preview/length.ts`                                   | New; the PCB length definition.                   | L52, L55, L57, L64, L65, L70 (read) |
| `apps/web/src/fork/pcb-preview/preferences.ts`                              | Decoding defaults for every field; `lengthUnit`.  | L56 (`hiddenLayerPresets`)          |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`                         | Status bar units menu; `unit` prop to `Overlays`. | Most PCB packets                    |
| `apps/web/src/fork/pcb-preview/InspectTab.tsx`                              | Board size and thickness formatting.              | L53, L55                            |
| `apps/web/src/fork/pcb-preview/geometry.ts`, `Overlays.tsx`, `MarksTab.tsx` | Unit parameter for mark text.                     | L52, L60, L69 (`Overlays.tsx`)      |
| `apps/web/src/fork/pcb-preview/ChecksView.tsx`, `summary.ts`                | Coordinates via `toMm`; Locate in any unit.       | L52, L58                            |
| `apps/web/src/fork/pcb-preview/HardwareLibrary.tsx`                         | Size text and unit-aware inputs.                  | L70                                 |
| `apps/web/src/fork/pcb-preview/settings.tsx`                                | "Length units" row.                               | L58, L64                            |
| `apps/server/src/fork/pcb-preview/kicadReports.ts`                          | Positions normalized to mm, ERC scale fix.        | L52, L58                            |
| `apps/server/src/fork/pcb-preview/mcp.ts`                                   | Description sentences.                            | Most PCB packets                    |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
