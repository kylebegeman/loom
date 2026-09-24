# L23: 3D model preview

Status: Ready to build. <!-- Not started | Designing | Ready to build | In progress | Done | Blocked: reason -->

A **3D model** right panel that shows the thread's 3D files next to the chat: STL, 3MF, OBJ
and glTF/GLB meshes, and OpenSCAD `.scad` sources, which the environment server renders with the
`openscad` CLI into a mesh on every save, with the model's customizer parameters as a form. The
view updates when an agent (or Kyle) edits the file, renders only on interaction (no idle GPU
use), shows dimensions and triangle counts, and captures a view or a four-view sheet into the
composer so the agent can see what it built. Agents also get one small MCP tool that renders a
`.scad` or mesh file to PNG views with a geometry summary.

Blender stays outside Loom: agents use a Blender MCP server configured in their provider, and
this panel previews what they export. The standalone Fabrication app
(`~/Developer/docs/apps/fabrication/`: slicing, printers, a model library) is separate; the
panel can link to it when a URL is configured, and never depends on it.

## Scope

- In:
  - Model discovery in the thread's workspace: `.stl`, `.3mf`, `.obj`, `.glb`, `.gltf`, `.scad`
    (`.step` / `.stp` are listed, never previewed: "STEP files are not previewed here; open them
    in the Fabrication app (STEP import is planned there).").
  - One panel tab per file; open from the launcher's file picker, the palette, or a keybinding.
  - three.js viewer, lazy-loaded: orbit, pan, zoom, fit, iso/front/top/right views, wireframe,
    grid sized to the chosen build plate, axes, bounding box dimensions in mm, triangle count, a
    "Larger than the build volume" warning, light and dark themes. Render on demand only.
  - Build plate presets for Kyle's printers: Bambu Lab H2D (default, 350 x 320 x 325 mm), Bambu
    Lab H2C (330 x 320 x 325 mm), Anycubic Kobra S1 (250 x 250 x 250 mm), and Custom.
  - Live reload when the file (or, for `.scad`, any file it includes) changes on disk.
  - OpenSCAD: server-side render to binary STL (or 3MF with colors, a setting), customizer
    parameters parsed from the source and editable in a form, parameter sets from the OpenSCAD
    customizer JSON sidecar, last-used values remembered per file, render log (`ECHO`,
    `WARNING`, `ERROR`) and the geometry summary (manifold or not).
  - Capture the current view, or a 2x2 sheet of standard views, into the composer.
  - Agent tool `loom_model_preview_3d_render`.
  - Loom settings section: OpenSCAD path and version, backend, render timeout, colors, max file
    size, build plate preset (or custom size), optional Fabrication app URL, "Let agents render
    models" (the agent tool, on by default).
  - Palette entries and unbound keybinding commands.
- Out:
  - Editing geometry, measuring between points, section planes, slicing, printer control, print
    queues, a model library: the Fabrication app's job.
  - Running Blender from Loom (headless scripts, `.blend` previews). Blender MCP from agents is
    documented, not integrated.
  - Draco-compressed glTF (needs decoder assets), textures beyond what GLTFLoader loads from the
    same folder, animation playback.
  - Mobile UI.
  - Multi-material units (Kyle's 2 AMS, 2 AMS HT and ACE 2 Pro): Fabrication app data, not needed
    by a preview. Recorded in the Fabrication spec's printer presets.
  - Follow-up: STEP preview. Kyle declined `occt-import-js` (LGPL-2.1, about 11.6 MB of
    WebAssembly); STEP stays with the Fabrication app. Revisit only if the Fabrication app never
    covers it.

## Surfaces

- Web and desktop: supported. Files and renders are served by a signed fork HTTP route, so the
  viewer works locally, over Tailscale and through T3 Connect; OpenSCAD runs on the environment
  host.
- Mobile: not supported.
- Upstream T3 server: launcher disabled with "Needs a Loom server with 3D preview".
- Needs WebGL 2 in the client; without it the panel says so.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (including section 3, HTTP routes, for the signed file route), [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels),
  [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings), [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) + [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings), [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp). Any may be
  created by this packet.

## Packet seams

None.

## New dependencies

- `three` (MIT, 0.186.0) and `@types/three` (MIT, dev) in `apps/web`, loaded as a lazy chunk.
  Approved by Kyle on 2026-09-24. No other new dependency.

## Optional integrations

- L24 (pcb-preview): none required. Both panels watch files the same way; they share no code.
- Fabrication app: a URL setting adds "Open in Fabrication" (opens the app in a browser); no API
  calls are made in v1. See TECHNICAL.md, "Fabrication app".

## Size estimate

Medium to large: about 2,800 lines including tests (viewer 900, OpenSCAD service and
parameters parser 900, panel UI 600, route and contracts 400).

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md, then this
folder. `three` is approved; commit only the intended lockfile change (CONVENTIONS.md, "The
lockfile rule"). OpenSCAD is not installed on Kyle's Mac as of 2026-09-24; the automated tests fake it.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none beyond extension points).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art, library and tool facts, Blender MCP notes.
