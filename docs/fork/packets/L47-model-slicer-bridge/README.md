# L47: Slicing estimates

Status: Implemented locally (`feat/model-history-assemblies-slicing-cad`).

Approved by Kyle on 2026-10-10. Kyle chose to build slicing estimates in Loom on 2026-10-10.

The 3D panel can tell whether a part fits a printer, but not how long it takes or how much
filament it uses. This packet runs a slicer that is already installed on the environment host
(Bambu Studio first, then OrcaSlicer and PrusaSlicer) with the printer, process and filament
profiles mapped to the active bed, and shows the answer in the Part tab: "4 h 12 m, 38 g PLA",
with filament length, grams, an estimated support weight, layer count and cost when a price
is known. A layer slider draws the sliced extrusion paths over the bed on demand. On the
desktop app the sliced project opens in the slicer with one click; remote browsers download
it. Agents get the same estimate from `loom_model_preview_3d_slice`, so they can compare
variants by print time. Loom never sends anything to a printer.

## Scope

- In:
  - Detecting Bambu Studio, OrcaSlicer and PrusaSlicer on the host with a version, a path
    override, a timeout and a clear "not installed" state, like OpenSCAD.
  - A per-bed profile mapping (slicer, printer, process, filaments) in Loom settings, with
    suggested Bambu Studio profiles for the Bambu built-ins.
  - Reading installed Bambu Studio and OrcaSlicer system and user profiles read-only and
    flattening their `inherits` chains into the full profiles the CLI needs; importing a
    profile file as the fallback; PrusaSlicer through an imported config file.
  - Slicing STL, 3MF, OBJ and SCAD (through the existing render) and, with L50, build123d and
    STEP, on demand, with cancellation, one slice at a time per slicer, and a cache keyed by
    geometry, orientation, profiles and slicer version.
  - Parsing time, filament, weight, layers and support from the slicer's own output (3MF
    metadata and G-code comments), and an estimated support weight from the toolpaths.
  - "Print" in the Part tab, a layer preview with a slider, "Open in Bambu Studio" on desktop,
    "Download 3MF" everywhere, and print times on variants.
  - The MCP tool `loom_model_preview_3d_slice` and a `layers` editor command.
- Out:
  - Sending, uploading or starting a print. Loom never talks to a printer.
  - Editing slicer settings in Loom beyond choosing profiles. Tuning happens in the slicer.
  - Multi-plate projects, multi-material painting and per-object settings. The part is sliced
    as one object on plate 1.
  - Rendering slicer thumbnails (`--export-png` needs a GPU context on the host).
  - Starting estimates automatically on every change. Estimates run when asked; cached
    results show automatically.
  - Mobile UI.

## Surfaces

- Web and desktop: supported. The Part tab, the viewport slider and settings are shared web
  code. "Open in slicer" appears only when the desktop app is connected to its own local
  environment; elsewhere the same place offers "Download 3MF".
- Mobile: not supported. Mobile has no 3D panel.
- Remote: works on every connection mode. The slicer runs on the environment host; results
  are small JSON over the WebSocket; the layer file and sliced project are fetched through the
  signed file route, never the WebSocket.
- Upstream T3 server: no 3D panel, as today.

## Extension points used

None new. Reuses L23's `ext-panels` (the 3D panel and Part tab), `ext-settings` (the 3D model
section), `ext-mcp` (model tools), the model editor command over `ext-core`, and the fork RPC
scope tables.

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None in Loom. 3MF output is read with `yauzl`, which the server already uses
(`apps/server/src/fork/model-preview-3d/threeMfUnits.ts:3`). The slicer itself is a host
program the user installs; Loom never installs it.

## Relationship to other follow-up packets

- L35 (lay flat): with it, the saved orientation is applied to the mesh before slicing and
  is part of the cache key. Without it, the part is sliced as modelled with `--orient 0`.
- L51 (printer library): with it, mappings can target user printers, and the printer's
  material supplies density and price for grams and cost. Without it, mappings use built-in
  bed ids and cost comes from the filament profile's `filament_cost` when non-zero. L51 and
  L47 share `slicer/profiles.ts` (profile roots and flattening); whichever lands first creates
  it as written in TECHNICAL.md.
- L34 (nozzle zones): the slicer applies the real zone rules; a slicer warning about a nozzle
  area is shown as is.
- L46 (print check): independent. L46 judges printability from the mesh; L47 asks the slicer.
- L50 (Python CAD): with it, build123d sources slice through their rendered mesh and STEP
  through its tessellated mesh, both by revision.
- L40 (units): lengths and filament length use `formatLength` once it exists.
- L32 (bed fit): independent. The slicer's own "outside the plate" flag is reported as a
  warning.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): CLI flags, output formats and sources.
