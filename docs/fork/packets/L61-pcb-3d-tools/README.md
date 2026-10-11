# L61: PCB 3D tools

Status: Implemented locally (`feat/pcb-units-presets-stats-print-capture`)

Approved by Kyle on 2026-10-10.

The PCB panel's 3D board gets the inspection tools the 3D model viewer is getting. `P` switches
between perspective and orthographic, so a top or side view reads like a drawing. A section
plane cuts through the board and its parts with the cut filled in. Measure snaps to corners and
edges of pads, parts and the board outline, and a Height mode reads how far a picked point
stands above or below the board. A Heights readout names the tallest part on top and the
deepest one underneath (including through-hole leads), which is what you need for an
enclosure. Display toggles hide the board body, solder mask, copper, silkscreen, and top or
bottom components. Agents reach the same state through the PCB editor command, and a snapshot
reports heights.

## Scope

- In:
  - Orthographic projection in the 3D board, toggled with `P` and an "Orthographic" item in a
    new Display menu. Built on L31's projection rig.
  - A section plane with the shared section strip, and filled caps on closed meshes (L37).
  - A 3D Measure tool with two modes, Distance and Height, snapping to vertices, edge midpoints
    and sharp edges (L38). `M` opens it in 3D, the same key that opens Distance in 2D. `Alt`
    held while clicking skips snapping, as in 2D.
  - Component heights: tallest part above the board, deepest part below it, board thickness, and
    a per-part list. Picking a row draws its height on the board.
  - Six layer toggles in 3D: Board, Solder mask, Copper, Silkscreen, Top components, Bottom
    components. Hidden parts are not pickable or snappable.
  - Editor command actions `display`, `section`, `measure` and `height`, `tool` accepting
    `distance` and `height` in 3D, and snapshot fields for all of it.
  - A shortcut list in the 3D view that only lists keys that work there.
- Out:
  - Saving 3D measurements to the design workspace. They are transient, like a ruler.
    "Decisions needed from Kyle" covers it.
  - Hole diameter mode, wall thickness on hover and the model panel's Markup (L37, L38 only).
  - Inner copper and zones in 3D: L24 exports tracks, pads, silkscreen and mask only
    (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1650-1661`).
  - Keyboard fit, zoom and pan in 3D (`F`, `0`, `+`, `-`, arrows). They work only in the 2D
    viewport today; see the final note in [PRODUCT.md](./PRODUCT.md).
  - A section key. `S` is the model panel's key but is not allocated in the PCB panel; the
    section opens from its tool button until Kyle allocates a key.
  - Enclosure fitting (L67) and server-side tallest-part stats (L55).

## Surfaces

Web and desktop: supported. Mobile has no PCB panel. Remote: all work is client-side on the GLB
the panel already streams over the signed HTTP route (`Board3D.tsx:54-66` asks for
`transport: "url"`). Nothing new crosses the WebSocket except small editor command fields and
snapshot state, so LAN, Tailscale and T3 Connect behave as today.

## Extension points used

Reuses L24's `ext-panels` (PCB panel), `ext-mcp` (`loom_pcb_editor`), the `t3 pcb` CLI
registration and the panel key handler. Creates none.

## Packet seams

None. Every edit is in fork-owned L23 and L24 files. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. three 0.186.0 (`apps/web/node_modules/three/package.json`) already ships
`OrthographicCamera`, stencil materials and `Box3.setFromObject(object, precise)`.

## Relationship to other follow-up packets

- L31, L37, L38 (3D model viewer): L61 reuses `viewer/projection.ts`, `viewer/sectionCaps.ts`,
  `viewer/snap.ts`, `viewer/snapTopology.worker.ts`, `viewer/snapOverlay.ts` and
  `viewer/weld.ts`. If one has not landed, L61 builds the named subset in exactly the location
  and shape that packet specifies (listed in [IMPLEMENTATION.md](./IMPLEMENTATION.md), step 1),
  and the 3D packet then adds only its model-panel parts on top.
- L54 (units): heights and the Height readout format through L54's `formatLength` when it has
  landed, else as `toFixed(2) mm`. The in-scene measurement labels come from the model viewer
  and stay in millimetres, like the model panel.
- L55 (board stats): L55 reads a coarse tallest part on the server from GLB accessor bounds.
  L61 measures the loaded geometry in the client. Both use the same definition (height above
  the board body's top face, or below its bottom face), so on the same board they agree.
- L56 (layer presets): presets are for 2D layers. 3D layer toggles are separate state.
- L62 (capture export): captures follow the projection, section and hidden layers.
- L63 (viewport access): may add keyboard fit, zoom and orbit in 3D; L61's shortcut list for 3D
  gains those rows then.
- L67 (enclosure fit): can read L61's heights from the editor snapshot and reuse `heights.ts`.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
