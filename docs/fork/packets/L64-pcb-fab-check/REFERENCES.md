# L64 references

All fab pages were read on 2026-10-10. Fab limits change; the built-in data carries that date.
KiCad is not installed on the machine where this packet was written, so no kicad-cli command was
executed locally.

## Prior art

- Fabs publish KiCad DRC rule files (`.kicad_dru`) and KiCad has a "Import settings from
  another board" flow; both put fab limits into the user's board. L64 keeps them in a copy.
- KiCad's Board Setup "Constraints" page holds absolute minimums; netclasses and custom rules
  layer on top.
- The Electronics app plan (`~/Developer/docs/apps/electronics/`) describes a DRC wrapper with
  fab profiles and a cost report. Research only, not a dependency.
- Fabrication Toolkit (bennymeg, Apache-2.0) runs DRC before building outputs.

## Verified facts

### KiCad

- `kicad-cli pcb drc` (KiCad 10.0, docs built from 10.0.7): `--format report|json`,
  `--all-track-errors`, `--schematic-parity`, `--units mm|in|mils`, `--severity-all` and other
  severity flags, `--exit-code-violations` (exit 5 when violations exist), `--refill-zones`,
  `--save-board` (only with refill). <https://docs.kicad.org/10.0/en/cli/cli.html>
- KiCad 9.0 (docs built from 9.0.9): `pcb drc` has no `--refill-zones`.
  <https://docs.kicad.org/9.0/en/cli/cli.html>
- Custom rules live in `<project>.kicad_dru` beside the project, start with `(version 1)`, and use
  `(rule "name" (constraint <type> (min <value>)) (condition "<expression>"))`. Constraint types
  include `track_width`, `clearance`, `hole_size`, `annular_width`, `via_diameter`,
  `hole_to_hole` and `edge_clearance`. Custom rules take precedence over netclasses; Board
  Setup minimums cannot be overridden by rules.
  <https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html> (custom design rules section)

### JLCPCB, <https://jlcpcb.com/capabilities/pcb-capabilities>

- Layers 1 to 32. Thickness 0.4 to 4.5 mm; FR4 options include 0.4, 0.6, 0.8, 1.0, 1.2, 1.6 and
  2.0 mm. The FAQ says 0.4 to 3.2 mm, which disagrees; noted in the entry.
- Track and space at 1 oz: 0.10 / 0.10 mm for 1 and 2 layers; 0.09 / 0.09 mm multilayer.
- Vias: standard minimum 0.15 mm hole with 0.25 mm diameter; 0.1 / 0.2 mm only on boards up to
  1 mm thick with ENIG or OSP. Diameter at least hole + 0.1 mm. Preferred minimum hole 0.2 mm.
- Extra cost: 0.1 and 0.15 mm via holes at any diameter, and 0.2 to 0.25 mm holes with a
  diameter under 0.45 mm.
- PTH drill 0.15 to 6.3 mm. Annular ring: 2-layer 1 oz 0.18 mm minimum (0.25 recommended);
  multilayer 0.15 mm minimum (0.20 recommended). NPTH minimum 0.5 mm.
- Hole spacing: via to via 0.2 mm; pad hole to pad hole 0.45 mm.
- Copper to routed edge 0.2 mm; to V-cut 0.4 mm. Board size minimum 3 x 3 mm.
- Finishes: HASL with lead, lead-free HASL, ENIG, OSP.
- Castellated holes: hole at least 0.5 mm, at least 1 mm from the edge, board at least
  10 x 10 mm.
- Via-in-pad: epoxy or copper filled and capped; standard from 6 layers.
- Low-price offer: 5 pieces of 2-layer boards up to 100 x 100 mm.
  <https://jlcpcb.com/help/article/how-do-i-place-an-order>

### PCBWay, <https://www.pcbway.com/capabilities.html>

- Standard process 1 to 14 layers. Track and space 0.1 / 0.1 mm.
- Drill 0.15 to 6.0 mm; "Any holes greater than 6mm or smaller than 0.2mm will be subject to
  extra charges."
- Annular ring minimum 0.15 mm. Via pad diameter is not published; the built-in value 0.50 mm is
  derived from a 0.2 mm hole plus two 0.15 mm rings and marked as derived.
- Advanced table: hole to hole at least 11 mil (0.28 mm) for vias and 16 mil for component holes;
  copper to edge 0.25 mm.
- Thickness 0.2 to 3.2 mm. Finishes: HASL, lead-free HASL, immersion gold, OSP, hard gold,
  immersion silver, immersion tin, ENEPIG. Castellated hole minimum 0.4 mm.

### OSH Park, <https://docs.oshpark.com/services/> and <https://docs.oshpark.com/design-tools/kicad/kicad-design-rules/>

- 2-layer: 6 mil track and space (0.1524 mm), 10 mil drill (0.254 mm), 5 mil annular ring
  (0.127 mm), 20 mil via (0.508 mm), 5 mil hole to hole (0.127 mm), 1.6 mm, 1 oz, ENIG, $5 per
  square inch for three boards.
- 4-layer: 5 mil track and space (0.127 mm), 10 mil drill, 4 mil annular ring (0.1016 mm), 18 mil
  via (0.4572 mm), 1.6 mm, ENIG, $10 per square inch for three boards.

## Unverified, check during implementation

- KiCad DRC JSON `type` names for each constraint (`track_width`, `clearance`,
  `drill_out_of_range`, `via_diameter`, `annular_width`, `copper_edge_clearance`,
  `hole_to_hole`). The L24 fixture (`fixtures/drc.json`, KiCad 10.0.6) only has parity items.
- The description format, including whether it names the rule (`rule 'loom_fab_track'`) and an
  `actual` value.
- That later rules in a `.kicad_dru` take precedence over earlier ones and over netclasses for
  the same constraint, and that `annular_width` applies to pads in KiCad 9 and 10.
- The `.kicad_pro` key names under `board.design_settings.rules` (L55 lists the same keys) and
  that `0` disables each minimum.
- `(property pad_prop_castellated)` and `(stackup ... (copper_finish ...))` spellings.
- Whether OSH Park prices by the outline's bounding rectangle.
- JLCPCB's exact layer-count list above 2 layers, and PCBWay's exact thickness list. The
  built-in lists are the common values and the notes say so.
- Surcharges marked "general" in TECHNICAL.md (ENIG, non-1.6 mm thickness, castellation, extra
  layers) are common pricing behaviour, not checked against a price list.
- OSH Park edge clearance and castellation: not published.

## Licences

No code is copied. Fab limits are facts, cited with links. KiCad (GPL-3.0) runs as a separate
host process. Fabrication Toolkit is referenced only.
