# L65: Fabrication package with output preview

Status: Needs decision: approve a Gerber renderer for the output preview

Approved by Kyle on 2026-10-10.

Kyle can turn a finished board into everything a fab needs in one step, and see the outputs
before he uploads them. "Create fab package" in the PCB panel runs KiCad to produce Gerbers,
drill files, a BOM, a pick-and-place (CPL) file and top and bottom assembly drawings, zips the
Gerbers and drill files, runs DRC (and the L64 fab check when a fab is chosen), and writes it all
to `fab/<design>-<revision>-<date>/` in the workspace with a checklist that says what passed,
what failed and what still needs his eyes. An optional JLCPCB profile adds JLCPCB's BOM and CPL
column layout and applies rotation corrections. The new Fabrication tab lists packages, and
"Preview outputs" draws the produced Gerbers, not the design, so a missing layer or wrong outline
shows before the order. Loom never uploads or orders. Agents create packages with
`loom_pcb_fab_package` and read the checklist.

## Scope

- In:
  - KiCad boards: Gerbers (explicit layer list, X2 attributes), Excellon drill files (separate
    plated and non-plated), positions CSV, BOM CSV (from the schematic, or from board
    footprints when there is no schematic), assembly PDFs, DRC and ERC reports.
  - A zip of Gerbers and drill files, written by a small in-house writer on Node's `zlib`.
  - JLCPCB profile: `jlcpcb/bom.csv` (Comment, Designator, Footprint, LCSC Part #) and
    `jlcpcb/cpl.csv` (Designator, Mid X, Mid Y, Layer, Rotation) with rotation corrections from
    per-part fields and an optional `fab/rotations.csv`.
  - Checklist with a verdict: ready, needs review, or not ready.
  - Output preview: the packaged Gerbers rendered to SVG in a web worker, top and bottom
    composites and single layers, view only.
  - tscircuit boards through `tsci export -f gerbers`, with BOM and CPL built from Circuit JSON
    and the assembly drawing from `tsci export -f assembly-svg`. No DRC.
  - A new Fabrication inspector tab, a **…** menu item, MCP tools `loom_pcb_fab_package` and
    `loom_pcb_fab_packages`, and therefore `t3 pcb` actions.
- Out:
  - Uploading, ordering, quoting, or any network call. Panelisation, stencil frames, impedance
    notes, IPC-2581, ODB++ and STEP. A bundled part rotation table (see decisions).
  - Editing the design to fix problems; the checklist says what to fix and the agent does it.
  - Mobile.

## Surfaces

- Web and desktop: supported. The preview worker runs in the browser or desktop renderer.
- Mobile: not supported. Mobile has no PCB panel.
- Remote: works over LAN, Tailscale and T3 Connect. KiCad runs on the environment host, the
  package is written to the host's workspace, and the zip reaches the client over the signed
  HTTP route for download and preview. "Show in folder" acts on the host.

## Extension points used

None new. Reuses L24's `ext-panels` (inspector tab, **…** menu, canvas), `ext-mcp`, `ext-cli`
and the PCB signed HTTP route.

## Packet seams

None. Every file is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

Pending Kyle's approval: `pcb-stackup` 4.2.8 (MIT, tracespace) in `apps/web` only, for the
Gerber preview. Without it, everything else ships and the preview falls back to KiCad's board
SVG of the packaged layers, labelled as a board plot rather than a Gerber render. See PRODUCT.md.

## Relationship to other follow-up packets

- L64 (fab check): with it, a chosen fab adds a fab check to the checklist, and the dialog
  offers the fab picker. Without it, the fab item is skipped and the checklist says so.
- L57 (true-scale print): shares the `fab/` folder, the `fab` source-scan exclusion and the
  signed file table. Whichever lands first creates them; the second adds a row.
- L56 (layer presets): no dependency. The assembly drawings use fixed layers.
- L55 (board stats): with it, the checklist's hole and layer facts come from `boardStats`.
  Without it, they come from the produced Gerber and drill files.
- L54 (units): with it, sizes in the tab use the chosen unit. Output files are always
  millimetres.
- L52 (check markers): DRC findings from packaging update the Checks tab like a normal DRC run.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
