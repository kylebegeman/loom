# L34: Nozzle zones on the H2D and H2C

Status: Ready to build.

Approved by Kyle on 2026-10-10.

The Bambu Lab H2D and H2C have two nozzles that cannot reach the whole plate. Each nozzle misses
a strip on the far side, and the left nozzle prints 5 mm lower than the right. Today Loom draws
one plain plate and judges fit against the outer envelope, so a part can look fine and then fail
in the slicer. This packet adds the per-nozzle reach to those two presets (numbers from Bambu
Studio's machine profiles, which match Bambu's current spec pages), tints the single-nozzle
strips on the plate and in Part's top view, adds a legend to the Bed menu, and makes the fit
check say which nozzles can print the part. Agents get the same answer in the fit summary.

## Scope

- In:
  - An optional `zones` field on bed presets (the shared shape in MODEL-3D-FOLLOW-UPS.md, plus an
    optional `heightMm`), filled for `bambu-h2d` and `bambu-h2c`.
  - Pure zone geometry and zone-aware fit in `packages/contracts/src/fork/model-beds.ts`.
  - `viewer/zones.ts`: tinted "left nozzle only" and "right nozzle only" strips on the plate.
  - The same strips in Part's top view, a legend in the Bed menu, and a "Show nozzle zones"
    switch (setting `buildPlate.showZones`, on by default).
  - Zone-aware wording in Part's fit card, L32's fit list and the agent fit summary.
  - Corrected H2D and H2C preset notes.
- Out:
  - Zones for other printers (none of the other presets has more than one nozzle) and for
    custom beds (L51 makes zones editable).
  - Placing the part on the plate. The viewer keeps centring the plate under the part.
  - Per-material assignment, prime towers, the H2D laser and cutter areas, and the H2C Vortek
    hotend rack. Loom does not slice here (L47 estimates prints through a slicer).
  - Mobile UI.

## Surfaces

- Web and desktop: supported, in the viewport, the Bed menu, Part and Loom settings.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: works on every connection mode; zones are static data in contracts, the switch is the
  existing settings RPC.
- Upstream T3 server: no 3D panel, as today.

## Extension points used

None new. Reuses L23's `ext-settings` (3D model section) and `ext-mcp` (settings and render
tools).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L32 (bed fit): with it, the fit list rows for the H2D and H2C use zone wording and the agent
  summary rows gain `zone`. Without it, only Part's fit card is zone-aware. Whichever of L32, L33
  or L34 lands first creates `model-beds.ts` (L32 TECHNICAL.md, "Bed list in contracts").
- L33 (custom beds): custom beds have no zones. Hiding the H2D hides its zones with it. If L33 has
  landed, `showZones` is also an `optionalKey` in `BuildPlateSettingUpdate`.
- L35 (lay flat): fit uses the world-space size after orientation, so it follows automatically.
- L40 (units): zone sizes in the legend and fit text use `formatLength`.
- L47 (slicing estimates): the slicer applies the real zone rules; L34 is the quick preview.
- L51 (printer library): keeps the `zones` field and makes it editable.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): sources for the numbers.
