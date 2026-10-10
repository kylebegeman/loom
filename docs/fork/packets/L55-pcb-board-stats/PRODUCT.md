# L55 product

## Problem

Before ordering a board or designing a case, Kyle wants the numbers a fab quote form and an
enclosure sketch ask for. Today Inspect's "Board" section (`InspectTab.tsx:236-269`) shows
parts, nets, copper count, a bounding size and thickness, and labels only non-plated mounting
holes, labelled "Holes" on `main` (`InspectTab.tsx:264-266`) and "Unplated holes" after
`6ddf84c1aa` on the local `fix/preview-defects` branch. Neither counts plated holes. The rest
means opening KiCad's board statistics or guessing.

## What the user can do

Open Inspect with nothing selected and read the "Board stats" card:

| Stat                  | Example                                  | Source label                                               |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| Size                  | "50 × 30 mm"                             | Measured (outline bounds)                                  |
| Area                  | "1,412 mm²"                              | "Outline" or "Bounding box" when the outline is not closed |
| Thickness             | "1.6 mm"                                 | Board setup                                                |
| Copper layers         | "4"                                      | Board setup                                                |
| Components            | "42 front · 7 back"                      | Footprints                                                 |
| Holes                 | "36 plated · 4 non-plated"               | Pads                                                       |
| Vias                  | "120" (with "8 blind or micro" when any) | Board                                                      |
| Smallest drill        | "0.30 mm"                                | Measured                                                   |
| Smallest track        | "0.15 mm"                                | Measured                                                   |
| Smallest annular ring | "0.13 mm"                                | Measured (round pads and vias)                             |
| Clearance             | "0.20 mm rule"                           | Design rule; "Run DRC to measure" opens Checks             |
| Tallest part          | "11.2 mm · J3"                           | 3D board; or "Measure heights"                             |
| Nets                  | "87"                                     | As today                                                   |

- Press "Measure heights" when no 3D board is cached. It builds the 3D board once (KiCad 10 or
  later, or tscircuit) and fills in the tallest part. Opening the 3D surface does the same.
- Ask an agent for the board size or smallest drill: `loom_pcb_inspect` returns the same stats.
- Copy the card into the draft with "Add to draft" (plain text, millimetres) for a quote
  question.

## Entry points

| Way in                                      | Way out                                               | Where the state shows          |
| ------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| Inspect tab with no selection and no search | Select a part or net, or search                       | The card at the top of Inspect |
| "Measure heights" in the card               | None needed; the result is cached per source revision | "Tallest part" row             |
| "Run DRC to measure"                        | Back to Inspect                                       | Checks tab                     |
| "Add to draft"                              | Edit the draft                                        | Composer draft text            |
| `loom_pcb_inspect`, `t3 pcb inspect`        | Not applicable                                        | `stats` in the result          |

## States

- Loading: while the inspection loads, Inspect already shows its loading state; the card is
  part of the same result. "Measure heights" shows "Measuring" on its row and is disabled.
- Empty: a schematic-only design has no board, so the card shows "Add a board to see board
  stats." Each missing figure shows "Not available" with a reason in its title: "No tracks",
  "No vias", "No rules in the project file", "No 3D models in this board".
- Error: a malformed board still inspects as today; the stats that failed are null with a
  warning in `inspection.warnings` ("Board stats are incomplete: ..."). "Measure heights"
  failure shows the asset error inline (for example "KiCad 10 or newer is required for the GLB
  board export.").
- Disabled: "Measure heights" without the terminal grant (it runs the exporter) or when the
  tool is too old, with the reason as its hint. "Add to draft" without a thread draft target.
- Stale: stats belong to the inspection's `sourceHash`. When the source changes, Inspect
  reloads as today and the card shows the new numbers; heights reset to "Measure heights" until
  the new 3D board exists.

## Surfaces and connection modes

Web and desktop, KiCad and tscircuit. Mobile has no PCB panel. Remote clients get the stats in
the inspect RPC; the GLB build stays on the host and its bytes only move over the signed HTTP
route when the user opens 3D.

## Decisions

- Clearance shows the rule minimum, labelled "rule", never a measured value. Measuring it needs
  copper geometry with zones, which DRC already does correctly; a second, wrong implementation
  would be worse than an honest label.
- Drill, track and annular ring are measured from the board, with the rule minimum beside them
  when it exists, because both answer real questions: "what does my board need" and "what did I
  allow".
- Annular ring is measured for round drills in round or rectangular pads and vias:
  (smaller pad dimension minus drill) / 2. Oval drills use their smaller dimension. Offset drills
  and custom pad shapes are skipped, and the label says "round pads and vias".
- Heights come only from data already on the host; inspection never starts a 3D export on its
  own, because that export can take up to 180 seconds (`PcbPreviewService.ts:1695-1700`).
- The card replaces the existing "Board" section in place rather than adding a second one.
  "Holes" now counts every drilled pad, split into plated and non-plated.

## Decisions needed from Kyle

None.
