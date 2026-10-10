# L51: Printer library

Status: Needs decision: library storage and the bed setting change.

Approved by Kyle on 2026-10-10.

Beds are a fixed table in code today, and L33 adds a short list of named custom sizes in
settings. This packet turns them into a printer library: one list of printers and surfaces with
a size, bed shape, nozzle sizes, materials, optional nozzle zones and notes. The built-in
printers ship as data and can be hidden or duplicated; your own entries can be added, edited,
duplicated and deleted in Loom settings. A printer can be imported from a Bambu Studio or
OrcaSlicer machine profile (JSON) or a PrusaSlicer config (INI), so the size, nozzle and zones
come from the slicer instead of being typed. Materials carry a type, density and cost per
kilogram, which L47 uses for print cost and grams. Every bed menu, fit check and agent tool
keeps working because they all read beds through the same two functions.

## Scope

- In:
  - A printer and material schema in contracts, with the 10 built-in printers and 4 built-in
    surfaces moved from `BUILD_PLATE_PRESETS` into a `BUILT_IN_PRINTERS` data table, plus
    five generic built-in materials.
  - User entries stored on the environment host, with optimistic versioning.
  - Loom settings, 3D models: a "Printers" area (list, add, edit, duplicate, hide, delete) and
    a "Materials" area.
  - Import from a Bambu Studio or OrcaSlicer machine JSON and a PrusaSlicer INI, from a file
    picked in the browser. Export and import of the whole library as one JSON document.
  - A one-time migration of L33's custom beds and hidden presets, and of the single custom
    size, so nothing the user saved is lost and old ids keep resolving.
  - Bed menus, the Part tab, L32's fit list, L34's zones and the agent tools reading the
    library through `listBeds`, `bedGroups` and `resolvePlate`.
  - MCP tools to read and update the library.
- Out:
  - Sending anything to a printer, printer status or network discovery. Loom never talks to a
    printer.
  - Filament inventory (spools, remaining grams). Materials here are types with a price.
  - Reading the slicers' installed profile folders to list every vendor printer. Import takes
    one file the user picks; L47 reads installed slicer profiles for slicing.
  - Per-printer bed textures or 3D bed models. The viewer keeps drawing the plate and grid.
  - Mobile UI.

## Surfaces

- Web and desktop: supported, in Loom settings and every existing bed menu.
- Mobile: not supported. Mobile has no 3D panel and no 3D model settings.
- Remote: works on every connection mode. The library is a few kilobytes over the existing
  WebSocket RPC; profile files are read in the browser and sent as text, so a remote browser
  imports a file from its own machine.
- Upstream T3 server: no 3D panel or settings section, as today.

## Extension points used

None new. Reuses L23's `ext-settings` (the 3D model section), `ext-mcp` (model tools), the
fork RPC group with `ext-core`, and the RPC scope tables in `rpcAuthorization.ts` and
`clientRpcPermissions.ts`.

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. INI and JSON parsing are a few lines of TypeScript.

## Relationship to other follow-up packets

- L32 (bed fit): its fit list and agent fit summary call `listBeds`. With L51 they list
  library entries; the 64-bed cap in `BedFitSummary` stays and the library limit matches it.
- L33 (custom beds): L51 supersedes its storage. The migration imports every `customBeds`
  entry with the same id, so `customBedId` stays valid, and copies `hiddenPresets` into the
  library. If L33 has not landed, L51 adds `customBedId` exactly as L33 defines it and skips
  that part of the migration.
- L34 (nozzle zones): the built-in H2D and H2C keep the `zones` L34 adds, including its
  optional `heightMm`. L51 makes zones editable on user printers. Without L34, zones are
  stored and imported but nothing draws them.
- L46 (print check): reads the active printer's nozzle size and material when present.
- L47 (slicing): its profile mapping is keyed by bed id, so user printers can be mapped too.
  Materials supply density and cost per kilogram for grams and cost. With L47 landed, the
  importer also offers to record the imported profile as that printer's slicer mapping.
- L40 (units): sizes in the printer editor use `formatLength` once it exists.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): profile formats, built-in data sources and prior art.
