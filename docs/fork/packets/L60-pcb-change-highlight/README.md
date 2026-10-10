# L60: PCB change highlight

Status: Ready to build.

Approved by Kyle on 2026-10-10.

The PCB panel reloads the moment a design's files change, whether the agent edited them, the
user saved in KiCad, or a parameter edit rewrote the source. Today the new drawing simply
replaces the old one, and spotting that one resistor moved or a net lost a pin means comparing
from memory. With this packet a reload of a design the user has already seen shows a chip,
"Changed. Show changes (D)". Pressing `D` marks on the drawing what changed since the version
shown before: parts added (green), removed (red, at their old place), moved (blue, with an
arrow from the old position), rotated or edited (amber), pins whose net changed, and dashed
boxes around any other drawn change, such as a rerouted trace, a new via, a zone or a schematic
wire. A popover lists the same changes by part and net and selects a part on click. Agents get
the same list from the PCB editor snapshot and toggle the highlight with an editor command, so
"show me what you changed" works in both directions.

## Scope

- In:
  - A pure structural diff, `pcbChangeSet(before, after)`, in
    `packages/contracts/src/fork/pcb-changes.ts`, built from the server's existing
    `compareInspections` (`apps/server/src/fork/pcb-preview/semantics.ts:443-459`), which then
    derives its output from it. It adds moves with before and after positions, orientation
    changes and net membership changes.
  - A drawing diff for what inspection data does not cover (traces, vias, zones, outlines,
    schematic wires and labels): the previous and current drawing SVGs rasterized once on
    demand and compared into at most 50 regions.
  - `ChangeHighlights.tsx` overlay, the "Changed" chip with its change list popover, the `D`
    key, a **?** list row.
  - Session memory of the last seen version per design, so changes made while the tab was
    hidden still show when it returns.
  - Editor action `changes` and `state.changes` in the editor snapshot (`loom_pcb_editor`,
    `t3 pcb editor`).
- Out:
  - The 3D board view. Highlights apply to the schematic and board drawings.
  - Diffs against any version other than the one shown before (Git revisions and checkpoints
    stay in the Compare tab; L66 adds a history timeline).
  - Exact trace geometry diffs (see TECHNICAL.md, Alternatives).
  - Persisting changes across app restarts.
  - Mobile UI.

## Surfaces

- Web and desktop: both drawings, including the linked split view.
- Mobile: no PCB panel.
- Remote: nothing new crosses the wire. Both versions' inspections and drawings are already in
  the client; the diff and the raster run there.
- Agents: `loom_pcb_editor` with `{ "action": "changes", "enabled": true }` and the
  `changes` field of `{ "action": "snapshot" }`; the same through `t3 pcb editor '<json>'`.

## Extension points used

None new. Reuses L24's `ext-panels` (PCB panel) and `ext-mcp` (the existing `loom_pcb_editor`
tool, whose schema grows).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- **L42 `model-change-ghost`**: the 3D counterpart. Same one-previous-version model, same
  chip wording, `D` key and no-timer rule.
- **L52 `pcb-check-markers`**: draws its own overlay beside this one. If L52's
  `OverlayScaleContext` exists, use it for screen-constant marker sizes; otherwise use fixed
  millimetre sizes as `Overlays.tsx` does.
- **L59 `pcb-follow-agent`**: independent. A design an agent changed while its tab was open or
  hidden shows the chip when visible; a design opened fresh from L59's chip has no previous
  version.
- **L62 `pcb-capture-export`**: captures include the highlights, because they live in the
  overlay SVG that capture already draws.
- **L66 `pcb-history`**: while a history version is shown, highlights are off and the chip is
  hidden; L66 owns that comparison.
- **L69 `pcb-change-requests`**: reuses `pcbChangeSet` and `ChangeHighlights.tsx` to draw the
  changed parts near a request's anchor.
- Key `D` is allocated to this packet in `PCB-FOLLOW-UPS.md`.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art, file format and canvas facts.
