# L55 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/fork/pcb-preview/outline.test.ts` (new or reused from L67)                   | Shared outline contract: lines, rectangles, circles, rounded arcs and transformed footprint cutouts form closed loops; any open chain returns null, including an open outer boundary with a closed cutout; Circuit JSON outline and rectangular fallback use the drawing frame.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/pcb-preview/boardStats.test.ts` (new)                                   | `outlineArea`: rectangle and rounded rectangle loops (area within 0.1 percent of the analytic value), a cutout subtracted; an incomplete outline from `kicadOutline` falls back to bounds; `annularRing` for round pad, rect pad, oval drill, offset drill skipped; KiCad board fixture strings: per-side counts, plated versus non-plated holes, through versus blind and micro vias, smallest drill, track (segments and arcs, zones ignored), via diameter; rules from a `.kicad_pro` snippet, zero values null, missing file null; Circuit JSON rows: layer count, holes, vias from both `pcb_via` and via route points, track width, annular ring, `cad_component` height; a malformed row is skipped, not fatal; Circuit JSON passed without `inspection` (the L70 variant case) gives the same stats as with the inspection the service builds. |
| `apps/server/src/fork/pcb-preview/glb.test.ts` (update)                                       | `readGlbBounds` on a synthetic glTF JSON with a parent scale and child translation gives the expected world boxes; height picks the board as the widest mesh, reports front versus back, maps a node named "J3" to the reference, and `no-models` when only the board mesh exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (update)                         | `inspect` attaches `stats` for the KiCad fixture; a board that makes stats throw yields a warning and no `stats`; a repeated inspect for the same source hash does not invoke the tool runner again (count calls on the existing fake).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/fork/pcb-preview/realTools.test.ts` (update, runs only with KiCad installed) | On the bundled demo, stats are plausible (layer count 2, holes and vias greater than 0, area less than or equal to width × height) and match `kicad-cli`'s numbers where KiCad reports them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/contracts/src/fork/pcb-workspace.test.ts` (new or update)                           | A `PcbInspection` without `stats` decodes; one with `stats` round-trips.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

No markup tests for the card; its logic is the formatter (L54) and the stats function.

## Commands

```sh
vp test run apps/server/src/fork/pcb-preview/boardStats.test.ts \
  apps/server/src/fork/pcb-preview/glb.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/realTools.test.ts \
  packages/contracts/src/fork/pcb-workspace.test.ts
vp lint apps/server/src/fork/pcb-preview apps/web/src/fork/pcb-preview \
  packages/contracts/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`:

1. Open a real KiCad board, Inspect with nothing selected. Compare every figure with KiCad's
   Inspect, Board Statistics.
2. Clearance row: "rule" label; "Run DRC to measure" opens Checks.
3. "Measure heights": shows "Measuring", then a height; open 3D and confirm the tallest part.
4. Save a change to the board: the card updates; heights go back to "Measure heights" until the
   new 3D board exists.
5. Open a tscircuit board: layer count is no longer 0; holes and vias appear.
6. "Add to draft": the draft gets a millimetre summary.
7. Ask an agent "what is the smallest drill on this board?": it reads `stats` from
   `loom_pcb_inspect`.
8. A schematic-only design shows "Add a board to see board stats."

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
