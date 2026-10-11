# L43: Viewport keyboard and screen reader access

Status: Implemented locally (`feat/model-orientation-sections-print-check`).

Approved by Kyle on 2026-10-10.

The 3D viewport works from the keyboard and makes sense to a screen reader. With the viewport
focused, arrow keys orbit the part and Shift with arrow keys pans it; the existing `+` and `-`
keep zooming. The focused viewport has a visible ring, a name that says which model it shows,
and short instructions. A quiet announcer tells screen reader users the part's size, triangle
count and whether it fits the bed after each load or bed change, and which tool or mode they
just switched to.

## Scope

- In:
  - Arrow keys orbit by 15 degrees; Shift with arrow keys pans by a tenth of the viewport height.
    Only when the canvas itself has focus.
  - Canvas role, accessible name with the file name, and described-by instructions.
  - The focus ring (already present) checked and kept.
  - One polite live region in the panel for load, fit, tool, mode, view and capture messages.
  - Help popover rows and the user guide updated.
- Out:
  - Keyboard picking for measure and annotate (needs a cursor model; a later idea).
  - Describing geometry beyond size, triangle count and fit.
  - Mobile (no 3D panel).
  - Changing pointer navigation.

## Surfaces

Web and desktop: supported. Mobile has no 3D panel. Purely client side, so every connection mode
behaves the same.

## Extension points used

Reuses L23's `ext-panels` and `ext-web-root` + `ext-keybindings` (the panel key handler).
Creates none.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L31 (orthographic): arrow orbit and pan work in either projection. If L31 has landed, the
  announcer also says "Orthographic" or "Perspective" when `P` is pressed; without it that
  message does not exist.
- L40 (units): the announcer formats lengths with `formatLength` and `useDisplayUnits` when L40
  has landed; until then it uses the status bar's millimetre format through one call site.
- L32 and L34 (bed fit, nozzle zones): the fit message reads the same `fitsBuildVolume` result
  the status bar shows. If those packets change what "fits" means, the announcer follows the
  status bar.
- L44 (capture export): its success messages ("Image copied.", "Download started.") are
  announced through the same region.
- L35, L36, L42, L49 (new keys): their toggles can add one line to the announcer's message
  helper. Not required.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
