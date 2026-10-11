# L54 testing

Focused tests, no repo-wide checks, no sleeps.

## Local implementation evidence (2026-10-10)

Implemented on `feat/pcb-units-presets-stats-print-capture`.

- Focused web tests: 20 passed across `length.test.ts`, `preferences.test.ts`,
  `geometry.test.ts`, `summary.test.ts`, and `length.interactions.test.tsx`.
- Interaction checks verified legacy inch report location in millimetres, live display-unit
  updates, unknown-unit findings with no Locate action, and suffix-aware hardware inputs with
  invalid-edit blocking, arrow stepping, and canonical millimetre saves.
- Strict targeted lint (`--deny-warnings`) passed for the formatter, preferences, settings,
  geometry, labels, inspector, checks, summary, hardware library and their changed tests.
- The existing server report normalization is preserved: it already corrects known affected
  ERC versions, converts supported report units, and emits `coordinateUnits: "mm"`.
- The length inventory leaves only angle precision, zoom/scale percentages, drawing byte
  counts, electrical/plot values, canonical agent summaries and unknown-report fallback text.

Final integrated package typechecks are recorded by the primary agent. No browser, dev server,
remote-client or GPU verification was run. The manual checks below remain pending.

## Automated tests

| File                                                            | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/pcb-preview/length.test.ts` (new)            | `toMm`/`fromMm` round trip for all three units; `formatLength` defaults ("12.70 mm", "500.0 mil", "0.500 in" for 12.7 mm); `digits` 0 and 1 in each unit; mil digits never below 0; `unit: false`; `trim`; `-0` as "0"; `formatLengths` writes the unit once and skips null; `formatArea` mm² and in²; `parseLength` bare numbers in each unit, suffixes "mm", "mil", "mils", "in", `"`, spaces and commas rejected, negatives and NaN rejected; `reportUnit` maps "mm", "in", "mils" and returns null for "cm". |
| `apps/web/src/fork/pcb-preview/preferences.test.ts` (new)       | A stored v1 value without `lengthUnit` decodes with its `trusted` and `selections` intact and `lengthUnit: "mm"`; an invalid `lengthUnit` falls back to defaults as today.                                                                                                                                                                                                                                                                                                                                       |
| `apps/server/src/fork/pcb-preview/realReports.test.ts` (update) | The KiCad 10.0.6 ERC fixture yields positions 100 times the raw values and `coordinateUnits: "mm"`; the DRC fixture is unchanged (guards an over-broad fix).                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/src/fork/pcb-preview/summary.test.ts` (update)        | Summaries print mm for an `in` report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Formatting sites are one-line swaps of tested functions, so they get no markup tests. The `rg`
check in IMPLEMENTATION.md step 5 stands in for an inventory test.

## Commands

```sh
vp test run apps/web/src/fork/pcb-preview/length.test.ts \
  apps/web/src/fork/pcb-preview/preferences.test.ts \
  apps/web/src/fork/pcb-preview/summary.test.ts \
  apps/web/src/fork/pcb-preview/geometry.test.ts \
  apps/web/src/fork/pcb-preview/length.interactions.test.tsx \
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

## Integrated verification

The integrating agent completed strict scoped lint and typechecks for contracts,
client-runtime, server and web after wiring all five PCB packets. The focused service
suite passes 31 regressions, including signed PDF limits, canonical output exclusions and
optional project-rule read failures. No repo-wide suite or browser was run.
