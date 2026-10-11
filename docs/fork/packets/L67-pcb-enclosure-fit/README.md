# L67: PCB enclosure fit

Status: Implemented locally on `feat/pcb-units-presets-stats-print-capture` (2026-10-11).

Both phases are implemented. Case files live beside the design, fit requirements live in the
version 2 assembly, and mounting holes include plated KiCad MountingHole pads. See
[TESTING.md](./TESTING.md) for verification and remaining real-client/CAD checks.

Approved by Kyle on 2026-10-10.

A board is only done when it fits its case. This packet puts the 3D board from the PCB panel and
a case model into one L48 assembly and checks the four things that usually go wrong: the board
outline against the inner walls, the tallest parts against the lid and floor, edge connectors
against the wall cut-outs, and the mounting holes against the standoffs. Each result says which
side, part, connector or hole, by how much, and where in 3D. When there is no case yet, "Generate
case" writes a parametric starter from the board itself: an OpenSCAD tray and lid that follow
the board outline, with standoffs under the mounting holes, room for the tallest parts and
cut-outs for edge connectors, plus a build123d version when Python CAD (L50) is available. The
starter opens in the 3D model panel already assembled with the board, so tuning a wall in the
customizer and checking again is one loop for the user and for an agent. Loom never orders a
case, never sends anything to a printer and never uploads to a fab.

## Scope

- In:
  - Reference metadata version 2 from `loom_pcb_export_reference`
    (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:2392-2463`): board kind, outline
    loops and a workspace-relative path, still readable when version 1 files are met.
  - Board features computed from the reference GLB and its metadata on the host: board frame,
    board body faces, per-part boxes and sides, outline, holes and edge connectors.
  - A case starter generator (`loom_pcb_enclosure`, `t3 pcb enclosure`): `case.scad` always,
    `case.b3d.py` when the server advertises `model-python-cad`, and the board's assembly file.
  - An `enclosure` section in L48's assembly file (version 2), four new assembly operations
    (`set-enclosure`, `clear-enclosure`, `place-board`, `swap-board`) and enclosure
    results in L48's fit check.
  - An "Enclosure" tab appended to the PCB inspector, and an enclosure section in the model
    panel's Fit tab with pins and "Apply suggested move".
  - Two inspection fixes the checks depend on: plated mounting holes and Edge.Cuts loops
    (`apps/server/src/fork/pcb-preview/semantics.ts:92-94,145-158`).
- Out:
  - Snap fits, vents, hinges, text or logos in the starter. The starter is a tray, a lid and
    screw bosses; anything else is the user's or agent's edit to the generated source.
  - Panel-mount parts that are not on the board (switches, displays in the lid).
  - Thermal, drop or tolerance-stack analysis. Clearances are geometric.
  - Dedicated STEP output of the case. L50's existing Python CAD export handles generated
    build123d cases; the optional Fabrication app remains available for other workflows.
  - Mobile. Mobile has no PCB panel and no 3D model panel.

## Surfaces

- Web and desktop: PCB inspector "Enclosure" tab, the model panel Fit tab for assemblies, and
  the "…" menu's existing "Export board reference…" item.
- Agents: `loom_pcb_enclosure` (new), `loom_pcb_export_reference`, `loom_pcb_editor`
  `open-tools` with `name: "Enclosure"`, and L48's `loom_model_preview_3d_assembly_update` and
  `loom_model_preview_3d_assembly_check`. The CLI follows as `t3 pcb enclosure` and
  `t3 model assembly_check` through the generic mappers (`pcb-preview/cli.ts:14` and
  `model-preview-3d/cli.ts:13` under `apps/server/src/fork/`).
- Mobile: none. Remote clients work unchanged: every byte reaches the viewer through the existing
  signed file routes, and the checks run on the environment host.

## Extension points used

- L24's capability gate, panel, inspector rail, MCP toolkit (`PcbToolkit`,
  `apps/server/src/fork/pcb-preview/mcp.ts`), RPC group and `t3 pcb` CLI.
- L23's model panel and `forkPanelSurface("model-preview-3d", path)` to open the assembly, as
  the hardware library already does (`apps/web/src/fork/pcb-preview/HardwareLibrary.tsx:208`).
- `LOOM_SERVER_FEATURES` (`apps/server/src/fork/features.ts:2-11`): adds `pcb-enclosure-fit`.

## Packet seams

None upstream. Fork-owned shared files are listed in [SEAMS.md](./SEAMS.md).

## New dependencies

None. The generated files need OpenSCAD (already used by L23) and, for the Python file, L50's
build123d environment. Loom does not install either.

## Relationship to other follow-up packets

| Packet                                                       | With it                                                                                                                                                | Without it                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [L48](../L48-model-assemblies/) assemblies                   | Generate writes `<stem>.loom-assembly.json`; "Check fit" and "Use an existing case" work.                                                              | Generate writes only `case.scad`, opening with `part = "fit"`, which renders the case with a board proxy so the fit is visible. "Check fit" and "Use an existing case" are hidden, and `loom_pcb_enclosure` reports "Fit checks need 3D assemblies, which this Loom server does not have." for `check: true`. |
| [L46](../L46-model-print-check/) print check                 | L48's worker and grid are L46's.                                                                                                                       | L48 brings them; L67 adds nothing.                                                                                                                                                                                                                                                                            |
| [L50](../L50-model-python-cad/) Python CAD                   | "Also write build123d" appears; `case.b3d.py` opens in the model panel. With Python not set up, the file is still written and L50's setup state shows. | The option is hidden and `build123d: true` fails with "Python CAD files need a Loom server with build123d support."                                                                                                                                                                                           |
| [L55](../L55-pcb-board-stats/) board stats                   | Reuses `readGlbBounds` and Edge.Cuts loops; the tab shows `tallest` from stats.                                                                        | L67 creates `readGlbBounds` in `glb.ts` and `outline.ts` exactly where L55 specifies; L55 reuses them.                                                                                                                                                                                                        |
| [L61](../L61-pcb-3d-tools/) 3D tools                         | Same frame-fit rule and part naming rules, so heights agree with the 3D board view.                                                                    | No effect: the server computes its own heights.                                                                                                                                                                                                                                                               |
| [L40](../L40-model-units/), [L54](../L54-pcb-units/) units   | Lengths go through their formatters.                                                                                                                   | Millimetres with one decimal.                                                                                                                                                                                                                                                                                 |
| [L32](../L32-model-bed-fit/), [L51](../L51-printer-library/) | The starter's parts can be checked on a bed like any model.                                                                                            | No effect.                                                                                                                                                                                                                                                                                                    |

Order: build after L48. If L48 has not landed, build phase A (the starter) and leave phase B
(fit checks) open in the tracking issue; phase B lands with or after L48.

## Documents

- [PRODUCT.md](./PRODUCT.md): what the user sees and the decisions.
- [TECHNICAL.md](./TECHNICAL.md): contracts, server, worker, clients, tools.
- [SEAMS.md](./SEAMS.md): shared files touched.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps and done criteria.
- [TESTING.md](./TESTING.md): tests, commands and manual checks.
- [REFERENCES.md](./REFERENCES.md): KiCad, OpenSCAD and build123d facts with sources.
