# L54: One units setting

Status: Implemented locally (`feat/pcb-units-presets-stats-print-capture`); client verification pending.

Approved by Kyle on 2026-10-10.

The PCB panel prints every length in millimetres, each site with its own `toFixed`. Many
footprints, fab limits and old boards are specified in mils or inches, so checking a 10 mil
track means doing arithmetic in your head. This packet adds one display unit, millimetres,
mils or inches, chosen from the status bar or in Settings and remembered on this device. It
applies to drawing coordinates, distance and angle marks, inspector sizes, check coordinates and
board stats, and to the hardware size inputs. It is display only: KiCad and tscircuit data,
saved marks, findings and everything agents read or write stay in millimetres. The same change
makes "Locate" work for check reports in any unit.

## Scope

- In:
  - `apps/web/src/fork/pcb-preview/length.ts` (new): `toMm`, `fromMm`, `reportUnit`,
    `formatLength`, `formatLengths`, `formatArea`, `parseLength`, `useLengthUnit`.
  - A per-device preference `lengthUnit` (`"mm" | "mil" | "in"`) in `preferences.ts`, decoded
    to `"mm"` when absent.
  - A units menu in the panel status bar and a "Length units" row in Settings, PCB.
  - Every length display site in TECHNICAL.md, "Inventory", including mark labels drawn on the
    board and captured in PNGs.
  - Unit-aware hardware width and height inputs.
  - Check coordinates converted to millimetres before display and Locate, on the server for
    new reports and on the client for anything else.
- Out:
  - Converting source files, saved marks, findings or tool payloads.
  - Electrical values (`units.ts` engineering notation for simulation stays separate).
  - Fractional inches, centimetres, micrometres, a units field on MCP outputs.
  - Grid or snap steps in the display unit (no PCB grid today).
  - Mobile UI.

## Surfaces

- Web and desktop: supported wherever the PCB panel, Inspect, Marks, Checks, Hardware and PCB
  settings show a length.
- Mobile: no PCB panel, nothing to show.
- Remote: works on every connection mode. The preference never leaves the browser, so there is
  no new RPC, and a viewer without write grants can still switch units.
- Upstream T3 server: no PCB panel, as today.

## Extension points used

None new. Reuses L24's `ext-settings` (the PCB settings section) and `ext-mcp` (two tool
description sentences).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L52 (finding markers) stores `pointMm` and formats through `formatLength`. If L52 lands
  first it creates `length.ts` with at least `toMm`, `reportUnit` and `formatLength` exactly as
  TECHNICAL.md defines them, and L54 adds the rest.
- L55 (board stats) shows its card through `formatLength` and `formatArea`. Before L54 lands
  it calls them with `"mm"`.
- L57, L64, L65 and L70 show fab limits, drill sizes and heights the same way.
- L40 (3D units) is a separate setting with the same function names and option semantics. It
  is per environment and has no mils; see PRODUCT.md, "Decisions needed from Kyle".
- L56 also adds a field to `preferences.ts`. Whichever lands first converts the schema to
  decoding defaults (IMPLEMENTATION.md step 1); the second adds one line.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design and the inventory of length sites.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): conversions and sources.
