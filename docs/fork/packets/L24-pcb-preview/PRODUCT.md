# L24 product

Kyle wants to move from an idea to a physical product while working with agents in Loom.
The PCB surface opens like an editor. Layers, inspection, comparison, simulation, parameters
and the hardware library are optional tools, without a mandatory sequence or educational flow.

## Editing and inspection

Open PCB preview from the panel launcher, command palette or an assigned
`loom.pcb-preview.toggle` shortcut. Pick a KiCad or tscircuit design. The workspace follows
the 3D design workspace: a document bar for the design, view and capture; a canvas with
floating sheet or layer, drawing tool and navigation shelves; one inspector opened from a
labelled rail; and a status bar. Wide panels dock the inspector to the right. Compact panels
move the rail to the bottom and open the inspector as an expandable sheet. Light/dark backgrounds follow Loom's theme.

Schematic sheets and board drawings support keyboard and pointer navigation, recent view
history and named views. KiCad layers have visibility, opacity, Solo/Restore and saved
combinations; custom copper names retain their canonical identities. Component, pin and net
selection highlights the current and linked drawings. Distance, angle and note tools create
revision-aware marks. Captures attach to the existing draft with context and never send it.

KiCad ERC/DRC runs on request against saved zones, without modifying/refilling the board.
Reports persist, show exclusions and staleness, and can be copied or added to a draft.
Comparison accepts Git commits, agent checkpoints and the current saved working tree.
It offers structural changes plus aligned overlays or side-by-side board drawings.

## Design tools

3D exports the saved board to a real GLB on the host and opens the L23 renderer. Rotate,
zoom, Fit and standard views work with rendering only after input/load/resize. Available
component geometry depends on installed CAD models; the export log explains missing models.

Simulation uses installed ngspice, valid component models, ground and a usable exported or
workspace netlist. Operating-point values, transient/frequency plots, AC magnitude/phase,
probes and numeric sweeps are available. Save/remove setups and export CSV. A simulator is
not an electronics signoff tool, and no learning curriculum is included.

tscircuit parameters come from a sidecar schema and unique `/* loom:param key */` literals.
The editor shows current values, bounds and choices, reviews proposed source, checks its
revision before writing, and saves/removes variants. Loom does not infer writable source
from arbitrary TypeScript. Arbitrary circuit authoring remains an agent or external CAD task.

## Hardware and enclosure references

The environment library starts with manufacturer references for Pico, Uno, ESP32 and Feather.
Entries can record exact revisions, ownership, quantity, dimensions, provenance and local
schematics, boards, pinouts, datasheets or models. Starter references do not claim inventory
or redistribute external CAD assets. Link companion files before importing multi-file CAD.
Imports preserve originals and use content-addressed project directories.

Export board reference saves a GLB and revision-aware mechanical metadata to this thread or
an explicitly selected destination thread workspace. Other agents can build cases around
those files. The action prepares a draft in the invoking thread and never sends a message.

## Agent parity and states

MCP and CLI cover host rendering, checks, inspection, revisions, simulation, parameters,
workspace/library persistence, asset reuse and reference export. Editor commands cover open,
close/maximize, views, camera, layers, selection, tools, picks, captures, summary preparation,
refresh/cancel and snapshots. Captures return host files. Saved state operations include removal.
The CLI uses the same authenticated MCP boundary, not an unauthenticated local shortcut.

Builds and other long tasks show elapsed progress, with cancellation where the underlying
job is cancellable. Empty/tool-missing/trust/failure/retry states remain usable; the last good
drawing survives a failed rebuild. tscircuit project execution requires the client's trust
choice for UI tools. Agent access follows its existing thread/environment authority.

Web and desktop are supported. Mobile has no PCB UI. A server without the capability shows
an unavailable launcher. Files/tools always belong to the selected environment. Electronics
is an optional URL configured in Settings, Loom, PCB preview; no workflow depends on it.

## Decisions

Kyle selected the full original packet on 2026-09-27 and approved the expansion in this
thread on 2026-10-07/08. Keep the editor simple and agent-accessible. Education is secondary
and excluded. Slicing, print readiness, fabrication packages, costing and ordering are not
part of this implementation. Tool detection remains PATH/standard-install/project-local;
Loom does not manage CAD installations. No new dependency or database migration was needed.
