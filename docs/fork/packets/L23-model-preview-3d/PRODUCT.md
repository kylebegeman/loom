# L23 product

## Problem

Kyle designs parts for 3D printing with agents: OpenSCAD code, meshes exported from Blender,
downloaded STLs. Today the agent writes a `.scad` file and neither of them sees the result
without opening another app, so mistakes (a wall too thin, a hole in the wrong place) surface at
the printer. Old Loom never built a 3D viewer (its "3D printing studio" phase stayed "not
started"). This packet gives Loom eyes for 3D files, the way upstream's preview gives it eyes for
web pages, and leaves slicing and printers to the separate Fabrication app.

## What the user can do

- Open the **3D model** panel from the launcher, the "+" menu, the palette or a keybinding, and
  pick any model file in the workspace from a searchable list.
- Orbit, pan and zoom; jump to iso, front, top or right; fit to view; toggle wireframe, grid and
  axes. See the size (X by Y by Z in mm) and the triangle count, on a grid the size of the
  chosen printer's build plate, with a warning when the part is larger than its build volume.
- Keep the panel open while an agent edits the file: the view reloads on save and keeps the
  camera.
- For OpenSCAD files: see the render log, whether the result is manifold, and edit the
  customizer parameters (sliders, dropdowns, checkboxes, text) with live re-renders; pick a saved
  parameter set; save the current values as a new set in the file's customizer JSON.
- Capture the current view, or a sheet of four standard views, into the composer, so the next
  message shows the agent the part.
- Configure OpenSCAD (path, backend, timeout, colors), the build plate (Bambu Lab H2D, Bambu Lab
  H2C, Anycubic Kobra S1, or a custom size), the maximum file size, an optional Fabrication app
  link, and "Let agents render models" in Loom settings.
- Let agents render a model to PNG views with `loom_model_preview_3d_render` (on by default;
  "Let agents render models" turns it off).

## Entry points

| Entry                                                                                                                                               | What it does                                                                                                                   | Way out / state                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Right panel launcher and "+" menu: "3D model" (letter `O`)                                                                                          | Opens the panel's file picker; choosing a file opens a tab for it.                                                             | Close the tab; the file watch stops. |
| Command palette: "3D model: Open file..." (submenu of model files), "3D model: Capture view", "3D model: Capture four views", "3D model: Re-render" | As named; hidden when the feature is absent.                                                                                   | n/a                                  |
| Keybinding commands `loom.model-preview-3d.open`, `loom.model-preview-3d.capture`                                                                   | Unbound by default.                                                                                                            | Same as the palette.                 |
| Settings, Loom page, "3D model" section                                                                                                             | OpenSCAD detection and options, limits, build plate preset, Fabrication URL, "Let agents render models", "Clear render cache". | Toggle back.                         |
| Composer                                                                                                                                            | Captures are attached as images.                                                                                               | Remove the attachment.               |
| Agent tool                                                                                                                                          | `loom_model_preview_3d_render`.                                                                                                | n/a (read-only tool).                |

## States

- **Loading**: download progress for large files, then "Preparing mesh...".
- **Empty**: "No 3D files in this workspace." with the supported extensions.
- **OpenSCAD missing**: `.scad` files show "Install an OpenSCAD development snapshot to preview
  .scad files" with a link; meshes still work.
- **Rendering**: "Rendering with OpenSCAD..." with elapsed seconds; the previous mesh stays
  visible, dimmed, until the new one arrives.
- **Render failed**: the first `ERROR:` line and the full log; the last good mesh stays with a
  "stale" badge.
- **Too large**: "This file is 212 MB; the limit is 150 MB." with "Load anyway".
- **Unsupported**: Draco-compressed glTF, WebGL unavailable.
- **STEP file**: "STEP files are not previewed here; open them in the Fabrication app (STEP
  import is planned there)." with "Open in Fabrication" when its URL is set.
- **Larger than the build volume**: the status bar shows "Larger than the Bambu Lab H2D build
  volume (350 x 320 x 325 mm)" next to the dimensions. Informational only.
- **File gone**: "The file was deleted or moved." with the picker.
- **Disabled**: server lacks `model-preview-3d`: launcher disabled, palette entries hidden.

## Surfaces and connection modes

Web and desktop show the same panel. Model bytes come from the environment through signed URLs
and are cached by the browser for the URL's lifetime; OpenSCAD renders happen on the environment
host, so a remote environment works the same way as a local one. Mobile shows nothing. An
upstream server hides the feature.

## Blender

Loom does not run Blender. Agents that need Blender use a Blender MCP server in their provider
configuration, and the panel previews the STL, OBJ or glTF files they export. The user doc covers
setup. Kyle's current Codex entry is broken; see TECHNICAL.md, "Blender MCP" for the fix options.

## Decisions

- three.js as the renderer, loaded only when the panel opens, rendering on demand.
- OpenSCAD renders run on the server with a timeout and one render in flight per file; newer
  edits cancel older renders.
- Units are millimetres for STL and OBJ (unitless formats); 3MF units are read from the file.
- The panel never writes into the workspace except "Save as parameter set", which updates the
  `.scad` file's customizer JSON sidecar after a confirmation.
- No dependency on the Fabrication app; only a link.
- `three` and `@types/three` are approved as `apps/web` dependencies, loaded as a lazy chunk
  (Kyle, 2026-09-24): the viewer needs a WebGL renderer and three's loaders cover every format.
- No `occt-import-js` (Kyle): STEP stays with the Fabrication app, so Loom carries no LGPL
  WebAssembly module of about 11.6 MB. STEP preview is a recorded follow-up.
- The build plate is a setting with presets for Kyle's printers from vendor specs: Bambu Lab H2D
  350 x 320 x 325 mm (default), Bambu Lab H2C 330 x 320 x 325 mm (left nozzle
  325 x 320 x 320, both nozzles 300 x 320 x 325, shown as a note), Anycubic Kobra S1
  250 x 250 x 250 mm, and Custom. A generic 256 mm grid would not match any printer he owns.
- Multi-material units (2 AMS, 2 AMS HT, ACE 2 Pro) are not modelled here: a preview does not
  need them; the Fabrication app's printer presets record them.
