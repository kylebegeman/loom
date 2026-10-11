# Preview circuit boards

Open **PCB preview** from the thread's right-panel launcher or command palette. Loom finds
KiCad projects, standalone schematics and boards, and tscircuit circuits in that thread's
workspace. Choose a design from the title menu, then switch between **Schematic**, **Board**
and **3D**. KiCad schematics can have multiple sheets; boards offer Front, Back and All
copper, including inner layers.

Use the wheel to zoom, drag to pan, or press F to fit while the drawing is focused. The
buttons along the right edge open tools such as Inspect, Layers and Checks beside the
drawing; in a narrow panel they sit along the bottom and open as a sheet you can expand.
Press I to show or hide the last tool, Esc to close it, 1, 2 and 3 to switch views, and V, M, A or N for
Select, Distance, Angle and Note. The **?** button in the navigation bar lists every
shortcut. Saved changes update the preview while it is visible. Long builds show elapsed
time and can be cancelled. A failed build keeps the last good drawing and its error log;
**Rebuild preview** in the **…** menu retries the saved design in the active 2D or 3D view.

Install **KiCad 9 or newer** or **tscircuit with Bun** on the environment host that owns the
files. Check detection in **Settings, Loom, PCB preview**. Loom searches PATH, standard
macOS KiCad installations, and the project's `node_modules/.bin/tsci`; it does not install
tools. The detection cache can take up to a minute to notice a new installation. tscircuit
previews run project code, so allow rendering only for projects you trust. Trust is saved
per environment and project on this device and can be revoked from the panel.

For KiCad, open **Checks** from the tool buttons, or select a check count in the status
bar, and run ERC for electrical rules or DRC for board rules. Reports
include errors, warnings and an option to show excluded findings. They persist across
reopening and are marked stale after a saved change. Checks use saved zones and do not
refill or modify the design. Findings also appear as pins on their board or schematic sheet.
Press `.` or `,` to step through them, including across sheets, and `C` to show or hide pins.
**Show excluded** applies to both the list and drawing. Select a pin or use Locate to open its
detail; Escape clears the selection before closing Checks. Captures include visible pins.

Choose **Review** in Checks for KiCad or tscircuit schematics. Eight deterministic heuristics
look for missing pulls, decoupling and protection, floating inputs, LED current limiting,
UART crossings and regulator issues. Every finding explains why it fired. These are review
hints, not a guarantee. **Rules** turns a rule off for the project or changes its parameters.
**Ignore here** saves a waiver with an optional note; **Show ignored** and **Stop ignoring**
restore it without rerunning. Enable automatic Review in **Check after each save** if desired.

ERC locations are corrected for KiCad 9 and early 10.0 releases. If an older report's scale
cannot be verified against the saved schematic, its list remains available and the log asks
you to run ERC again to restore locations.

**Add summary to draft** appends the report to your existing composer draft for review.
Nothing is sent automatically. **Copy summary** prepares the same text for another app.
Large drawings and reports are bounded; open the original design in its editor for all details.

If you use the separate Electronics app, save its URL in the PCB preview settings to open
the selected design there. This link is optional and is saved on this device. PCB preview
supports Loom's web and desktop clients with local or remote environments. It requires a
Loom server and is not available in the mobile client.

## Optional editor tools

Choose millimetres, mils or inches from the status bar or **Settings, Loom, PCB preview**.
Lengths and hardware dimension inputs follow that choice, saved on this device. An explicit
suffix such as `2 in` or `40 mil` overrides the selected unit. Saved files and agent tools
always use millimetres.

Open Inspect to find components, pins and nets. **Board stats** shows board size and area,
copper layers, holes and the smallest features, with measured values distinguished from
design rules. **Measure heights** builds the 3D board when needed to find the tallest
component. Add board stats to your draft to share the facts with an agent in millimetres.

The linked-drawing button beside the sheet or layer menu shows the board and schematic side
by side with the same selection highlighted. Layers offers visibility, opacity, Solo/Restore
and built-in sets for Assembly front/back, Copper only, Fab review and Silkscreen check.
Apply these from Layers or the drawing's layer menu. Hide unused presets on this device and
show them again from **Preset options**. Duplicate a preset as a saved set to customize it,
or save the current layer combination; saved sets belong to the design.

Views saves the current position; Back/Forward revisits recent navigation. Distance, Angle
and Note in the drawing's tool bar pin measurements and notes to the current revision, and
Marks lists them. Hold Alt to skip pad snapping.

**Capture** attaches the visible area, whole drawing or 3D view to the composer draft. Its
menu also copies an image or saves a PNG; choose 1× or 2× for 2D PNGs. **Save SVG** exports
an editable 2D drawing with visible layers and markup, using CAD colours on a light
background. Copy image needs a secure connection and browser image clipboard support.
Downloads also work over remote HTTP connections; 3D captures save as PNG.

Compare accepts a Git commit or agent checkpoint and compares it with another revision or
the saved working tree. Structural and connectivity changes help locate changes. Board overlays
are aligned; schematic-only designs show their root-sheet comparison. 3D
rotates the board using real geometry exported by the installed CAD tools. Component shapes
depend on locally available models; check the export log if a component is missing.

Simulate runs **ngspice** on the environment host. Use operating point, transient or frequency
response, choose probes and optional parameter sweeps, then save a setup or export CSV. A
circuit needs suitable SPICE models and ground. You can provide a workspace netlist when
its CAD export is not simulation-ready.

Parameters reads explicitly declared tscircuit values. Review the proposed source, then apply
it or save a variant. Ask the agent to add the parameter schema and source markers when no
parameters appear. Applying checks that the source has not changed since review.

## Print at true scale

Choose **…**, **Print at 1:1…** to create a PDF of the top or bottom board. Choose layers,
paper and colour options; bottom is mirrored by default. Print at **100%** and check that
the reference bar measures **50 mm** before laying real parts on their footprints.

Download the PDF on this device, or use **Save to workspace** to keep it under `fab/print/`.
Local desktop clients can open the saved PDF or show its folder. The original design stays
unchanged. For tscircuit, allow circuit code rendering first; printing needs KiCad on the
host too.

## Hardware and cases

Library keeps hardware references and owned inventory on the connected environment. Starter
entries link to manufacturer information. Add local schematics, boards, models and companion
files with their provenance. Use assets in this project copies linked files into a reusable
project folder, preserving originals. Add reference to draft prepares context for the agent.

**Export board reference** in the **…** menu saves a GLB and mechanical metadata to this workspace, or to a destination
thread ID on the same environment. Share those paths with an enclosure-design agent. Export
prepares context in your draft and never sends a message to another thread.

## Agent and terminal access

Agents use `loom_pcb_*` tools for PCB operations and `loom_model_preview_3d_*` for the 3D
workspace. The same actions are available with `t3 pcb <action> '<json>'` and
`t3 model <action> '<json>'`; action names match the MCP suffix. For example,
`t3 pcb inspect '{"designId":"board.kicad_pcb"}'` reads board details, and
`t3 pcb print '{"designId":"board.kicad_pcb","side":"bottom"}'` saves a true-scale PDF.

CLI calls need an authenticated Loom MCP endpoint and authorization header in
`LOOM_MCP_ENDPOINT` and `LOOM_MCP_AUTHORIZATION`. ACP agent terminals inherit equivalent
credentials automatically. Editor camera, selection and capture actions require the thread
open on a connected Loom client; rendering, persistence and exports run on the host.

Enable **Check after each save** in Checks to run ERC, DRC, or both for this project while a design is open or an agent reads fresh checks. Reports show new and resolved findings. Slow checks pause until a fast manual run; failed automatic checks preserve the last report and retry after the next save.

Select a part in Inspect and open **Pin map** to copy its connections or generate firmware constants for C, Rust, MicroPython, CircuitPython or Arduino. GPIO identities come from pin names; verify them against the datasheet and your board core. Save requires a workspace write grant and confirmation before replacing an existing file.

When an agent changes a design, choose **Open board** in its changed-files card. Related project files and imported sources are grouped into one design. PCB settings can open designs automatically or turn off offers. If PCB tabs are already open, new designs arrive in background tabs. The command palette can open designs from the last relevant turn.

After a design reloads, press **D** or choose **Changed** to highlight parts, connections and drawing areas that changed since the previous view. The list can focus a part or net; dismissing hides it until the next change. Agents can read the same list through the editor snapshot.

Select a component or net and press **R** to request a change. With nothing selected, drag an area. Add the marked capture and request to your draft, or save requests and select up to ten in **Requests** for one batch. An agent can mark a request ready for review, but only you can accept or reopen it. **Compare** uses the revision when you asked and freezes the result on acceptance when Git capture succeeds. Without Git, use the reference image and **Capture now**. Notes can become requests from Marks; deleting that request does not restore the note.

## Check a fab's limits

In **Checks**, choose **Fab**, select a manufacturer profile and run the check. Findings show features below its limits and possible cost drivers. Limits include their sources and checked dates. Cost drivers are estimates to review when ordering.

Use **Fab capabilities** there or in PCB settings to duplicate a built-in profile, edit your own limits and choose a default. Profiles belong to the connected environment. Changing a board or profile marks previous results out of date. Fab checks currently need a KiCad board and run on a temporary copy.

## Fabrication packages

Choose **…**, **Create fab package…**, or open **Fabrication**. Select Generic or JLCPCB, choose a fab check for a KiCad board, and include assembly files when needed. Loom writes a new folder under `fab/` with Gerbers, drill files, assembly files and a readiness checklist. Identical inputs reuse a package; **Rebuild identical inputs** creates another. Download the Gerber zip for your fab, then use the separate BOM and CPL files for assembly.

For JLCPCB rotation corrections, add a `JLCPCB Rotation Offset` field to a part, or add lines such as `SOIC.*,90` to `fab/rotations.csv`. Part fields take precedence. Check rotations, polarity and pin 1 in the fab's placement preview. Missing part numbers or assembly metadata appear in the checklist.

The preview currently shows a **board plot of the packaged layers** for KiCad. It warns if the saved board has changed; inspect the exported zip in your fab's viewer before ordering. Loom does not upload or order. To ignore generated folders in Git while keeping your rotation rules, add `/fab/*/` to `.gitignore` yourself.

## Design history

Press `T` or use History to view the versions saved at the end of this thread's turns in a Git workspace. Use `[` and `]` to step between versions, switch between schematic, board and 3D, or compare a version with the current files. Historical views are read-only. Back to current returns to your saved files.

Restore this version replaces the board, project and schematics together and offers one Undo. Supporting libraries and assets, and removal of files added since that version, are optional and off by default. Close KiCad before restoring. Compare lists this thread's turns alongside the design's Git commits.

Agents can use `loom_pcb_history` and `loom_pcb_restore_version`, or `t3 pcb history` and `t3 pcb restore_version`. Pass a history checkpoint ID to render or export an earlier version. Historical 3D previews use the component models installed on the environment today.

## Measure the 3D board

Open **3D**, press `P` for orthographic projection, and use **Display** to hide board layers or component sides. Open **Section plane** to cut through the board and its parts. **Measure** (`M`) measures two points; switch to **Height** for clearance above or below the board. Hold Alt while clicking for a free point. **Heights** lists component heights, including leads below the board, and selecting a row draws that height. Measurements clear when the board reloads or you leave 3D; display settings stay while the workspace is open.

Agents can use the PCB editor's `display`, `section`, `measure` and `height` actions. For example, `t3 pcb editor '{"designId":"board.kicad_pcb","command":{"action":"height","reference":"J1"}}'` reads J1's height in a loaded, current 3D view. `snapshot` reports the display settings, measurements and component heights.

The workspace supports screen readers with named drawings and announcements for selections, views, check results and finding navigation. Press `I` to move focus into the tools; close them with `I` or Escape to return to the drawing.

## Make a board enclosure

Open **Enclosure** on a saved board to preview a parametric tray, lid and screw bosses. Set
clearances and optional connector overrides, then **Generate case**. Loom writes an OpenSCAD
starter beside the design and opens an assembly containing the board, case and lid. The
build123d option creates an additional Python CAD source when supported. KiCad boards need
KiCad 10 or newer for the reference export.

Use **Use an existing case** with a workspace model path to place the board over your own
case. In the model panel's **Fit** tab, check walls, component clearance, connector openings
and mounting holes. Tune the case parameters and check again. Missing component models use
an editable assumed height; the checks use conservative component boxes. Verify the finished
case against the exact board before fabrication.

**Update board** replaces a stale reference while preserving drawing placement. Edited case
sources are kept when regenerating unless you choose to overwrite them. The assembly and
sources are ordinary workspace files; remove them to discard a generated case. Agents can
use `loom_pcb_enclosure` or `t3 pcb enclosure`; `preview: true` returns sources without writing.
