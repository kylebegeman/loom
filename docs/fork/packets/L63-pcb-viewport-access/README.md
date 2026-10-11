# L63: PCB keyboard and screen reader pass

Status: Implemented locally (`feat/pcb-units-presets-stats-print-capture`); real-client and screen-reader verification pending.

Approved by Kyle on 2026-10-10.

The PCB panel works with a keyboard and a screen reader. One polite announcer tells the user
what changed: the component, pin or net they selected with its reference and value, the surface,
sheet or layers they switched to, a check run's result and counts, and when a drawing is
building, ready or updated. Stepping through check findings says which finding and where.
Focus moves through the document bar, the drawing, the tools panel and the rail in the order
they appear, stays in the panel when the drawing reloads or the tools close, and is always
visible on the drawing and the 3D board. The drawing's name says which design and surface it
is, such as "power, Board, Front copper".

## Scope

- In:
  - A PCB announcer (`announce.ts`, pure) and one persistent live region, following L43's
    pattern, for selection, surface, sheet, layers, tool steps, check runs, build state, panel
    notices and finding steps.
  - Accessible names: the workspace region, the drawing (design and surface, with
    instructions), the 3D board canvas, rail buttons with their issue counts, status bar check
    chips.
  - Focus: one `main` landmark only, focus into the tools panel when `I` opens it, focus back to
    where it was when the tools close, focus kept on the drawing when it remounts for a new
    surface, sheet or layer preset or switches to 3D, a visible focus ring on the 3D canvas.
  - Finding steps: announce each step of L52's `.` and `,` keys; without L52, announce the
    "Go to" location buttons in the Checks tab.
  - Reduced motion: the tools panel's three transitions stop under
    `prefers-reduced-motion: reduce`. Pans are already instant.
- Out:
  - New keys. Arrow keys orbiting the 3D board (L43's `nudge`) would give arrows a new meaning
    in 3D; it is a decision for Kyle (PRODUCT.md), not built here.
  - Screen reader descriptions of drawing contents (traces, symbols). The Inspect tab is the
    accessible view of components, pins and nets.
  - Linked-drawing announcements and the 3D model panel (L43 covers it).
  - Mobile (no PCB panel).

## Surfaces

Web and desktop, local or remote; nothing crosses the network. Mobile has no PCB panel.

## Extension points used

L24's PCB panel (`ext-panels`) and `pcb-preview` capability. Creates none.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L43 (3D accessibility): L63 copies its announcer pattern (pure `announcement(previous,
next)` plus one persistent `sr-only` region). L43 defines a pattern, not a shared module, so
  the PCB announcer is its own file with the same shape. L63 calls L43's `describe(name,
descriptionId)` on the 3D board canvas; if L43 has not landed, L63 adds just that method to
  `createViewer.ts` exactly as L43 specifies, and leaves the rest of L43's canvas changes to L43.
- L52 (check markers): its `.` and `,` keys set the active finding; L63 announces it. Without
  L52, the Checks tab's "Go to" buttons announce where they went.
- L62 (capture export): its notices ("Image copied.", "Download started.") are announced through
  the notice path.
- L54 (units): announcements carry no coordinates, so no unit formatting is involved.
- Later overlay and stepping packets (L60, L66, L69): any animated pan must jump instantly under
  reduced motion; new announcements go through `announce.ts`.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
