# L24: PCB preview

Status: Ready to build. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

A right panel that shows the circuit boards in the thread's project. It finds KiCad projects
and tscircuit circuits in the workspace, renders their schematic and board views to SVG on
the environment server (with `kicad-cli` and `tsci`), re-renders when the files change, and
runs KiCad's electrical rules check (ERC) and design rules check (DRC) with the violations
listed in the panel. The user and the agent can look at the same board while the agent
edits it.

## Scope

- In:
  - Design discovery in the thread's workspace: KiCad projects (`*.kicad_pro`, or a lone
    `*.kicad_sch` / `*.kicad_pcb`) and tscircuit circuits (`*.circuit.tsx`, or the entrypoint
    of a `tscircuit.config.json` project).
  - Schematic view (one page per sheet) and PCB view (front, back, or all copper layer
    presets) as SVG, with fit, zoom and pan.
  - Automatic re-render while the panel is visible and the design's files change on disk.
  - KiCad ERC and DRC on demand, violations grouped by severity with their location text,
    and a plain-text summary: "Send summary to chat" puts it in the thread's composer (never
    sends), "Copy summary" copies it.
  - Tool detection with clear setup states ("KiCad not found", "tscircuit CLI not found").
    Detection only: `PATH`, `/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli`, and the
    project's `node_modules/.bin/tsci`.
  - A Loom settings section showing the detected tools, and an optional link to the
    standalone Electronics app. "Open in Electronics" deep-links to the design with
    `<url>/designs/by-path?path=<abs>`, a page Kyle's Electronics spec now defines.
  - Command palette entry and an unbound keybinding command to toggle the panel.
- Out:
  - Editing boards or schematics, part search, BOM, costing, Gerbers, order packages, 3D
    renders. Those belong to the standalone Electronics app
    (`~/Developer/docs/apps/electronics/`), which this panel only links to.
  - tscircuit checks beyond the build log (tscircuit DRC findings are shown as raw log
    text, not parsed), and ERC/DRC for tscircuit designs (that needs a KiCad export; the
    Electronics app owns it).
  - Agent-facing MCP tools. Agents can already run `kicad-cli` in the terminal, and the
    Electronics app has its own MCP server.
  - Follow-up: custom tool paths per environment in settings. Kyle chose detection only for
    v1; add overrides only if a real install is missed.
  - Mobile UI.

## Surfaces

- Web and desktop: supported. Everything runs on the environment server and reaches the
  client over the WebSocket RPC, so it works locally, over Tailscale and through T3 Connect.
- Mobile: not supported. Mobile has no right panel system; the upstream App Store app never
  shows fork UI.
- Upstream T3 server: the launcher entry is shown disabled with "Needs a Loom server with PCB
  preview".

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (fork RPC group, `ForkLayer`, `loomFeatures`), may create it.
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels), may create it.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings), may create it.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), may create it.
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (for the unbound toggle command), may create them.

Not `ext-composer`: "Send summary to chat" writes the draft through upstream's public
composer draft store (`setPrompt`), the same path L06 uses, so it needs no composer seam.

No persistence migrations: the render cache is files under `<stateDir>/fork/pcb-preview/`.

## Packet seams

None. Everything goes through extension points.

## Optional integrations

- The standalone Electronics app (`~/Developer/docs/apps/electronics/`, default port 7450).
  If the user sets its URL in the Loom settings section, the panel shows "Open in
  Electronics", which opens `/designs/by-path?path=<absolute entry path>` (defined in the
  Electronics spec, SPEC.md section 5 and ARCHITECTURE.md "Loom preview contract"). Nothing
  in this packet requires the app to exist or be running.
- If packet L12 (panel picker) is present, the panel shows up there automatically through the
  fork panel registry. No work in this packet.

## Size

Medium: about 1,850 lines including tests. One agent, 2 to 3 days.

## How an agent starts

Read `AGENTS.md`, `FORK.md`, the packets `README.md`, `CONVENTIONS.md`,
`EXTENSION-POINTS.md`, then this folder in order: PRODUCT, TECHNICAL, SEAMS,
IMPLEMENTATION, TESTING, REFERENCES. KiCad is not installed on Kyle's Mac yet (2026-09-24):
ask Kyle to install KiCad 10 (and optionally `tscircuit`) before the manual check; the
automated tests do not need either tool.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
