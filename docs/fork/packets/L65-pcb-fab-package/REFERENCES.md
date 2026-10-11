# L65 references

Pages read on 2026-10-10. KiCad and tscircuit are not installed on the machine where this packet
was written, so no command was executed locally; every flag below is from official docs.

## Prior art

- Fabrication Toolkit (bennymeg, KiCad plugin, Apache-2.0): one-click JLCPCB package with BOM,
  CPL, rotation corrections from `rotations.cf` and per-part fields (`FT Rotation Offset`,
  `Rotation Offset`, `RotOffset`, `FT Position Offset`), and a list of LCSC field names. JLCPCB's
  own KiCad 10 guide recommends it. L65 borrows the field names, not code.
  <https://github.com/bennymeg/Fabrication-Toolkit>
- KiBot and KiKit: CI-oriented output generators for KiCad; much broader than needed here.
- tracespace viewer: browser Gerber viewer built on `pcb-stackup`. <https://tracespace.io>
- The Electronics app plan (`~/Developer/docs/apps/electronics/`) describes a build script and a
  CPL conversion for JLCPCB. Research only.

## Verified facts

### kicad-cli, KiCad 10.0 (docs built from 10.0.7) <https://docs.kicad.org/10.0/en/cli/cli.html>

- `pcb export gerbers`: `-o` (directory), `-l/--layers` (all layers when omitted), `--cl`,
  `--no-x2`, `--no-netlist`, `--disable-aperture-macros`, `--use-drill-file-origin`,
  `--precision 5|6`, `--no-protel-ext`, `--board-plot-params`, `--check-zones`, `--variant`.
- `pcb export drill`: `--format excellon|gerber`, `--drill-origin absolute|plot`,
  `--excellon-zeros-format decimal|...`, `--excellon-oval-format route|alternate` (default
  alternate), `-u mm|in` (default mm), `--excellon-mirror-y`, `--excellon-min-header`,
  `--excellon-separate-th`, `--generate-map`, `--map-format`, `--generate-report`,
  `--report-path`, `--generate-tenting`, `--gerber-precision`.
- `pcb export pos`: `--side front|back|both`, `--format ascii|csv|gerber`, `--units in|mm`
  (default in), `--bottom-negate-x`, `--use-drill-file-origin`, `--smd-only`, `--exclude-fp-th`,
  `--exclude-dnp`, `--gerber-board-edge`, `--variant`.
- `sch export bom`: `--preset`, `--format-preset`, `--fields`, `--labels`, `--group-by`,
  `--sort-field`, `--sort-asc`, `--filter`, `--exclude-dnp`, `--field-delimiter`,
  `--string-delimiter` (no quoting by default), `--ref-delimiter`, `--ref-range-delimiter`,
  `--keep-tabs`, `--keep-line-breaks`. `--include-excluded-from-bom` is deprecated and has no
  effect in 10.
- `pcb export pdf`: see L57 REFERENCES.md (`--mode-single`, `--mirror`, `--black-and-white`,
  `--include-border-title`, `--check-zones`).
- `pcb drc`: `--refill-zones` exists in 10; `--save-board` only with it.
- Top-level commands are `fp`, `jobset`, `pcb`, `sch`, `sym`, `version`; there is no Gerber
  viewer command. `pcb render` makes raytraced PNG or JPEG images only.

### kicad-cli, KiCad 9.0 (docs built from 9.0.9) <https://docs.kicad.org/9.0/en/cli/cli.html>

- `pcb export gerbers` has no `--check-zones`; `pcb drc` has no `--refill-zones`. The BOM
  default fields are `Reference,Value,Footprint,${QUANTITY},${DNP}`.

### JLCPCB

- KiCad Gerber guide (written for KiCad 9.0.4): layers F/B.Cu, F/B.Mask, F/B.Silkscreen,
  Edge.Cuts (mandatory), paste layers for assembly, inner layers; Protel extensions, X2 and
  netlist attributes on, scale 1:1, refill zones; drill as Excellon, absolute origin, mm,
  decimal, separate PTH and NPTH files. The uploader accepts one zip or rar.
  <https://jlcpcb.com/help/article/how-to-generate-gerber-and-drill-files-in-kicad-9>
- BOM: columns Comment, Designator, Footprint, in CSV, XLS or XLSX.
  <https://jlcpcb.com/help/article/bill-of-materials-for-pcb-assembly>
- CPL: Designator, Mid X, Mid Y, Layer (Top or Bottom), Rotation (counter-clockwise positive),
  millimetres. <https://jlcpcb.com/help/article/pick-place-file-for-pcb-assembly>
- KiCad 10 BOM and CPL guide (checked on KiCad 10.0.3): adds an `LCSC Part #` field (also seen as
  `JLCPCB Part #`), renames KiCad's position columns, and points to Fabrication Toolkit for
  rotations. JLCPCB documents no rotation table of its own.
  <https://jlcpcb.com/help/article/how-to-generate-the-bom-and-centroid-file-from-kicad>

### tscircuit

- `tsci export -f` formats include `gerbers` (zipped), `assembly-svg`, `circuit-json`,
  `kicad_pcb` and others; flags `-o`, `--disable-parts-engine`, `--show-courtyards`, `--layer`.
  `@tscircuit/cli` 0.1.2292. <https://docs.tscircuit.com/command-line/tsci-export>
- The fabrication guide says the export UI's fabrication zip holds Gerbers (with drill and
  cutouts), a BOM CSV and a pick-and-place CSV.
  <https://docs.tscircuit.com/guides/understanding-fabrication-files>

### Gerber renderers (npm, read 2026-10-10)

- `pcb-stackup` 4.2.8, MIT, tracespace, last published 2022-06; depends on `gerber-to-svg`,
  `pcb-stackup-core`, `whats-that-gerber`, `readable-stream` 3 (through `gerber-to-svg`), and
  lists `@types/node` ^13 as a runtime dependency. About 24,300 downloads in the month to
  2026-10-09. The tracespace v5 alpha (2023) was declared on indefinite hiatus by its maintainer.
- `@sctg/pcb-stackup` 5.1.6, MIT, a fork published 2026-05 by one maintainer; uses
  `readable-stream` 4. About 480 downloads in the same month.
- `jszip` 3.10.1 is already an `apps/web` dependency; `yauzl` ^3.4.0 is already an `apps/server`
  dependency (`apps/server/src/zipArchive.ts`). The repo has no zip writer.
- Node `zlib.crc32` exists from Node 22.2; the server's engines field requires 22.16 or newer.

## Unverified, check during implementation

- Whether `pcb export pos --side both --format csv` writes one file with a side column.
- That an empty `--ref-range-delimiter` disables ranges, and the exact BOM output with
  `--string-delimiter '"'`.
- KiCad's Gerber file names (`<stem>-F_Cu.gtl` and so on) and drill file names
  (`<stem>-PTH.drl`, `<stem>-NPTH.drl`), and the Excellon file function comments.
- The DRC violation type for a broken outline.
- Contents of `tsci export -f gerbers` (whether drill and outline are included), and the Circuit
  JSON fields used for BOM and positions (`supplier_part_numbers`, `pcb_component.rotation`,
  `layer`).
- Whether JLCPCB's CPL needs any bottom-side rotation transform beyond KiCad's values; the guide
  implies not.
- Whether `pcb-stackup` 4.2.8 bundles in a Vite web worker without Node built-in polyfills.

## Licences

- `pcb-stackup` and `@sctg/pcb-stackup`: MIT; adding either needs Kyle's approval.
- Fabrication Toolkit: Apache-2.0; only field names are reused, which are facts. Bundling its
  `rotations.cf` would need its notice.
- KiCad (GPL-3.0) and tscircuit (MIT) run as separate host processes.

## Circuit JSON source check, 2026-10-11

Official source confirms `source_component.name`, `display_value`, and `supplier_part_numbers.jlcpcb`, plus `pcb_component.center`, `rotation` and `layer`. KiCad footprint names, when available, are in `pcb_component.metadata.kicad_footprint.footprintName`; `ftype` is a component type, not a footprint. Missing assembly metadata is reported for review. `pcb_board.num_layers` defaults to four in the current schema. A real CLI export remains unverified.

- <https://github.com/tscircuit/circuit-json/blob/main/src/source/base/source_component_base.ts>
- <https://github.com/tscircuit/circuit-json/blob/main/src/pcb/pcb_component.ts>
- <https://github.com/tscircuit/circuit-json/blob/main/src/common/kicadFootprintMetadata.ts>
- <https://github.com/tscircuit/circuit-json/blob/main/src/pcb/pcb_board.ts>
