# L56: Built-in layer presets

Status: Implemented locally (`feat/pcb-units-presets-stats-print-capture`); client verification pending.

Approved by Kyle on 2026-10-10.

Layers offers three copper presets (Front, Back, All copper) and the user's own saved sets.
Everyday review jobs need other combinations: assembly drawings, copper alone, what the fab
will see, and silkscreen against the mask. This packet adds five built-in presets, "Assembly
front", "Assembly back", "Copper only", "Fab review" and "Silkscreen check", shown next to saved
sets in Layers and in the layer menu on the drawing. Built-ins are read-only. The user can hide
the ones they never use and duplicate one into a saved set to change it. Agents apply them with
the editor `layers` command by id.

## Scope

- In:
  - `packages/contracts/src/fork/pcb-layer-presets.ts` (new): the five presets as data over
    canonical KiCad layer names, `resolveLayerPreset` and `findLayerPreset`.
  - A "Presets" section in the Layers tab, before "Saved sets", with apply, hide, show hidden
    and duplicate.
  - A "Presets" group in the drawing's layer menu (`PcbPreviewPanel.tsx:884-915`).
  - The status bar and shelf name the active preset or saved set instead of a stale copper
    label.
  - Editor command `layers` with `name` set to a preset id, a built-in name or a saved set.
  - Per-device `hiddenLayerPresets` preference.
- Out:
  - Editing built-ins in place (duplicate instead), per-preset opacity, colours.
  - Presets for schematic sheets or the 3D board.
  - User-defined presets shared across designs (saved sets stay per design).
  - tscircuit boards: their inspection has no KiCad layer names (`semantics.ts:417`), so the
    section is hidden.
  - Mobile UI.

## Surfaces

- Web and desktop: the Layers tab and the drawing's layer menu, KiCad boards.
- Mobile: no PCB panel.
- Remote: applying a preset changes local view state only. Duplicating writes a saved set
  through the existing `updateWorkspace` RPC, which already works over every connection mode.
- Upstream T3 server: no PCB panel.

## Extension points used

None new. Reuses L24's `ext-panels` (the panel), `ext-mcp` (editor tool description) and
`ext-cli` (unchanged `t3 pcb editor`).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L54 also adds a field to `preferences.ts`. Whichever lands first converts the schema to
  decoding defaults; the second adds one line.
- L57 (true-scale print) and L65 (fab package assembly drawing) choose layers. They read the
  same preset data from contracts (`assembly-front`, `assembly-back`) so a printed assembly
  page and the on-screen preset agree.
- L62 (image export) captures whatever preset is active; nothing extra.
- L63 (viewport access) announces the applied preset name through its live region if it has
  landed.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): KiCad layer names and sources.
