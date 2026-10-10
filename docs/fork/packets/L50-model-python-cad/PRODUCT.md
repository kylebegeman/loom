# L50 product

## Problem

Agents in Loom write OpenSCAD because it is the only source format the 3D panel previews. For
parts that need fillets, chamfers, threads or a STEP file for a machinist, OpenSCAD is the wrong
tool: it produces meshes, not solids. build123d does those well, but today a build123d script
is just a Python file Loom cannot show, and a STEP file shows a placeholder that points to an
app that does not exist yet. Kyle wants the same loop he has for
SCAD (change a parameter, see the part, ask for a change, compare variants) with real CAD.

## What the user can do

- Open `bracket.b3d.py` from the model picker (it appears under "Sources" with SCAD files) or
  from an agent. It renders like a SCAD file: the customizer shows its parameters, edits
  re-render, and the panel reloads when the file or a local module it imports changes.
- Use parameter sets, variants, markup, views, measurement and everything else the panel does
  for SCAD.
- Click "Export STEP" in the Part tab to download a STEP file of the current parameters.
- Open a `.step` or `.stp` file and see it, with its colours, instead of the placeholder.
- Ask an agent to "make this a build123d part with a 2 mm fillet on the top edges"; the agent
  writes the file, renders it with `loom_model_preview_3d_render_mesh`, and exports STEP with
  `loom_model_preview_3d_export_step`.
- In Loom settings, 3D models, "Python CAD": see whether build123d is ready ("build123d 0.13.0
  on Python 3.13, managed by Loom"), click "Set up" to install it into Loom's own folder, or
  set a path to their own Python that has build123d. "Remove" deletes Loom's environment.

A build123d model file looks like this:

```python
# bracket.b3d.py
from typing import Annotated, Literal
from build123d import *

def model(
    width: Annotated[float, {"min": 20, "max": 200, "step": 1, "group": "Size"}] = 60,
    height: Annotated[float, {"min": 5, "max": 50, "group": "Size"}] = 12,
    edge_radius: Annotated[float, {"min": 0, "max": 5, "step": 0.5,
                                   "description": "Top edge fillet in mm"}] = 2,
    holes: bool = True,
    finish: Literal["matte", "gloss"] = "matte",
):
    part = Box(width, 30, height)
    if edge_radius > 0:
        part = fillet(part.edges().group_by(Axis.Z)[-1], edge_radius)
    if holes:
        part -= Pos(width / 2 - 8, 0, 0) * Cylinder(2.5, height)
    return part
```

## Entry points

| Way in                                                  | Way out                               | How the state shows                                                         |
| ------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Model picker, "Sources" filter                          | Close the tab or choose another model | The document bar reads "build123d source".                                  |
| Agent editor `open` with a `.b3d.py` or STEP path       | Same                                  | As above, or "STEP file".                                                   |
| "Export STEP" in Part                                   | Cancel while exporting                | `OperationStatus` "Exporting STEP", then a browser download.                |
| Agent `loom_model_preview_3d_export_step`               | The agent's turn ends                 | The file appears in the workspace.                                          |
| Settings, Python CAD, "Set up"                          | "Remove"                              | "Setting up build123d" with elapsed time and "Cancel", then the ready line. |
| Settings, Python CAD, interpreter path                  | Clear the path (back to Loom-managed) | The detection line for that interpreter.                                    |
| "Set up Python CAD" link in the panel's not-ready state | Back to the panel                     | Opens settings at Python CAD.                                               |

## States

- Not set up: a `.b3d.py` or STEP tab shows "Python CAD is not set up on this host." with
  "Set up Python CAD" (opens settings). STEP keeps "Open in Fabrication" here when a
  Fabrication URL is set.
- Setting up: settings show elapsed time and the installer's last line; the panel keeps its
  not-ready state until setup finishes, then renders without a reload.
- `uv` missing: "Set up" is replaced by the commands to run and the interpreter path field.
- Interpreter without build123d: "This Python does not have build123d. Install build123d 0.13.0
  or clear the path to use Loom's environment."
- Untested version: a build123d version other than 0.13.0 works with the note "Tested with
  build123d 0.13.0."
- Rendering: the same pending state and elapsed time as SCAD.
- No `model` function, or a signature Loom cannot read: "This file needs a `def model(...)`
  function." Parameters Loom cannot read (a default that is not a literal) are skipped with a
  warning in the Render log, and the model still renders with its default.
- Python error: the Render log shows the exception and the line in the user's file
  (`bracket.b3d.py:14: ValueError: fillet radius too large`), and the last good mesh stays.
- Invalid solid: renders, with "The shape is not a valid solid" as a warning, and "Manifold: No"
  in Part.
- Timeout and cancel: as for SCAD, using the same render timeout.
- No permission: without the terminal permission, a `.b3d.py` tab shows "Running Python models
  needs terminal access on this environment." STEP previews need only the normal model
  permission because no user code runs.
- Older server: when the environment's Loom predates this packet, `.b3d.py` and STEP tabs show
  "Update Loom on this environment to preview Python models."

## Surfaces and connection modes

Web and desktop share all of this. Python always runs on the environment host, so a phone's
browser or a laptop over T3 Connect previews and exports the same way; the mesh and the STEP
download use the signed file route. Mobile has no 3D panel. An upstream T3 server has no 3D
feature.

## Decisions

- Kyle chose to build Python CAD in Loom on 2026-10-10, using the Fabrication app's research.
- build123d only, as the Fabrication research chose. CadQuery shares the kernel and has more
  examples online, but an older fluent API; supporting both would double the runner and the
  agent guidance.
- The file name marks a model (`*.b3d.py`), so the format is known from the path alone, like
  every other model format. The panel, the picker, agents and L41 all agree without reading
  files.
- Parameters come from `model`'s signature with standard Python typing, so the file stays
  plain Python that runs outside Loom (`python -c "import bracket; bracket.model()"` with a
  normal import works).
- Reading parameters never runs user code; rendering does, in a separate process per render
  with the render timeout. User code is not sandboxed, which is why running it needs the
  terminal permission (the same rule as the PCB panel's tscircuit render).
- Loom pins the build123d version it installs (0.13.0) and records it in the cache key.
- STEP previews tessellate with fixed tolerances (0.01 mm, 0.1 rad), fine enough for viewing and
  printing estimates.

## Decisions needed from Kyle

1. **Who installs build123d.** Recommended: a "Set up" button that runs `uv` to create a
   Loom-owned environment under the server's state folder and installs build123d 0.13.0
   (about 60 MB for the OpenCascade wheel plus its dependencies). Nothing is installed until the
   user clicks, "Remove" deletes it, and a custom interpreter path is always available. The
   alternative is L26's rule for Graphify, "Loom never installs it": settings show the commands
   and the user runs them. That is simpler but leaves agents and remote users stuck on a
   machine where nobody ran them.
2. **How a file is recognised.** Recommended: the `.b3d.py` suffix. The alternative, a
   `# loom: build123d` first-line marker, keeps ordinary names but makes Loom read every `.py`
   file in the workspace to list models, and the web would need the server to tell it each
   file's format.
3. **Permission to run Python models.** Recommended: terminal operate, as for the PCB render
   that runs tscircuit code (`apps/server/src/fork/rpcAuthorization.ts:42`). Clients without it
   still see STEP previews.
4. **STEP in Loom.** Recommended: preview and export STEP here, keep the "Fabrication app URL"
   setting as the fallback link when Python CAD is not set up, and update the user guide
   sentence "STEP files belong in the optional Fabrication app"
   (`docs/fork/user/model-preview-3d.md:27`).
