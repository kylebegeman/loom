# L54 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                            | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/pcb-preview/length.test.ts` (new)            | `toMm`/`fromMm` round trip for all three units; `formatLength` defaults ("12.70 mm", "500.0 mil", "0.500 in" for 12.7 mm); `digits` 0 and 1 in each unit; mil digits never below 0; `unit: false`; `trim`; `-0` as "0"; `formatLengths` writes the unit once and skips null; `formatArea` mm² and in²; `parseLength` bare numbers in each unit, suffixes "mm", "mil", "mils", "in", `"`, spaces and commas rejected, negatives and NaN rejected; `reportUnit` maps "mm", "in", "mils" and returns null for "cm". |
| `apps/web/src/fork/pcb-preview/preferences.test.ts` (new)       | A stored v1 value without `lengthUnit` decodes with its `trusted` and `selections` intact and `lengthUnit: "mm"`; an invalid `lengthUnit` falls back to defaults as today.                                                                                                                                                                                                                                                                                                                                       |
| `apps/server/src/fork/pcb-preview/realReports.test.ts` (update) | The KiCad 10.0.6 ERC fixture yields positions 100 times the raw values and `coordinateUnits: "mm"`; the DRC fixture is unchanged (guards an over-broad fix).                                                                                                                                                                                                                                                                                                                                                     |
| `apps/server/src/fork/pcb-preview/kicadReports.test.ts` (new)   | `ercScale` for "8.0.4", "9.0.3", "10.0.6" (100), "10.0.7", "11.0.0" (1), "10.99.0" and "" (null); a synthetic DRC report in `in` and in `mils` converts to mm; an unknown unit passes through untouched.                                                                                                                                                                                                                                                                                                         |
| `apps/web/src/fork/pcb-preview/summary.test.ts` (update)        | Summaries print mm for an `in` report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Formatting sites are one-line swaps of tested functions, so they get no markup tests. The `rg`
check in IMPLEMENTATION.md step 5 stands in for an inventory test.

## Commands

```sh
vp test run apps/web/src/fork/pcb-preview/length.test.ts \
  apps/web/src/fork/pcb-preview/preferences.test.ts \
  apps/web/src/fork/pcb-preview/summary.test.ts \
  apps/server/src/fork/pcb-preview/kicadReports.test.ts \
  apps/server/src/fork/pcb-preview/realReports.test.ts
vp lint apps/web/src/fork/pcb-preview apps/server/src/fork/pcb-preview
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`:

1. Open a KiCad board with old preferences: everything reads as on `main`; trusted tscircuit
   designs are still trusted.
2. Status bar menu, "mil": Inspect size and thickness, Marks rows, the label on the drawing,
   Checks coordinates and Hardware sizes switch at once. Reload: still mils.
3. Measure a 0.254 mm track: "10.0 mil". Capture with `loom_pcb_editor` capture: the label in
   the PNG reads mils.
4. Run ERC; press "Locate" on a pin finding: the drawing centres on that pin.
5. Hardware: type "1.5 in" in Width; save; switch to mm: "38.10".
6. Settings, PCB: the select shows the same unit and changes the open panel live.
7. Ask an agent for the board size: it answers in millimetres from `loom_pcb_inspect`.

Upstream server: the panel is unavailable, nothing to check.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
