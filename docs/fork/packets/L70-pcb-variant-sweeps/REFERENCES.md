# L70 references

## Prior art

- **L23 variant workbench** (`apps/web/src/fork/model-preview-3d/VariantsInspector.tsx:700-1311`,
  `variants.ts:23-46`, server `ModelPreviewService.ts:933-970`, agent tool
  `apps/server/src/fork/model-preview-3d/mcp.ts:162-180`). Sweeps over up to two parameters,
  sequential batch with cancel, thumbnails, side by side comparison, promotion and agent
  proposals. This packet keeps its flow, wording and kept limit, and lowers the per-sweep limit
  for slower builds.
- **CAD configuration tables.** Mechanical CAD tools let one part carry several named value sets
  and switch between them. Cited only as the familiar pattern behind saved variants; not verified
  for any specific product here.

## Facts relied on

- `tsci export <file> -f <format>` supports `circuit-json` and `pcb-svg`, among others. Verified:
  [tsci export](https://docs.tscircuit.com/command-line/tsci-export). L24 already runs both, with
  the second reading the first's JSON (`PcbPreviewService.ts:828-923`).
- Circuit JSON defines error and warning elements by type name, for example
  `pcb_autorouting_error`, `pcb_footprint_overlap_error`, `pcb_component_outside_board_error` and
  `pcb_keepout_overlap_warning`. Verified in the type union at
  [circuit-json `src/any_circuit_element.ts`](https://github.com/tscircuit/circuit-json/blob/main/src/any_circuit_element.ts).
  That a plain `tsci export -f circuit-json` includes every such element the build produced is
  not documented; step 5's real-tool run confirms which appear. The column is labelled "Issues",
  not DRC, so it never claims more than the export reports.
- [@tscircuit/checks](https://github.com/tscircuit/checks) runs placement, routing, netlist and
  pin checks over Circuit JSON and returns typed `_error` and `_warning` elements. Not used here:
  it would be a new dependency, and whether `tsci` runs it during export is unverified. A later
  packet could add it if counts prove too sparse.
- No published tscircuit build times were found in the tscircuit docs or repositories. The 5 to
  30 s per candidate estimate in TECHNICAL.md is unverified and is replaced by step 1's
  measurement.

## Licences

- tscircuit: MIT ([repository](https://github.com/tscircuit/tscircuit)). Run as the external
  `tsci` program L24 already requires; no code copied.
- circuit-json: ISC per its `package.json`. Only its element type names are relied on.
- @tscircuit/checks: no licence file or `license` field found; not used.
- No new dependency and no third-party code in this packet.
