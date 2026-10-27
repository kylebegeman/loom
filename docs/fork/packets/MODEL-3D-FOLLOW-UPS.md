# 3D model follow-up packets

Kyle reviewed a list of improvement ideas for the 3D model panel ([L23](./L23-model-preview-3d/))
on 2026-10-10 and selected 21 of them for implementation. Each idea is its own packet, L31 to
L51, and any one can be picked up by one agent without the others. This page holds the rules
they share: what they build on, where they would otherwise collide, and how they degrade when a
neighbour has not landed yet.

Kyle left out three ideas from that list: goal-driven design exploration, mobile 3D review and a
viewer performance core (worker parsing, a BVH index and a decimated proxy). Do not build them as
part of these packets. A packet that finds it needs one of them stops and asks.

## The packets

| ID  | Packet                                                    | What the user gets                                                             |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| L31 | [`model-ortho-camera`](./L31-model-ortho-camera/)         | Orthographic projection, saved with views and used for four-view sheets.       |
| L32 | [`model-bed-fit`](./L32-model-bed-fit/)                   | A table of every bed showing fits, fits rotated or too big, plus agent output. |
| L33 | [`model-custom-beds`](./L33-model-custom-beds/)           | Several named custom beds, and hiding presets you never use.                   |
| L34 | [`model-nozzle-zones`](./L34-model-nozzle-zones/)         | Single and dual nozzle reach drawn on H2D and H2C beds, with zone-aware fit.   |
| L35 | [`model-lay-flat`](./L35-model-lay-flat/)                 | Click a face to rest the part on it; the orientation is saved per model.       |
| L36 | [`model-overhangs`](./L36-model-overhangs/)               | Overhang shading with an adjustable angle, for people and the render tool.     |
| L37 | [`model-section-caps`](./L37-model-section-caps/)         | Filled cross-sections and a wall thickness readout on the section plane.       |
| L38 | [`model-measure-snap`](./L38-model-measure-snap/)         | Measurements snap to vertices and edges; holes give a diameter and centre.     |
| L39 | [`model-scale-references`](./L39-model-scale-references/) | Everyday objects beside the part for a sense of size.                          |
| L40 | [`model-units`](./L40-model-units/)                       | Millimetres or inches for every displayed length.                              |
| L41 | [`model-follow-agent`](./L41-model-follow-agent/)         | Models the agent wrote or changed in a turn are offered for opening.           |
| L42 | [`model-change-ghost`](./L42-model-change-ghost/)         | The previous mesh as a faint overlay after a reload.                           |
| L43 | [`model-viewport-access`](./L43-model-viewport-access/)   | Keyboard orbit and pan, focus, and screen reader announcements.                |
| L44 | [`model-capture-export`](./L44-model-capture-export/)     | Copy a capture as an image or save it as PNG.                                  |
| L45 | [`fork-lint-gate`](./L45-fork-lint-gate/)                 | Fork lint runs in `loom.sh check`, with today's lint errors fixed.             |
| L46 | [`model-print-check`](./L46-model-print-check/)           | A print-readiness report with located findings, also returned to agents.       |
| L47 | [`model-slicer-bridge`](./L47-model-slicer-bridge/)       | Print time, filament and supports from a host slicer, and a layer preview.     |
| L48 | [`model-assemblies`](./L48-model-assemblies/)             | Several models in one scene with an exploded view and interference checks.     |
| L49 | [`model-history`](./L49-model-history/)                   | Scrub, compare and restore a model across the thread's turn checkpoints.       |
| L50 | [`model-python-cad`](./L50-model-python-cad/)             | build123d sources with the same customizer, plus STEP preview and export.      |
| L51 | [`printer-library`](./L51-printer-library/)               | Printers and surfaces as editable data with nozzles, materials and zones.      |

## What they build on

- **Base.** L23 as shipped, plus the bed picker on `feat/model-bed-picker` (`8676e099e5`, with
  fixes in `1f901fdd6e`):
  `BUILD_PLATE_PRESETS` with `kind` and `volumeMm`, `BuildPlatePattern`, `viewer/bed.ts`,
  `BedPicker.tsx` and `buildPlate.ts` (with `bedFit` and `buildPlateNote`). Defect fixes
  found while writing these packets sit on `fix/preview-defects`, which branches from it
  (`59638f0231`, `6ddf84c1aa`, `f4941963a6`). Until both merge, start packet branches from
  `fix/preview-defects`.
- **Code location.** These packets extend an existing feature, so their code goes in L23's
  directories (`apps/web/src/fork/model-preview-3d/`, `apps/server/src/fork/model-preview-3d/`,
  `packages/contracts/src/fork/model-preview-3d.ts`, `model-editor.ts`, `model-workspace.ts`,
  `packages/client-runtime/src/fork/model-preview-3d.ts`). They reuse L23's capability
  (`model-preview-3d`), panel, settings section, palette entries and MCP registration, so most
  need no upstream seam. L41, L45 and L49 may touch other areas; their `SEAMS.md` says where.
- **Commits** use the packet slug: `feat(fork-model-lay-flat): rest a part on any face`.
- **Surfaces.** Web and desktop. Mobile still has no 3D panel. Remote use (LAN, Tailscale, T3
  Connect) must keep working: new bytes go through the signed file route, never the WebSocket.
- **Host tools.** Anything that runs a program (OpenSCAD, a slicer, Python) runs on the
  environment host, like OpenSCAD today: detected with a version, configurable path, timeout,
  bounded logs, cancellation and a clear "not installed" state.
- **Dependencies.** No new production dependency without Kyle's approval. Each packet says
  whether it needs one and what it does without it.

## Shared touch points

Several packets edit the same few files. Keep each change additive so parallel branches merge
by hand in minutes.

- `viewer/createViewer.ts`: add methods to the returned object and put the logic in a new file
  under `viewer/` named after the packet (`viewer/projection.ts`, `viewer/overhangs.ts`,
  `viewer/sectionCaps.ts`, `viewer/snap.ts`, `viewer/ghost.ts`, `viewer/references.ts`,
  `viewer/zones.ts`, `viewer/orientation.ts`, `viewer/assembly.ts`). Do not restructure the
  factory.
- `ModelPreviewService.ts` copies editor results field by field (`completeEditor`, about line
  889), so a packet that adds an editor result field also adds it there.
- Capability strings: each packet that adds client-visible behaviour adds its slug (for example
  `model-lay-flat`) to `LOOM_SERVER_FEATURES`, so clients can tell an older server apart.
- `ModelPanel.tsx` key handler: one `else if` line per new key, using the table below.
- `WorkspaceTools.tsx` display menu (`DisplayTools`), its `HELP` shortcut list and
  `BedPicker.tsx`: append items; do not reorder existing ones. List every new key in `HELP`.
- Overlays and picking (L36, L37, L38, L42, L48) go through L31's `activeCamera()` once L31
  has landed, so they work in orthographic as well as perspective.
- `model-editor.ts`: agents drive display state through the editor command. A packet that adds
  a display mode also adds it to the editor command so `loom_model_preview_3d_editor` can set it.
- Settings: new fields use `Schema.withDecodingDefault` so older saved settings still load,
  exactly as `buildPlate.pattern` does. `updateSettings` replaces the whole object today, so an
  older client that saves drops fields it does not know. L33 turns the save into a merge
  ([L33's TECHNICAL.md](./L33-model-custom-beds/TECHNICAL.md)); until it lands, a packet that
  adds a settings field notes this in its merge safety section.
- L48's assembly file is also extended by the PCB follow-up L67 (version 2 `enclosure`
  section, four operations, `ASSEMBLY_CHECK_VERSION = 2`). Keep the file versioned and newer
  versions read-only so that extension stays additive.
- Errors: `ModelPreviewError` gains one `"conflict"` reason, shared by L48, L49 and L51 for a
  write against a file or record that changed underneath it. The first to land adds it.
- Workspace entities (`model-workspace.ts`): new per-model state lives here, scoped like views
  and measurements (project, canonical root, model path), with schema limits.

## Keyboard shortcuts

Panel keys today: `M` measure, `N` annotate, `S` section, `1`-`4` views, `F` fit, `H` pan,
`O` orbit, `I` inspector, `W` wireframe, `G` bed, `A` axes, `+`/`-` zoom, `Escape`, and
`mod+Z` / `mod+shift+Z` parameter history. New keys are allocated here so packets never
collide:

| Key                      | Packet | Action                               |
| ------------------------ | ------ | ------------------------------------ |
| `P`                      | L31    | Toggle perspective and orthographic  |
| `L`                      | L35    | Pick a face to lay flat              |
| `V`                      | L36    | Toggle overhang shading              |
| `D`                      | L42    | Toggle the previous-version ghost    |
| `T`                      | L49    | Show or hide the history timeline    |
| `[` and `]`              | L49    | Step to the previous or next version |
| `E`                      | L48    | Toggle exploded view                 |
| `Y`                      | L47    | Show or hide sliced layers           |
| Arrow keys, shift+arrows | L43    | Orbit, and pan                       |
| `Alt` held while picking | L38    | Pick without snapping                |

Add new rows here before using any other key.

## Shared definitions

When two packets need the same piece, it is defined once here. Whichever packet lands first
creates it exactly as written; the other reuses it. This mirrors how
[EXTENSION-POINTS.md](./EXTENSION-POINTS.md) works.

### Model orientation (created by L35, read by L32, L36, L46, L47, L48)

A per-model workspace entity `orientation`: `{ quaternion: [x, y, z, w], sourceRevision }`,
stored as `null` (with a decoding default) when the part is as authored. The quaternion is a
rotation about the part's bounding-box centre. The viewer applies it to the model root and then
places the bed under the part as it does today (`viewer/createViewer.ts:431-440`); it never
moves the part. Dimensions, fit and overhangs are computed in world space after orientation, so
packets that read world-space bounds follow it automatically. Server-side consumers (fit
summary, print check, slicer) apply the rotation only and derive placement themselves, and
ignore the entity when it is `null`. [L35's TECHNICAL.md](./L35-model-lay-flat/TECHNICAL.md)
has the exact schema.

### Ghost overlay (created by L42 or L49)

`viewer/ghost.ts` exports `createGhost(parent: Object3D, requestRender: () => void)` returning
`{ set(object: Object3D | null): void; setVisible(visible: boolean): void;
setTheme(dark: boolean): void; setClipping(planes: readonly Plane[]): void; dispose(): void }`.
`set` takes ownership of the object and replaces the current ghost, disposing the previous one's
geometries and materials. The ghost is drawn with one shared translucent, depth-tested, unlit
material in a fixed muted colour per theme (like `viewer/bed.ts`), is never pickable and does not
affect fit or dimensions. `setVisible` hides it without disposing it. `setClipping` follows the
section plane. Each viewer feature that needs a ghost creates its own instance in the viewer's
`ghosts` group: L42 keeps one for the previous version (`keepPrevious`, `showPrevious`) and L49
one for the compared version (`setCompareModel`), so they never fight over a slot.
[L42's TECHNICAL.md](./L42-model-change-ghost/TECHNICAL.md#ghost) has the exact material values.

### Mesh welding (created by L35, L37 or L38)

Lay flat, section caps and snapping all need triangles that share vertices, and STL files store
every triangle separately. `viewer/weld.ts` exports
`weld(geometry: BufferGeometry): { positions: Float32Array; corners: Uint32Array }`: positions
are the unique vertices (xyz), `corners` holds three vertex ids per triangle in the source
triangle order, so a raycast `faceIndex` maps straight to it. Positions are quantized to
`max(1e-6, 1e-5 × bounding diagonal)` mm and hashed, as
[L38's TECHNICAL.md](./L38-model-measure-snap/TECHNICAL.md) describes. Each packet builds its own
adjacency on top (L35's `buildAdjacency`, L37's loop tracing, L38's edge table) and caches the
weld per geometry, so a model is welded once however many of them are on.

### Overhang analysis (created by L36, used by L46)

`packages/contracts/src/fork/model-overhangs.ts` holds the angle limits, the bed band and the
statistics schema returned to agents, exactly as
[L36's TECHNICAL.md](./L36-model-overhangs/TECHNICAL.md) defines them. The print check reports
overhangs through the same schema rather than a second one. The settings field
`overhangAngleDegrees` (integer, 30 to 70, decoding default 45) is also shared: whichever of L36
and L46 lands first adds it exactly as L36 defines it, and both read it. Slicing (L47) takes
supports from the slicer's own output and does not use it.

### Model formats (created by L41 or L50)

`packages/contracts/src/fork/model-preview-3d.ts` exports
`modelFormatOf(path): ModelFormat | null`, the one place a path becomes a format, as
[L50's TECHNICAL.md](./L50-model-python-cad/TECHNICAL.md) defines them. Server, web, MCP and
L41's turn file list call it instead of keeping their own maps. If L41 lands first it creates it
without the `build123d` format and L50 adds that.

### SCAD references (created by L41 or L49)

`apps/server/src/fork/model-preview-3d/scadIncludes.ts` parses a SCAD file's `include`, `use`,
`import()` and `surface()` references, exactly as
[L41's TECHNICAL.md](./L41-model-follow-agent/TECHNICAL.md) defines it. L41 uses it to tie a
changed include to the models that read it; L49 uses it to restore those files with a model.
`formats.ts` beside it holds `PREVIEWABLE_FORMATS` and `SCAD_INPUT_EXTENSIONS`, which L50
extends; the extension map itself is `modelFormatOf` (above).

### Slicer apps and profiles (created by L47 or L51)

`packages/contracts/src/fork/model-slicer.ts` holds `SlicerApp`, and
`apps/server/src/fork/model-preview-3d/slicer/profiles.ts` holds `flattenProfile` and the
profile readers, as [L47's TECHNICAL.md](./L47-model-slicer-bridge/TECHNICAL.md) defines them.
If L51 lands first it creates `model-slicer.ts` with only `SlicerApp`.

### Length formatting (created by L40, used by every packet that shows a length)

`apps/web/src/fork/model-preview-3d/units.ts` exports `formatLength(mm, units, options?)` and
`formatLengths(values, units)`, with `units` of `"mm" | "in"` and options for digits, trimming
trailing zeros and the unit suffix. `useDisplayUnits()` reads the unit from a React context and
`useDisplayUnitsControl()` changes it. [L40's TECHNICAL.md](./L40-model-units/TECHNICAL.md) has
the exact signatures. Until L40 lands, packets format millimetres the way the panel does today
and leave a single call site to swap.

### Bed source (L32, L33, L34 and L51)

The server needs the bed list too (fit summaries for agents), so bed data moves out of the web
app. Whichever of L32, L33 or L34 lands first moves the bed schemas and presets from
`model-preview-3d.ts` into a new `packages/contracts/src/fork/model-beds.ts`, in its own
refactor commit, exactly as [L32's TECHNICAL.md](./L32-model-bed-fit/TECHNICAL.md) describes.
`buildPlate.ts` keeps `bedGroups()` and `resolvePlate()` as thin wrappers.

Code that lists beds calls those functions (or `listBeds()` in `model-beds.ts` on the server) and
never reads `BUILD_PLATE_PRESETS` directly. L33 adds custom beds and hidden presets behind them,
and L51 later replaces their data source, so everything that uses them keeps working. Nozzle
zones (L34) are an optional `zones` field on a bed:
`readonly { id, label, footprintMm: [x, y], offsetMm: [x, y], heightMm?: number }[]`, where the
offset is from the bed's front-left corner and `heightMm` is set when a zone is shorter than the
bed (the H2D's left nozzle). L51 keeps the same field and adds `nozzlesMm` (installed nozzle
diameters), which the print check (L46) reads when present instead of its own
`nozzleDiameterMm` setting (default 0.4 mm).

## Relationship to the Fabrication app

The Fabrication app (`~/Developer/docs/apps/fabrication/`) is planned but not started. Its plans
cover printability reports, slicing, build123d and printer control. Kyle chose on 2026-10-10 to
build print checks (L46), slicing estimates (L47), Python CAD (L50) and the printer library (L51)
in Loom. Treat the Fabrication documents as research, not as a dependency. Loom still never sends
a job to a printer; printer control stays out of scope.

## Suggested order

Order is a suggestion, not a dependency. Quick wins first: L31, L32, L40, L39, L44, L34, L45.
Then the high-value interaction work: L36, L41, L42, L38, L35, L37, L43, L33. The larger systems
follow: L46, L49, L48, L51, L47, L50.
