# PCB follow-up packets

Kyle reviewed a list of improvement ideas for the PCB panel ([L24](./L24-pcb-preview/)) on
2026-10-10 and selected 19 of them for implementation, L52 to L70. Several borrow from the 3D
follow-ups in [MODEL-3D-FOLLOW-UPS.md](./MODEL-3D-FOLLOW-UPS.md). Each is its own packet that
one agent can build without the others. This page holds the rules they share.

Kyle left out two ideas from that list: simulation results drawn on the schematic, and parts
sourcing with an inventory-aware BOM (including a standalone BOM view). Do not build them as
part of these packets. Mobile PCB review and large-board performance work were not proposed.

## The packets

| ID  | Packet                                                | What the user gets                                                               |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| L52 | [`pcb-check-markers`](./L52-pcb-check-markers/)       | ERC and DRC findings drawn on the drawing, with next and previous finding keys.  |
| L53 | [`pcb-pin-map`](./L53-pcb-pin-map/)                   | A pin table for an MCU or connector, copied or generated as firmware constants.  |
| L54 | [`pcb-units`](./L54-pcb-units/)                       | One display unit (mm, mil, in) across the panel; Locate works in every unit.     |
| L55 | [`pcb-board-stats`](./L55-pcb-board-stats/)           | Board size, layers, counts, smallest features and tallest component at a glance. |
| L56 | [`pcb-layer-presets`](./L56-pcb-layer-presets/)       | Built-in layer sets for assembly, copper, fab review and silkscreen.             |
| L57 | [`pcb-true-scale-print`](./L57-pcb-true-scale-print/) | A 1:1 printable PDF with a scale bar for checking footprints against real parts. |
| L58 | [`pcb-auto-checks`](./L58-pcb-auto-checks/)           | Optional ERC and DRC after every save, with new and resolved counts.             |
| L59 | [`pcb-follow-agent`](./L59-pcb-follow-agent/)         | Designs the agent wrote or changed in a turn are offered for opening.            |
| L60 | [`pcb-change-highlight`](./L60-pcb-change-highlight/) | What changed after a reload, highlighted on the drawing.                         |
| L61 | [`pcb-3d-tools`](./L61-pcb-3d-tools/)                 | Orthographic view, section, measuring, heights and layer toggles in 3D.          |
| L62 | [`pcb-capture-export`](./L62-pcb-capture-export/)     | Copy a capture, or save it as PNG or SVG.                                        |
| L63 | [`pcb-viewport-access`](./L63-pcb-viewport-access/)   | Screen reader announcements and keyboard flow through the panel.                 |
| L64 | [`pcb-fab-check`](./L64-pcb-fab-check/)               | Fab capability presets and a manufacturability check with cost drivers.          |
| L65 | [`pcb-fab-package`](./L65-pcb-fab-package/)           | Gerbers, drill, BOM, CPL and an assembly drawing, with a preview of the outputs. |
| L66 | [`pcb-history`](./L66-pcb-history/)                   | Scrub, compare and restore a design across the thread's turn checkpoints.        |
| L67 | [`pcb-enclosure-fit`](./L67-pcb-enclosure-fit/)       | Check the board in its case and generate a parametric case starter.              |
| L68 | [`pcb-review-checks`](./L68-pcb-review-checks/)       | Schematic review heuristics that catch mistakes ERC misses.                      |
| L69 | [`pcb-change-requests`](./L69-pcb-change-requests/)   | Notes become anchored change requests with agent hand-off, accept and reopen.    |
| L70 | [`pcb-variant-sweeps`](./L70-pcb-variant-sweeps/)     | Sweep tscircuit parameters into a thumbnail grid, compare and promote.           |

## What they build on

- **Base.** L24 as shipped on `main`. Defect fixes found while writing these packets are on the
  local `fix/preview-defects` branch (`6ddf84c1aa` and `f4941963a6` for PCB); until it merges,
  start packet branches from it. Packets that borrow from a 3D follow-up name it and say how
  they behave when it has not landed.
- **Code location.** Code goes in L24's directories (`apps/web/src/fork/pcb-preview/`,
  `apps/server/src/fork/pcb-preview/`, `packages/contracts/src/fork/pcb-preview.ts` and
  `pcb-workspace.ts`). They reuse L24's capability (`pcb-preview`), panel, settings, palette and
  `loom_pcb_*` MCP and `t3 pcb` CLI registration, so most need no upstream seam.
- **Agent parity.** L24 promises MCP and CLI parity. A user action added here is also an MCP
  action (a `loom_pcb_*` tool or an editor command) and therefore a `t3 pcb` action.
- **Host tools.** KiCad (`kicad-cli`), tscircuit (`tsci`) and ngspice run on the environment
  host, detected as L24 does, never installed by Loom. Outputs reach clients through the signed
  HTTP route, never the WebSocket.
- **Surfaces.** Web and desktop. Mobile has no PCB panel. Remote use must keep working.
- **Dependencies.** No new production dependency without Kyle's approval.
- **Commits** use the packet slug: `feat(fork-pcb-pin-map): copy a pin map for firmware`.

## Shared touch points

- `PcbPreviewPanel.tsx` key handler: one `else if` line per new key, from the table below.
- `Overlays.tsx` and `SvgViewport.tsx`: new overlay layers go in their own components
  (`CheckMarkers.tsx`, `ChangeHighlights.tsx`, `RequestPins.tsx`), added side by side.
- `Inspector.tsx` rail and `InspectTab.tsx`: append tabs and sections; do not reorder.
- `PcbPreviewService.ts` is already large (about 2,600 lines). New server work goes in new
  files beside it (`pinMap.ts`, `boardStats.ts`, `fabCheck.ts`, `fabPackage.ts`,
  `reviewChecks.ts`) with only a call site added to the service.
- Settings and workspace entities use decoding defaults so older saved state still loads.
  Commit `6ddf84c1aa` (local `fix/preview-defects`) gives `PcbWorkspace` and the preferences
  empty defaults and adds a strict `PcbWorkspaceInput` for saves, so a save that leaves out a
  collection fails instead of erasing it. Every new field brings its own default and is added
  to both schemas. If that commit is not on your base, the first packet that adds a workspace
  field makes the same split.
- Signed files (implemented by L57): `SIGNED_FILE_TYPES` in `cache.ts` defines the content
  types and byte limits for `board.glb` and `print.pdf`. `signCacheFile` signs either cached
  output, and `http.ts` serves its matching content type. L65 extends the existing table for
  its generated outputs. The design's `fab/` folder is excluded from `sourceSnapshot`, so a
  package or print never changes the design's source hash.
- `captureSheet.ts` `thumbnail`: L69 and L70 both add an optional size `limit`. Whichever lands
  second skips that edit.

## Keyboard shortcuts

Panel keys today: `1`-`3` surfaces, `I` tools, `V` select, `M` distance, `A` angle, `N` note,
`Escape`, `F` or `0` fit, `+`/`-` zoom, arrow keys pan, `Alt` held to skip pad snapping, and the
**?** shortcut list. New keys:

| Key         | Packet | Action                                    |
| ----------- | ------ | ----------------------------------------- |
| `.` and `,` | L52    | Next and previous finding                 |
| `C`         | L52    | Show or hide finding markers              |
| `D`         | L60    | Show or hide change highlights            |
| `T`         | L66    | Show or hide the history timeline         |
| `[` and `]` | L66    | Step to the previous or next version      |
| `P`         | L61    | Toggle perspective and orthographic in 3D |
| `R`         | L69    | Request a change at the selection         |

Update the **?** shortcut list with each new key. Add rows here before using any other key.
After L61, `M` (measure) and `Escape` also act in the 3D board view, and the 3D view gets its own
**?** list.

## Shared definitions

Whichever packet lands first creates these exactly as written; the others reuse them.

### Finding markers (created by L52, used by L58, L64 and L68)

A finding is `{ id, source, severity: "error" | "warning" | "info", message, sheet?, layer?,
pointMm: { x, y } }` where `source` is `"erc" | "drc" | "fab" | "review"`. It is `PcbFinding` in
`packages/contracts/src/fork/pcb-workspace.ts`, written exactly as
[L52's TECHNICAL.md](./L52-pcb-check-markers/TECHNICAL.md) shows. The server converts every
position to millimetres before it reaches a finding; L54 only formats it for display. ERC
positions from KiCad before 10.0.7 are about 100 times too small. Commit `6ddf84c1aa` on the
local `fix/preview-defects` branch scales them and converts every report to millimetres; if
that commit is not on your base, whichever of L52 and L54 lands first applies the fix as
[L54](./L54-pcb-units/) specifies. `CheckMarkers.tsx`
draws any list of them; next and previous step through the visible ones in severity, then
position order. Coordinates are stored in millimetres; display goes through L54's formatter.

### Project settings (created by L58 or L68)

Per-project PCB settings (`PcbProjectSettings` in `projectSettings.ts`, with the
`loom.pcb-preview.projectSettings` and `updateProjectSettings` RPCs and the
`loom_pcb_check_settings` tool), exactly as [L58's TECHNICAL.md](./L58-pcb-auto-checks/TECHNICAL.md)
defines them. Updates merge only the fields given. L58 owns `autoChecks`; L68 adds `review`, each
with its own decoding default.

### Board stats (created by L55, used by L64 and L70)

A pure server function `boardStats` in `apps/server/src/fork/pcb-preview/boardStats.ts` works on
already-built board data (so L70 can call it on a variant that is not the saved design) and
returns size, area, copper layer count, component counts per side, hole and via counts, and the
measured minimum drill, track, via diameter and annular ring, plus the tallest component when
height data is available. Board-wide rule values, including clearance, remain separate from
measurements. The MCP inspect output includes it.

### Outline loops and GLB bounds (created by L55, used by L67)

L55 implemented `apps/server/src/fork/pcb-preview/outline.ts`: `kicadOutline` chains Edge.Cuts
items from the board and its footprints into closed loops, and `circuitOutline` reads the
tscircuit outline in the PCB drawing frame. L55 shoelaces the loops for area; L67 reuses them
for the case shape. `readGlbJson` in `glb.ts` reads a cached GLB's JSON chunk, and
`readGlbBounds` derives world-space per-mesh bounds with node names and materials for L67.
Reuse these helpers when implementing [L67](./L67-pcb-enclosure-fit/TECHNICAL.md). L67 will also
extend L48's assembly file to version 2 (`enclosure` section).

### Fab capabilities (created by L64, used by L65)

A fab capability entry: `{ id, name, tier, minTrackMm, minSpaceMm, minDrillMm, minAnnularRingMm,
minViaMm, minEdgeClearanceMm, minHoleToHoleMm, layerCounts, thicknessesMm, finishes, notes,
sourceUrl, checkedOn }`, where the edge clearance and hole-to-hole limits are null when a fab does
not publish them. Built-in entries
ship as data with a source link and a checked date, because fab limits change.

### Cross-panel pieces shared with the 3D follow-ups

These are defined by the 3D packet named, and the PCB packet reuses the same service rather
than building a second one:

- Files changed in a turn: [L41](./L41-model-follow-agent/), used by L59. The logic lives in
  `apps/server/src/fork/turnFiles.ts` (L59 TECHNICAL.md, "Shared module"), and the changed
  files card gets an `ext-changed-files` registry for both chips if Kyle approves L59's
  decision. Whichever of L41 and L59 lands first creates them.
- File versions from turn checkpoints, and restoring one file: [L49](./L49-model-history/),
  used by L66. L66 imports `history.ts`, `historyGit.ts` and the shared `historyRestore.ts`
  from `apps/server/src/fork/model-preview-3d/`, with two additive changes (a nullable
  `restoredOid` and an optional recursive `lsTree`), and adds its own
  `apps/server/src/fork/pcb-preview/designFiles.ts` for which files belong to a design.
- Copying and saving an image, with the insecure-origin fallback:
  [L44](./L44-model-capture-export/), used by L62. L62 added an optional
  `extension: "png" | "svg"` (default `"png"`) to L44's `captureFileName`.
- Live-region announcements: [L43](./L43-model-viewport-access/), used by L63. L43 defines a
  pattern rather than a module, so L63 keeps its own `announce.ts` of the same shape. Finding
  steps (L52's `.` and `,`) are announced; whichever of L52 and L63 lands second adds that line.
  Any animated pan or zoom jumps instantly under reduced motion.
- Viewer projection, section caps and snapping: [L31](./L31-model-ortho-camera/),
  [L37](./L37-model-section-caps/), [L38](./L38-model-measure-snap/), used by L61.
- Assemblies and Python CAD: [L48](./L48-model-assemblies/), [L50](./L50-model-python-cad/),
  used by L67.

If the 3D packet has not landed, the PCB packet builds that piece in the shared location the 3D
packet specifies, so the second to land reuses it.

## Relationship to the Electronics app

The Electronics app (`~/Developer/docs/apps/electronics/`) is planned but not started. It covers
tscircuit authoring, KiCad signoff, parts sourcing, costing and JLCPCB order packages. Kyle chose
on 2026-10-10 to build fab capability checks (L64) and the fabrication package (L65) in Loom.
Treat the Electronics documents as research, not a dependency. Loom never places orders, never
uploads files to a fab and never calls a parts or pricing API.

## Suggested order

Order is a suggestion, not a dependency. The first five quick wins, L54, L56, L55, L57 and
L62, are implemented locally on `feat/pcb-units-presets-stats-print-capture`. Their packet
testing notes retain client, real-tool and physical-print checks.

Next is L52, then the agent loop: L58, L53, L59, L60, L69. The larger systems follow: L68,
L64, L65, L66, L61, L67, L70, with L63 alongside whichever touches the same UI. The selected
scope and outstanding packet decisions are unchanged.
