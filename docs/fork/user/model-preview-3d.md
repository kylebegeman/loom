# Design and preview 3D parts

Open **3D model** from the right-panel launcher or its + menu, then search the workspace
for a file. Each selected file gets its own tab. The command palette offers the same file
list; optional shortcuts for opening the panel and capturing a view are in Keybindings.

Loom previews STL, 3MF, OBJ, glTF and GLB. Use the floating viewport tools to orbit,
pan, zoom or choose a standard view. Maximize the panel for a larger work area with the
inspector alongside your part. In a narrow panel, expand the inspector when editing
long forms, then return to the viewport. While the canvas is focused, **F** fits the
model, **O** selects orbit, **H** selects pan and **1–4** choose standard views.
Dimensions are in millimetres: STL and OBJ are treated as mm, 3MF uses its recorded units,
and glTF is converted from metres. Draco-compressed glTF requires an uncompressed export.
Files above the environment's size limit need **Load anyway**.

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

Open the inspector's **Parameters** section to edit customizer inputs or select a saved
set. Search by name, description or group, and enter precise values beside the sliders.
Changes preview automatically; turn off **Auto preview** to make several edits, then
choose **Apply changes**. A newer preview cancels the previous render for that file.
Reset an individual field or all changes to the selected set; **Restore source defaults**
returns to the values in the SCAD file. Remembered values are isolated to each workspace;
source edits discard overrides for removed or incompatible parameters.

**Save parameter set** opens a naming dialog before updating the JSON sidecar next to
the SCAD file. Replacing an existing name updates that set and preserves the other sets. The render log shows errors and warnings. A failed render leaves the last
good mesh visible with a stale label. Changes to included files also trigger a render. If inputs change during rendering, Loom
discards that output; live reload prepares the new version, or choose Refresh preview.

Settings control the render backend, timeout, color export and file-size limit. Choose the
Bambu Lab H2D, Bambu Lab H2C, Anycubic Kobra S1, or a custom build volume. Oversized parts
show a warning; previewing them is still allowed. Clear render cache removes cached outputs.

## Show the agent your part

**Capture** attaches the current view to the composer. **Capture > Four-view sheet** attaches one sheet
showing iso, front, top and right. Send the attachment with your next message; remove it
from the composer if you no longer need it.

Agents can call `loom_model_preview_3d_render` for SCAD, STL, 3MF and OBJ PNG views, logs and
geometry summaries. OpenSCAD runs on the environment host. **Let agents render models and propose variants** in
settings controls rendering and variant proposals independently of the panel. The tool returns host file paths
that the agent can read. It does not render glTF or GLB.

## Explore and review a design

**Parameters > History** lets you undo, redo or revisit an edit. Continuous changes to one
field become one step. History survives switching file tabs during this session; source edits
establish a new baseline. With Auto preview paused, undo and candidate promotion update the
form first. Choose Apply changes to update the mesh.

Use **Tools** to measure between two surface points or reveal an interior with an X, Y or Z
section plane. Measurements include the distance and each axis delta. Hide or delete a saved
measurement when it is no longer needed. A changed mesh marks previous measurements stale;
re-measure before relying on them. Section planes change the view, not the model file.

In **Views**, name and save the current camera, display settings and section plane. Select up
to four views and save a capture preset to repeat a review sheet later. Recalling a view from
changed geometry refits it. Capture sheets attach to the composer and restore your working
view afterward.

For SCAD, **Variants** stores candidates without changing the active part. Save current
values, import saved sets, or generate combinations from one or two parameters. Candidate
edits use OpenSCAD literals, including quotes around strings; **Save values** applies all
edits together. Candidates from an older source use current defaults for removed or
incompatible parameters when rendered or promoted. A sweep
accepts up to six comma-separated values per parameter and twelve combinations per batch.
Keep up to twenty-four candidates, render selected candidates or the whole batch, and cancel
when needed. Compare two candidates with linked cameras, dimension differences and parameter
differences. **Use candidate** moves its values into Parameters; **Save as set** opens a naming
dialog and explicitly identifies replacements. Agents can propose candidates with
`loom_model_preview_3d_propose_variants`; you choose whether to use them.

Choose the annotate tool and click or drag over a model surface, then describe the requested
change in **Review**. Saving keeps a marked reference image and applied parameters.
**Prepare agent request** adds a marked capture and context to your existing composer draft;
it never sends the message. After a change, compare the current model with the reference,
reselect a changed region if needed, then accept the result or reopen the request.

Views, measurements, capture presets, variants and annotations are saved for this model in
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
