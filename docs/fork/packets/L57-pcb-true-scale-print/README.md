# L57: True-scale printout

Status: Ready to build

Approved by Kyle on 2026-10-10.

Kyle can print a board at exactly 1:1 and lay real parts on the paper before ordering. The
PCB panel's **…** menu gets "Print at 1:1…", which makes a PDF of the top or bottom of the
board with copper, silkscreen, courtyards and the outline. Every page carries a 50 mm scale bar,
the board's outline size and the line "Print at 100%, not Fit to page", so a ruler confirms the
printer did not shrink it. The PDF downloads to the client, or is saved into the workspace and
opened on the host. Agents make the same PDF with `loom_pcb_print` or `t3 pcb print`.

## Scope

- In:
  - A PDF of chosen layers at 1:1 through `kicad-cli pcb export pdf --mode-single`, top or
    bottom. Bottom is mirrored by default, with a toggle.
  - Default layers: top is `F.Cu, F.Silkscreen, F.Courtyard, Edge.Cuts`; bottom uses the `B.`
    layers and `Edge.Cuts`. The dialog can add or remove any board layer.
  - A generated drawing sheet with a 50 mm by 10 mm scale bar, 10 mm ticks, the board outline
    size and the 100% hint. Nothing is drawn into the board.
  - Paper: the board's own page, A4, US Letter, A3 or US Ledger. A temporary copy of the board
    gets the chosen paper; the user's files are never written.
  - Black and white by default, so light silkscreen colours stay visible on white paper.
  - Download through a signed URL on every connection mode; "Save to workspace" writes
    `fab/print/<design>-<side>-<rev>.pdf`; "Open" and "Show in folder" act on the host.
  - tscircuit boards: exported to a temporary `.kicad_pcb` with `tsci export -f kicad_pcb`, then
    printed by KiCad. Needs both tools, and the panel asks for trust first as it does to render.
  - MCP tool `loom_pcb_print`, and therefore `t3 pcb print`.
- Out:
  - Printing from Loom (the system print dialog does that), page tiling for boards larger than
    the paper, and fabrication drawings (L65 makes the assembly drawing).
  - Both sides in one file. Each side is its own PDF; merging needs a PDF library.
  - Mobile.

## Surfaces

- Web and desktop: supported. Desktop downloads go through Electron's normal save flow.
- Mobile: not supported. Mobile has no PCB panel.
- Remote: works over LAN, Tailscale and T3 Connect. PDF bytes travel over the signed HTTP route,
  never the WebSocket. "Open" and "Show in folder" act on the environment host, as the
  workspace file menu already does; a remote browser uses Download.

## Extension points used

None new. Reuses L24's registrations: `ext-panels` (the PCB panel and its **…** menu),
`ext-mcp` and `ext-cli` (`loom_pcb_*` tools and `t3 pcb`), and the PCB signed HTTP route that
L24 registers through `ext-core`.

## Packet seams

None. Every file is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. KiCad 9 or newer must be installed on the environment host, as for L24.

## Relationship to other follow-up packets

- L65 (fab package): both write under the workspace `fab/` folder and both widen the signed
  file route. Whichever lands first adds `SIGNED_FILE_TYPES` and the `fab/` source-scan
  exclusion; the second adds one map entry. Without L65, nothing else changes.
- L54 (units): with it, the dialog shows the board size in the chosen unit. The printed text
  stays in millimetres because the scale bar is metric. Without it, millimetres everywhere.
- L56 (layer presets): with it, the dialog offers its presets (`PCB_LAYER_PRESETS` and
  `resolveLayerPreset` in `packages/contracts/src/fork/pcb-layer-presets.ts`) as quick picks
  beside the defaults, and `layers` accepts a preset id. Without it, only the defaults above
  and the checkbox list.
- L62 (capture export) and L44: unrelated; captures are screen images, not to scale.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
