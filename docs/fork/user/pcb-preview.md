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
refill or modify the design.

**Add summary to draft** appends the report to your existing composer draft for review.
Nothing is sent automatically. **Copy summary** prepares the same text for another app.
Large drawings and reports are bounded; open the original design in its editor for all details.

If you use the separate Electronics app, save its URL in the PCB preview settings to open
the selected design there. This link is optional and is saved on this device. PCB preview
supports Loom's web and desktop clients with local or remote environments. It requires a
Loom server and is not available in the mobile client.

## Optional editor tools

Open Inspect to find components, pins and nets. The linked-drawing button beside the sheet
or layer menu shows the board and schematic side by side with the same selection
highlighted. Layers offers visibility, opacity, Solo/Restore and saved layer combinations.
Views saves the current position; Back/Forward revisits recent navigation. Distance, Angle
and Note in the drawing's tool bar pin measurements and notes to the current revision, and
Marks lists them. Hold Alt to skip pad snapping. **Capture** attaches the visible area, the
whole drawing or the 3D view to the composer draft for review.

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
`t3 pcb inspect '{"designId":"board.kicad_pcb"}'` reads board details.

CLI calls need an authenticated Loom MCP endpoint and authorization header in
`LOOM_MCP_ENDPOINT` and `LOOM_MCP_AUTHORIZATION`. ACP agent terminals inherit equivalent
credentials automatically. Editor camera, selection and capture actions require the thread
open on a connected Loom client; rendering, persistence and exports run on the host.
