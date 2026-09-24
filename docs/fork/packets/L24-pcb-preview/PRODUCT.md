# L24 product

## Problem

Kyle designs small circuit boards with coding agents, in KiCad and in tscircuit (circuits
as TypeScript). Today he has to leave Loom and open KiCad or `tsci dev` to see what the
agent changed, and has to read raw `kicad-cli` output in the terminal to know whether the
board passes its checks. He wants to see the schematic and board next to the thread, and
see the rule violations, while the agent works.

## What the user can do

- Open the PCB panel from the right panel launcher, the command palette, or a keybinding
  they assign.
- See every board design in the thread's workspace (KiCad projects and tscircuit circuits)
  and pick one. The panel remembers the last picked design per project.
- Switch between Schematic and PCB views. Schematics show one sheet at a time with a sheet
  picker; the PCB view has layer presets: Front, Back, All copper.
- Zoom and pan the drawing, fit it to the panel, and refresh it by hand.
- Watch the drawing update after the agent (or the user in KiCad) saves the design files,
  while the panel is visible.
- Run ERC (schematic) or DRC (board) for a KiCad design and read the violations, grouped
  into errors and warnings, each with its rule, description and the affected items with
  positions. "Send summary to chat" puts a plain-text summary into the thread's composer for
  the user to edit and send; "Copy summary" copies the same text.
- See which tools the server found, in Settings, Loom, PCB preview, and follow a link to
  install instructions when one is missing.
- Open the current design in the standalone Electronics app, when its URL is set in
  settings: "Open in Electronics" goes straight to that board's page.

## Entry points

| Entry                                                | Way in                                                                                                | Way out                                                   | Where the state shows                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Right panel launcher ("Open a surface") and "+" menu | "PCB preview"                                                                                         | Close the tab (x on the tab)                              | The panel tab, titled "PCB preview"; the design name shows in the toolbar |
| Command palette                                      | "Open PCB preview" (`>pcb`)                                                                           | "Close PCB preview" appears when it is the active surface | Same                                                                      |
| Keybinding                                           | `loom.pcb-preview.toggle`, unbound by default; the user binds it in Settings, Keybindings             | The same key closes it when it is the active surface      | Same                                                                      |
| Settings                                             | Settings, Loom, PCB preview: detected `kicad-cli` and `tsci`, their versions, the Electronics app URL | Clear the URL field                                       | The section itself                                                        |
| Chat                                                 | None in v1 (clicking a `.kicad_pcb` path in chat does not open the panel)                             |                                                           |                                                                           |
| Checks view: "Send summary to chat"                  | Puts the check summary into the thread's composer (appended after a blank line if a draft exists)     | Edit or clear the composer; nothing is sent               | The composer                                                              |
| Toolbar menu: "Open in Electronics"                  | Opens `<Electronics URL>/designs/by-path?path=<absolute entry path>` in the browser                   | Close that tab                                            | Only shown when the Electronics URL is set                                |

## States

- **Needs a Loom server:** the environment lacks `pcb-preview` in `loomFeatures`. The
  launcher entry is disabled with "Needs a Loom server with PCB preview"; a stale tab shows
  the same line.
- **Loading designs:** a small spinner and "Looking for boards" while the workspace search
  runs.
- **No designs:** "No KiCad or tscircuit designs in this project." with a one-line hint:
  "Add a `.kicad_pro` or a `*.circuit.tsx` file, or ask the agent to create one."
- **Tool missing:** for a KiCad design without `kicad-cli`: "KiCad 9 or newer is needed to
  render this design." with a link to https://www.kicad.org/download/. For a tscircuit
  design without `tsci`: "The tscircuit CLI is needed. Add `tscircuit` to the project or
  install it globally." with a link to https://docs.tscircuit.com/intro/installation.
  The rest of the panel (design list) still works.
- **Old KiCad:** `kicad-cli version` below 9: "This panel needs KiCad 9 or newer; found
  <version>."
- **Run project code (tscircuit only):** building a tscircuit design runs the project's
  TypeScript. The first render per project asks: "Rendering runs this project's circuit code
  with tsci on <environment name>. Render?" with Render and Cancel. The answer is remembered
  per project on this device.
- **Rendering:** the previous drawing stays visible, dimmed, with "Rendering" in the toolbar.
  A first render shows a centered spinner.
- **Render failed:** the tool's exit code and the last 40 lines of its output in a
  monospaced block, a Retry button, and the previous drawing (if any) kept below with
  "Showing the last good render".
- **Too large:** a sheet over the size cap (4 MiB of SVG) shows "This sheet is too large
  to preview here (N MiB). Open it in KiCad." instead of the drawing.
- **Checks idle:** "Run ERC" / "Run DRC" buttons with "Not run yet".
- **Checks running:** the button shows a spinner; other buttons stay usable.
- **Checks passed:** "No violations. ERC ran <relative time> with KiCad <version>." "Send
  summary to chat" still works (it says there are no violations).
- **Checks found violations:** counts in the tab label ("Checks 3"), grouped list,
  excluded violations hidden behind "Show excluded (n)".
- **Checks failed to run:** the tool output, as for a render failure.
- **Stale:** when files changed after the last check run, the check header says "Files
  changed since this run" with a Run again button. Checks never re-run automatically; they
  can be slow on large boards.

## Surfaces and connection modes

- Web and desktop: full feature. Desktop uses the same web bundle.
- Mobile: not supported and not shown. The upstream mobile app ignores fork data.
- Remote environments (Tailscale, T3 Connect): supported. Rendering happens on the
  environment's server, which is where the files and tools are; the client only receives
  SVG text and check results over the WebSocket.
- Upstream T3 server: disabled entry, as above.

## Decisions

- SVG, not PNG or an embedded viewer. KiCad and tscircuit both export SVG, it scales without
  a GPU, and it keeps the payload text. The drawing is shown through an `<img>` element
  from a Blob URL, so scripts in a hostile SVG never run.
- Rendering runs on the environment server with the user's own `kicad-cli` and `tsci`.
  Loom downloads and installs nothing.
- ERC and DRC run only when the user asks. Renders run automatically while visible.
- tscircuit rendering asks once per project because it executes project code.
- No dependency on the Electronics app. It owns fabrication, parts and ordering; this panel
  owns "look at the board next to the chat".
- Tool detection only in v1 (Kyle): `PATH`, `/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli`
  and the project's `node_modules/.bin/tsci`, with no custom path settings. It covers the
  standard installs and needs no settings storage; custom paths are a follow-up. KiCad is not
  installed on Kyle's Mac yet, so the missing-tool state is the first one he will see.
- "Open in Electronics" deep-links to `/designs/by-path?path=<abs>` (Kyle), which the
  Electronics spec now defines. The path is the design's entry file on the environment host,
  so the link lands on the right board when the Electronics app runs on that machine.
- "Send summary to chat" is in v1 (Kyle): it fills the composer and never sends, so the user
  stays in control of what the agent reads. "Copy summary" stays for other destinations.
- Uses upstream's composer draft store instead of `ext-composer`: same behavior Kyle chose
  (fills, never sends), no seam.
