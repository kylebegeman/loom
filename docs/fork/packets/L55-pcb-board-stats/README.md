# L55: Board stats

Status: Ready to build.

Approved by Kyle on 2026-10-10.

Inspect shows parts, nets, copper count, size and thickness for a board, but not what a fab
quote or an enclosure needs: area, components per side, holes and vias, the smallest drill,
track and annular ring, the clearance rule, and how tall the tallest part is. This packet adds a
"Board stats" card at the top of Inspect with those numbers, computed on the server by one
shared function, `boardStats(design)`, and returned by `loom_pcb_inspect` so an agent reads the
same numbers. Every figure says where it came from: measured from the board, the design's rule
minimum, or unavailable with the reason.

## Scope

- In:
  - `apps/server/src/fork/pcb-preview/boardStats.ts` (new): the shared "Board stats" definition
    from PCB-FOLLOW-UPS.md, for KiCad boards and tscircuit Circuit JSON.
  - `PcbBoardStats` schema and an optional `stats` field on `PcbInspection`.
  - Board area from closed Edge.Cuts loops (cutouts subtracted), with a bounding box fallback.
  - Measured smallest drill, track width and annular ring; rule minimums from `.kicad_pro`.
  - Tallest component from an already cached 3D board (GLB) or Circuit JSON `cad_component`
    sizes, plus a "Measure heights" action that builds the 3D board on request.
  - `apps/web/src/fork/pcb-preview/BoardStatsCard.tsx` (new) replacing the "Board" section in
    `InspectTab.tsx:236-269`.
  - A small in-memory inspection cache keyed by source hash, because stats add work to every
    inspect (see TECHNICAL.md, Performance).
- Out:
  - Measured copper-to-copper clearance. That needs polygon geometry for pads, tracks and zones,
    which is DRC's job; the card links to Checks.
  - Custom rules in `.kicad_dru` and per-net-class minimums (the card names the board-wide rule
    only).
  - Copper area, impedance, layer stackup materials, panelization.
  - Fab capability comparison (L64) and cost (L64).
  - Mobile UI.

## Surfaces

- Web and desktop: Inspect, KiCad and tscircuit designs.
- Mobile: no PCB panel.
- Remote: stats ride inside the existing `inspect` RPC result (a few hundred bytes). "Measure
  heights" uses the existing `asset` job; no bytes cross the WebSocket.
- Upstream T3 server: no PCB panel.

## Extension points used

None new. Reuses L24's `ext-panels` (Inspect) and `ext-mcp` (`loom_pcb_inspect` output and
description).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. GLB bounds come from the glTF JSON chunk, read the way `glb.ts` already reads it.

## Relationship to other follow-up packets

- L54 (units): the card formats with `formatLength` and `formatArea`. Before L54 it prints
  millimetres through local helpers that L54 replaces.
- L64 (fab check) compares these stats with fab capability entries; L67 (enclosure fit) uses
  size, thickness, holes and tallest height. Both read `inspection.stats`; neither recomputes.
- L70 (variant sweeps) calls `boardStats` directly on each variant's built Circuit JSON to fill
  its comparison columns without a second build. That is why the function is pure over built
  data rather than a service call keyed by design id (TECHNICAL.md, Overview).
- L65 (fab package) can print the stats on its summary page.
- L53 (pin map) also edits `InspectTab.tsx` (hero card); the two changes are in different
  sections.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): KiCad, Circuit JSON and glTF facts.
