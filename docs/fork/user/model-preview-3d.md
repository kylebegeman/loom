# Design and preview 3D parts

Open **3D model** from the right-panel launcher or its + menu, then search the workspace
for a file. Each selected file gets its own tab. The command palette offers the same file
list; optional shortcuts for opening the panel and capturing a view are in Keybindings.

Loom previews STL, 3MF, OBJ, glTF and GLB. Drag to orbit, drag with the middle or right
button to pan, and scroll to zoom. The floating tools choose a standard or saved view and
toggle wireframe, the bed and axes. **Display > Orthographic** switches to a projection where
parallel edges stay parallel, useful for checking alignment against a drawing. The **Bed** menu
in the viewport sets what the part rests on: a printer's build plate, a flat surface such as an
A4 sheet or a 1 m square, or a custom size, with a 10 mm grid, a 1 in grid or a plain surface.
Surfaces have no height limit. The choice is saved for the environment, so the Part tab,
variants and settings follow it.
Maximize the panel for a larger work area with the inspector alongside your part. In a narrow
panel the inspector opens as a sheet below the viewport; expand it for long forms, then return
to the viewport.

While the panel has focus, **F** fits the model, **O** and **H** choose orbit or pan,
**1** to **4** choose standard views, **W**, **G** and **A** toggle wireframe, bed and axes,
**P** switches perspective and orthographic projection, and **I** shows or hides the inspector.
The help button beside the zoom controls lists every shortcut.
Choose **Units** in the Bed menu or **Settings > Loom > 3D model** to display lengths in
millimetres or decimal inches. The command palette's **3D model: Switch units** changes the
same setting. Dimensions, measurements, section offsets and custom bed inputs follow it;
**Copy value** on a measurement copies the number in the selected unit. The grid pattern is a
separate choice. Customizer parameters keep the units defined by the SCAD source.

Stored lengths and agent tool values stay in millimetres. STL and OBJ are treated as mm, 3MF
uses its recorded units, and glTF is converted from metres. Changing display units leaves
model files and saved measurements unchanged. Draco-compressed glTF requires an uncompressed
export. Files above the environment's size limit need **Load anyway**.

For a sense of size, choose an object under **Bed > Show for scale**, or the same setting in
Loom settings. A card, coin or other reference sits beside the part at its real size and
appears in captures when it is in frame. It does not affect the part's dimensions, bed fit or
measurements. Fit and standard views frame the part, so zoom out if a large reference is out
of view. Choose **Nothing** to remove it; hiding the bed leaves the reference visible.

The panel reloads when a file changes and keeps the camera. For glTF, buffers and textures
must be below the model's directory, without parent-directory references. Close a tab to
stop watching its file. STEP files belong in the optional Fabrication app. Long jobs show
their current stage and elapsed time, and variant batches show completed counts. Your last
preview stays visible while a replacement is prepared; use Cancel to stop a variant batch.

## OpenSCAD

Install an [OpenSCAD development snapshot](https://openscad.org/downloads.html#snapshots)
on the environment host to preview SCAD. Snapshots support the faster Manifold backend,
geometry summaries and model-color export; stable 2021.01 lacks those capabilities.
In **Settings > Loom > 3D model**, set the executable path if automatic detection does not
find it. Save an edited executable path before refreshing detection. Refresh detection after
installing or changing the executable.

The inspector has five tabs: **Customize** and **Variants** for SCAD files, then **Markup**,
**Views** and **Part** for every model. A badge on a tab points to something that needs you,
such as open change requests or a part that is larger than the bed.

**Customize** edits customizer inputs. Pick a saved set from the menu at the top, search by
name, description or group, and drag a number field sideways to scrub it or click it to type
a value. A dot marks a changed field; click the dot to reset it. Changes render as you go;
turn off **Live** to make several edits, then choose **Apply**. A newer preview cancels the
previous render for that file. **Restore source defaults** returns to the values in the
SCAD file. Remembered values are isolated to each workspace; source edits discard overrides
for removed or incompatible parameters.

**Save parameter set** opens a naming dialog before updating the JSON sidecar next to the
SCAD file. Replacing an existing name updates that set and preserves the other sets. A failed
render leaves the last good mesh visible with a stale label, and **Part > Render log** shows
the errors and warnings. Changes to included files also trigger a render. If inputs change
during rendering, Loom discards that output; live reload prepares the new version, or choose
Refresh preview.

Settings control the render backend, timeout, color export and file-size limit. Choose the
bed from the **Bed** menu in the viewport, the printer menu in **Part**, or settings; set a
custom size in the **Bed** menu or settings. **Part** shows the dimensions against that bed;
oversized parts show a warning in the status bar and on the tab, and previewing them is still
allowed. **Part > Which beds fit?** compares the part with the available printers, surfaces
and your custom bed. Each row says whether it fits as shown, fits after a 90-degree turn, or exceeds
the bed by the listed dimensions. Select a row to use that bed. A rotated fit is advice; it does
not rotate the model. Surfaces check the footprint without a height limit. Clear render cache
removes cached outputs.

## Show the agent your part

**Capture** attaches the current view to the composer. Its menu attaches a four-view sheet
showing iso, front, top and right, or one of your saved review sheets. The four-view sheet is
always orthographic; current-view captures and saved review sheets keep their views' projections.
Capturing restores your working view afterward. Send the attachment with your next message;
remove it from the composer if you no longer need it.

The Capture menu also offers **Copy image** and **Save PNG** for the current view or four-view
sheet. Saved views and review sheets have the same actions in their row menus. The command
palette offers **3D model: Copy view image** and **3D model: Save view as PNG** for the current
view. Copy puts the image on the clipboard for another app; Save PNG exports the full image
without attaching it to the composer. When the browser cannot copy images, including plain HTTP connections to a
remote host, copy is disabled and Save PNG remains available. Measurement labels in captures
use the selected display unit.

Agents can call `loom_model_preview_3d_render` for SCAD, STL, 3MF and OBJ PNG views, logs and
geometry summaries. OpenSCAD runs on the environment host. **Let agents render models and propose variants** in
settings turns every 3D model agent tool on or off, independently of the panel. While it is off,
agents also cannot change 3D settings, including turning it back on. The tool returns host file paths
that the agent can read. It renders orthographic PNGs by default; agents can request
`projection: "perspective"` for perspective views. The result also compares the part against
your available beds when OpenSCAD provides geometry dimensions. It does not render glTF or GLB.

## Explore and review a design

**⌘Z** and **⇧⌘Z** (Ctrl on Windows and Linux) undo and redo parameter edits; the history
button in **Customize** lets you revisit any step. Continuous changes to one field become one
step. History survives switching file tabs during this session; source edits establish a new
baseline. With Live paused, undo and using a variant update the form first. Choose Apply to
update the mesh.

The tool rail on the left of the viewport measures (**M**), annotates (**N**) and adds a section
plane (**S**). Press **Esc** or **Done** to put a tool down. Measurements appear under
**Markup** with the distance and each axis delta; hide or delete one when it is no longer
needed. A changed mesh marks previous measurements stale; re-measure before relying on them.
The section plane strip chooses the X, Y or Z axis, the offset and which side to keep. Section
planes change the view, not the model file.

To ask for a change, annotate a point or drag over a region, then describe the change. **Save
draft** keeps it under **Markup**; **Save and add to composer** adds a marked capture and
context to your existing composer draft without sending it. After the agent changes the model,
open the request to compare the reference with the current model, move the pin if needed, then
accept the change or reopen it.

**Views** stores camera positions with their projection, display settings and section plane.
**Save current view** in the view menu or the tab saves one; click a row to return to it. Views
from earlier Loom versions open in perspective. Recalling a view from changed geometry refits
it. A review sheet captures up to four saved views as one image for the agent, with or without
measurements, and restores your working view afterward.

For SCAD, **Variants** stores design candidates without changing the active part. Add the current
values, a saved parameter set, or a parameter sweep that makes every combination of up to two
parameters (up to six values each and twelve variants per batch). Keep up to twenty-four
variants. Open a variant to rename it, edit its values, render it or **Use these values** in
Customize. Select variants to render them together, or select two and **Compare** them with
linked cameras and dimension and parameter differences. A variant can also be saved as a
parameter set. Variants from an older source use current defaults for removed or incompatible
parameters. Agents can propose variants with `loom_model_preview_3d_propose_variants`; you
choose whether to use them.

Views, measurements, review sheets, variants and change requests are saved for this model in
this environment and workspace. They survive closing the panel and are shared with other
clients connected to the same workspace. Print-readiness analysis remains a separate future
exploration.

## Blender and remote work

Loom previews files exported by Blender without running Blender. To let an agent work in
Blender, configure a Blender MCP server in that provider and install its matching Blender
add-on. Follow the [mcp-for-blender setup instructions](https://github.com/ahujasid/blender-mcp)
and verify that the configured executable exists. Export STL, OBJ or glTF into the workspace,
then open the export in Loom.

Model files and SCAD renders come from the selected environment, so the web and desktop
panel works with remote hosts as well as local ones. OpenSCAD and Blender belong on the
host that owns the workspace. Mobile has no 3D panel. Environments without Loom's 3D feature
show the panel as unavailable.

## Agent and terminal controls

Agents can use `loom_model_preview_3d_*` tools to inspect files, render meshes, save settings,
parameter sets and workspace tools, propose variants, and operate the visible editor. Camera,
picking, marked captures, customizer history and draft preparation use the connected client.
Host rendering and saved state remain available without opening the editor. Agents can change
projection or show and hide a scale reference through the editor's display action; its
snapshot reports the current projection and bed-fit results for the loaded model. Settings
tools can change the display unit, while tool inputs and outputs keep lengths in millimetres.

`t3 model <action> '<json>'` calls the same tools using their MCP suffix. It needs
`LOOM_MCP_ENDPOINT` and `LOOM_MCP_AUTHORIZATION`, or the credentials inherited by an ACP agent
terminal. PCB board references are standard GLB files with a separate mechanical metadata
file; open them here to build or review a case at the correct scale.
