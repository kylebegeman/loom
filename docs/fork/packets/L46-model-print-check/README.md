# L46: Print check

Status: Implemented locally (`feat/model-orientation-sections-print-check`).

Approved by Kyle on 2026-10-10.

The Part tab gains a "Print check" section that says whether a part is ready to print and, when
it is not, where the trouble is. The environment host reads the mesh itself (STL, 3MF, OBJ, glTF,
GLB, or the current OpenSCAD render), so the answer does not depend on the browser and works the
same from a remote client. It checks the things that ruin prints: open or non-manifold edges,
loose shells, overhangs past the user's angle, islands that start in mid-air, walls thinner than
two nozzle widths, features thinner than the nozzle, a tiny first-layer footprint under a tall
part, and whether the part fits the bed. Each problem carries a location, so it shows as a pin on
the model and a row in a pass and warn list; clicking a row frames the camera on it. Agents get
the same report from a new `loom_model_preview_3d_check` tool.

## Scope

- In:
  - A server mesh reader for binary and ASCII STL, OBJ, 3MF (core spec, components, build
    transforms, per-file units, production-extension `p:path` parts) and glTF/GLB (uncompressed,
    embedded or same-directory buffers), producing millimetres, Z up, in the viewer's frame.
  - The checks above, run in a Node worker thread with a hard timeout, cancellation, a triangle
    cap and a deterministic thin-wall sampler accelerated by a uniform grid built in the worker.
  - Results cached by geometry revision, orientation and check settings; shared between the
    panel and agents asking for the same thing.
  - Part tab "Print check" section, located findings as pins (listed under Markup), click to
    frame, a display menu toggle for the pins, and a Part tab badge.
  - Settings: nozzle diameter, overhang angle and first-layer height, with decoding defaults.
  - `loom_model_preview_3d_check`, gated by "Let agents render models and propose variants".
- Out:
  - Repair. Loom reports; the agent or the user edits the source.
  - Support generation, slicing, time and filament estimates (L47).
  - Bridge detection. Flat ceilings spanning two walls are reported as overhangs, as most
    slicers' overhang shading also does.
  - Choosing an orientation. L35 sets it; this packet checks the part as oriented.
  - STEP, which stays with the Fabrication app.
  - The single-file `t3` executable (see PRODUCT.md, "Decisions needed from Kyle").

## Surfaces

- Web and desktop: supported. The check runs on the environment host; the panel only renders
  the report and pins.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: works over LAN, Tailscale and T3 Connect. Mesh bytes never cross the network for the
  check; the report is a small RPC payload (typically under 10 KB, capped near 80 KB).
- Upstream T3 server: the 3D panel is already hidden there (L23).

## Extension points used

None new. Reuses L23's registrations: `ext-core` (ForkLayer service, fork RPC group), `ext-mcp`
(the tool joins `ModelPreview3dToolkit`), `ext-panels` (the 3D panel) and `ext-settings`
(the 3D model settings section).

## Packet seams

One: `apps/server/vite.config.ts` gains a pack entry for the worker script, marked
`fork: model-print-check`. Details in [SEAMS.md](./SEAMS.md).

## New dependencies

None. Mesh parsing, geometry and the grid are written in this packet. The server already
depends on `yauzl` (used by `threeMfUnits.ts`) for reading 3MF archives. No BVH library.

## Relationship to other follow-up packets

- L32 (bed fit): with it, fit uses `activeBed()` and `fitOnBed()` from
  `packages/contracts/src/fork/model-beds.ts`. Without it, this packet performs L32's
  "Bed list in contracts" move first, exactly as L32's TECHNICAL.md writes it.
- L35 (lay flat): with it, the server reads the `orientation` workspace entity and checks the
  part as oriented and rested on the bed, matching the viewer. Without it, the part is checked
  as placed, with the bed under its lowest point, as the viewer draws it today.
- L36 (overhang shading): both use one `overhangAngleDegrees` setting. Whichever lands first adds it.
- L40 (units): without it, the section prints millimetres through one local formatter; with it,
  that formatter calls `formatLength`.
- L48 (assemblies): reuses this packet's mesh reader, grid and worker host for interference
  and clearance checks.
- L51 (printer library): with it, the nozzle diameter comes from the active printer; the setting
  remains for surfaces, custom beds and printers without a nozzle entry.
- L47 (slicing estimates): independent. A slicer's own warnings complement this report.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design, algorithms, thresholds, data shapes and limits.
- [SEAMS.md](./SEAMS.md): the one upstream touch and the fork-owned shared files.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
