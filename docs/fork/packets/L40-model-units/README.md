# L40: Millimetres or inches

Status: Ready to build.

Approved by Kyle on 2026-10-10.

Every length in the 3D panel is printed in millimetres today, each site with its own
`toFixed` call. This packet adds one environment setting, `displayUnits` (`"mm"` or `"in"`),
one formatter, `formatLength`, and routes every displayed length and every length input through
them. Kyle can switch units in Loom settings, in the Bed menu or from the command palette. It is
display only: models, saved views, measurements, settings and everything agents read or write
stay in millimetres.

## Scope

- In:
  - `displayUnits` in `ModelPreviewSettings`, decoded to `"mm"` when absent.
  - `apps/web/src/fork/model-preview-3d/units.ts`: `formatLength`, `formatLengths`, `toMm`,
    `fromMm`, `useDisplayUnits()` and its provider (the shared definition in
    MODEL-3D-FOLLOW-UPS.md).
  - Every length display site listed in TECHNICAL.md, "Inventory", including measurement labels
    painted into captures.
  - Unit-aware inputs: custom bed size, the section offset field, and measurement "Copy value".
  - A "Units" control in Loom settings and the Bed menu, and a palette action.
- Out:
  - Converting model files, customizer parameters (their unit is whatever the source uses) or
    anything an agent reads or writes.
  - Fractional inches, centimetres, metres.
  - Changing the bed grid with the units (the grid pattern stays its own choice).
  - Mobile UI.

## Surfaces

- Web and desktop: supported, everywhere the 3D panel and its settings show a length.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: works on every connection mode; the setting rides the existing settings RPC.
- Upstream T3 server: no 3D panel, as today.

## Extension points used

None new. Reuses L23's `ext-settings`, `ext-panels`, `ext-palette` (the model palette source)
and `ext-mcp` (settings tool description).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- Every packet that shows a length (L32 fit list, L34 legend, L37 thickness, L38 diameters,
  L39 references, L46 findings, L47 estimates, L48 part sizes) formats through
  `formatLength`. Before L40 lands they format millimetres with one local call site to swap, as
  MODEL-3D-FOLLOW-UPS.md says. L40's implementer converts any such call sites already on `main`.
- L33 (custom beds): with it, custom bed fields in Manage beds are unit-aware too, and
  `displayUnits` is an `optionalKey` in `ModelPreviewSettingsUpdate`.
- L44 (capture export): exported PNGs carry measurement labels in the display unit.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design and the inventory of length sites.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): sources.
