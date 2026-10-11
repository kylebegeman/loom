# L55 testing

Implemented locally on `feat/pcb-units-presets-stats-print-capture`.
Validation uses focused tests and strict lint. No browser, dev server, installation,
repo-wide suite, or real CAD exporter was run for this packet.

## Automated evidence

- `outline.test.ts`: shuffled/reversed line chaining, endpoint tolerance, transformed
  footprint cutouts, circles/arcs, exact extrema, polygon closure, ambiguous/open outlines,
  and Circuit JSON drawing-frame conversion. Malformed explicit Circuit JSON outlines retain
  known rectangular dimensions with a labeled bounds fallback.
- `boardStats.test.ts`: cutout area and rounded-rectangle area within 0.1% of its analytic
  value; board bounds fallback; per-side components; all drilled pads and via types;
  measured track/drill/ring/via diameter; project-rule provenance and unset values;
  Circuit JSON variants without a saved inspection; CAD height provenance;
  cached front/back GLB heights and reference names; unavailable values;
  plated mounting-hole stitching-via and oval-drill handling.
- `glb.test.ts`: existing unit normalization plus JSON extraction, parent/child transforms,
  quaternion and matrix bounds, ancestor/material metadata, cycle and malformed-bound rejection.
- `workbench.test.ts`: existing semantic regressions, updated mounting metadata.
- `PcbPreviewService.test.ts`: 28 tests passed after L55 integration. New regressions prove
  repeated inspection reuses schematic connectivity, inspection does not launch a 3D export,
  a cached GLB updates height without a source change, only its JSON is read, new source
  revisions discard old heights, and malformed project rules retain inspection with a warning.
- `pcb-workspace.test.ts`: older inspection payloads decode and stats round-trip.
- `boardStatsText.test.ts`: quote summaries stay in millimetres and distinguish measured
  values from design rules.

Strict lint passed on the owned service, semantic/geometry/statistics modules, tests,
BoardStatsCard, draft formatter, and Board3D callback. Package typechecks and final shared
integration evidence are recorded by the integrating agent.

Focused reproduction:

```sh
./node_modules/.bin/vp test run \
  apps/server/src/fork/pcb-preview/outline.test.ts \
  apps/server/src/fork/pcb-preview/boardStats.test.ts \
  apps/server/src/fork/pcb-preview/glb.test.ts \
  apps/server/src/fork/pcb-preview/workbench.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  packages/contracts/src/fork/pcb-workspace.test.ts \
  apps/web/src/fork/pcb-preview/boardStatsText.test.ts
```

## Remaining verification

`kicad-cli` and `tsci` were not available on PATH, so real board-statistics comparison,
KiCad reference node names, and current CLI-exported Circuit JSON remain unverified.
The synthetic tests do not establish exporter compatibility or the physical accuracy of
installed component CAD models.

With permission to use a client, check the card with no selection, unit changes, draft
insertion, clearance-to-Checks navigation, disabled/error height controls, an explicit
height export, opening 3D, and height reset after save. Compare the same real KiCad board
with KiCad's Board Statistics and viewer. Check a real tscircuit export as well.

## Integrated verification

The integrating agent completed strict scoped lint and typechecks for contracts,
client-runtime, server and web after wiring all five PCB packets. The focused service
suite passes 31 regressions, including signed PDF limits, canonical output exclusions and
optional project-rule read failures. No repo-wide suite or browser was run.
