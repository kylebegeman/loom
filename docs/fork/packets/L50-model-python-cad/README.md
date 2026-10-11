# L50: Python CAD and STEP

Status: Implemented locally (`feat/model-history-assemblies-slicing-cad`).

Approved by Kyle on 2026-10-10. Kyle chose to build Python CAD in Loom on 2026-10-10.

OpenSCAD is good at quick parametric parts and poor at fillets, chamfers, threads and anything
that has to leave Loom as a real CAD solid. build123d is a Python CAD library on the OpenCascade
kernel that agents can write. This packet lets a workspace file named `*.b3d.py` with a
`def model(...)` function behave like a SCAD file in the 3D panel: its typed keyword arguments
become the same customizer, renders are cached and re-run when the file or a local module it
imports changes, variants and parameter sets work, and "Export STEP" hands a real solid to other
CAD tools. STEP files get a mesh preview. Python runs on the
environment host in a Loom-owned environment that the user sets up with one click (or their own
interpreter). Executing Python source, setup and STEP export need terminal access; STEP
preview uses the normal model permission.

## Scope

- In:
  - A `build123d` model format for files named `*.b3d.py`, with `def model(...)` returning a
    build123d shape or a list of shapes.
  - Parameters read statically from `model`'s signature (no user code runs to read them):
    numbers with ranges, booleans, strings, choices and vectors, mapped onto the existing
    customizer, parameter sets (the same JSON sidecar) and variants.
  - Rendering to STL, or to colour 3MF when "Render colors" is on, through the existing cache,
    timeout, cancellation, dependency watching and summary.
  - STEP and STP preview by tessellating the file (no user code).
  - "Export STEP" for build123d sources, downloaded through the signed file route; an agent tool
    that writes the STEP file into the workspace.
  - A Python setting: Loom-managed environment set up with `uv` on an explicit click, or a path
    to the user's own interpreter with build123d installed; detection, version and "not set up"
    states like OpenSCAD.
  - MCP: render, parameters, PNG views and STEP export for the new formats.
- Out:
  - CadQuery, FreeCAD, OCP scripts or plain Python files without the `.b3d.py` suffix.
  - Sandboxing user Python. It runs with the server's permissions, like an agent's commands.
  - An in-browser Python or OpenCascade (WASM). Rendering stays on the host.
  - STEP assemblies as separate selectable parts (L48 owns multi-part scenes). A STEP file
    previews as one mesh with its colours.
  - Editing STEP files. They are read-only inputs.
  - Mobile UI.

## Surfaces

- Web and desktop: supported, shared web code.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: works on every connection mode. Python runs on the environment host; meshes and STEP
  downloads go through the signed file route, never the WebSocket. Setting up the environment
  from a remote client needs the terminal permission, like other host installs.
- Upstream T3 server: no 3D panel, as today.

## Extension points used

None new. Reuses L23's `ext-panels` (the 3D panel), `ext-settings` (the 3D model section),
`ext-mcp` (model tools) and the fork RPC scope tables.

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None in Loom. The host needs build123d 0.13.0 (Apache-2.0) and its wheels, which Loom installs
into its own state folder only when the user clicks "Set up", or which the user installs
themselves. `uv` on the host makes the one-click setup possible; without it, settings show the
commands to run. Kyle approves this host install model in PRODUCT.md, decision 1.

## Relationship to other follow-up packets

- L41 (follow agent): `.b3d.py` and STEP join `PREVIEWABLE_FORMATS`, and L41's format map uses
  this packet's `modelFormatOf(path)`, because `.b3d.py` is not a plain extension.
- L47 (slicing): slices build123d and STEP through their rendered mesh, keyed by revision.
- L48 (assemblies): a STEP or build123d model can be one part of an assembly through its mesh.
- L49 (history): checkpoints of `.b3d.py` render from isolated snapshots. L49 resolves local
  Python imports and recorded dependencies when materializing those snapshots.
- L46 (print check): works on the rendered mesh, as for SCAD.
- L35, L36, L37, L38: work on the mesh; nothing format-specific.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): build123d APIs, packages, licences.
