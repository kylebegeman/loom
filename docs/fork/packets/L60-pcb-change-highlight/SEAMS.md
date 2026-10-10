# L60 seams

## Extension points used

- `ext-panels` (L24): the PCB panel itself. No change to the registration.
- `ext-mcp` (L24): the existing `loom_pcb_editor` tool. Its input schema grows through
  `PcbEditorAction` and its description gains one phrase; no new tool is registered.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

| File                                                         | Change                                                                    | Also edited by                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------- |
| `packages/contracts/src/fork/pcb-workspace.ts`               | Change schemas; `"changes"` action; optional `state.changes`              | L52, L53, L55, L56, L57, L61, L62, L66, L69 |
| `packages/contracts/src/fork/pcb-changes.ts` (new)           | `pcbChangeSet`, `changeDetail`, `changeCounts`                            | L69 (reads)                                 |
| `packages/contracts/src/fork/index.ts`                       | One `export *` line                                                       | Packets adding contract files               |
| `apps/server/src/fork/pcb-preview/semantics.ts`              | `compareInspections` derives from `pcbChangeSet`                          | L53, L55, L65                               |
| `apps/server/src/fork/pcb-preview/mcp.ts`                    | `loom_pcb_editor` description (`:27`)                                     | Most PCB packets                            |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`          | Hook call, overlays, chip, key line, editor case, snapshot field, `onSvg` | Most PCB packets                            |
| `apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx`          | One `SHORTCUTS` row (`:252-261`)                                          | L52, L61, L62, L66, L69                     |
| `apps/web/src/fork/pcb-preview/LayerSheet.tsx`               | Optional `onSvg` prop                                                     | L63                                         |
| `apps/web/src/fork/pcb-preview/RevisionCompare.tsx`          | Export `CHANGE` (`:37-41`); add `moved`                                   | L66                                         |
| `apps/web/src/fork/pcb-preview/changeMemory.ts` (new)        | Last seen version per design                                              | L66 (reads, to suspend)                     |
| `apps/web/src/fork/pcb-preview/useChangeHighlights.ts` (new) | Change state                                                              | None                                        |
| `apps/web/src/fork/pcb-preview/drawingDiff.ts` (new)         | Raster region diff                                                        | None                                        |
| `apps/web/src/fork/pcb-preview/ChangeHighlights.tsx` (new)   | Overlay                                                                   | L69 (reuses)                                |
| `apps/web/src/fork/pcb-preview/ChangesChip.tsx` (new)        | Chip and list                                                             | None                                        |

Conflict notes for co-editors:

- `PcbEditorAction.action` is a literal list; each packet appends its own literal. Keep one
  literal per line so parallel packets merge cleanly.
- `PcbEditorResult.state` fields are all optional; append, do not reorder.
- The key handler in `PcbPreviewPanel.tsx:1053-1064` is an `else if` chain; each packet adds
  one line. `D` is allocated to L60 in `PCB-FOLLOW-UPS.md`.
- The overlays fragment at `PcbPreviewPanel.tsx:983-997` and `:1447-1457` gains one element
  in each place. `ChangeHighlights` goes first so selection and marks draw on top; L52's
  markers go after it.

## Merge check

No upstream file changes, so there is nothing new to conflict. Confirm that:

```sh
git diff --name-only main... | grep -v -e '/fork/' -e '^docs/fork/' || echo "fork-only"
```

Expected: `fork-only`.

## FORK.md rows

None. `docs/fork/seams.tsv`: no rows.
