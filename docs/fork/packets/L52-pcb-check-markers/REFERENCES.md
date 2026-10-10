# L52 references

Sources for this packet. Treat external repositories as references, not code to copy.

## Old Loom

No direct predecessor. L24's Checks view and Locate button
(`apps/web/src/fork/pcb-preview/ChecksView.tsx:346-377`) are the starting point. The shared
"Finding markers" definition comes from [PCB-FOLLOW-UPS.md](../PCB-FOLLOW-UPS.md).

## Current Loom source

- Report parsing and bounds: `apps/server/src/fork/pcb-preview/kicadReports.ts:4-82`.
- Check run, flags and persistence:
  `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1056-1169`.
  Loom always passes `--units mm` (`:1084-1085`), so the unit conversion in this packet guards
  stored or future reports; the ERC scale fix is the change users will notice.
- Sheet id naming: `PcbPreviewService.ts:1415-1478`.
- Check contracts: `packages/contracts/src/fork/pcb-preview.ts:135-178`.
- Editor action and snapshot state: `packages/contracts/src/fork/pcb-workspace.ts:300-380`.
- Overlay layer and viewport: `apps/web/src/fork/pcb-preview/SvgViewport.tsx:116-174`, `:432-443`.
- Existing overlays: `apps/web/src/fork/pcb-preview/Overlays.tsx:3-92`.
- Panel focus, pick, keys, editor requests:
  `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx:190-204`, `:240-263`, `:371-571`, `:1041-1068`.
- Report fixtures: `apps/server/src/fork/pcb-preview/fixtures/` (KiCad 10.0.6,
  `demos/complex_hierarchy`).

## External

- KiCad 9.0 `eeschema/erc/erc_report.cpp`, `WriteJsonReport` builds its `UNITS_PROVIDER` with
  `pcbIUScale`: <https://gitlab.com/kicad/code/kicad/-/blob/9.0/eeschema/erc/erc_report.cpp>.
  Verified by reading the file. GPL-3.0; read only, nothing reused.
- KiCad 10.0.7 release notes, "Fix ERC JSON report using wrong unit scale. #25582", published
  2026-10-07: <https://www.kicad.org/blog/2026/10/KiCad-10.0.7-Release/>. Verified.
- Konnect issue 541, the same bug seen from a KiCad MCP server, with the version rule this
  packet uses (multiply by 100 below 10.0.7, never for DRC):
  <https://github.com/mixelpixx/Konnect/issues/541> and the fix
  <https://github.com/mixelpixx/Konnect/pull/675>. Konnect reports that 8.0.0 carries the same
  line; not needed here because Loom requires KiCad 9.
- KiCad JSON report schemas (`coordinate_units` is `"mm"`, `"mils"` or `"in"`; items have
  `description`, `pos`, `uuid`; ERC sheets have `path` and `uuid_path`):
  <https://gitlab.com/kicad/code/kicad/-/tree/master/resources/schemas> (`erc.v1.json`,
  `drc.v1.json`). Verified in the previous research pass; the fixtures match.
- KiCad CLI `sch erc` and `pcb drc` options (`--units`, `--format json`):
  <https://docs.kicad.org/9.0/en/cli/cli.html>.
- Inch and mil factors: 1 in = 25.4 mm exactly (international inch, 1959), 1 mil = 0.001 in.
- Prior art for stepping through findings: KiCad's own DRC and ERC dialogs select a marker and
  zoom to it, with markers drawn on the canvas; this packet copies that flow, not code.
