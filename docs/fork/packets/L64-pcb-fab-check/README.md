# L64: Fab capabilities and manufacturability check

Status: Implemented locally

Implemented on `feat/pcb-units-presets-stats-print-capture`. Focused profile, classification, service, interruption, marker, MCP and permission checks cover the host and client contracts. Real-client, remote and real-KiCad checks remain pending.

Approved by Kyle on 2026-10-10.

Kyle can pick a fab (JLCPCB, PCBWay, OSH Park, or his own entry) and ask whether a KiCad board
can be made there before ordering. The Checks tab gets a third card, **Fab**, that runs KiCad's
DRC with that fab's limits on a temporary copy of the board and lists every track, gap, hole,
via, annular ring and edge clearance below the limit, drawn on the board like DRC findings. It
also flags board-level mismatches (layer count, thickness, finish) and the things that make a
board cost more at that fab (small vias, extra layers, size above the cheap tier, castellated
edges, via-in-pad). Built-in fab entries ship with a source link and the date they were checked;
Kyle can duplicate one, edit it and make it his default. Agents run the same check with
`loom_pcb_fab_check` and manage entries with `loom_pcb_fab_capabilities`.

## Scope

- In:
  - The shared fab capability definition from PCB-FOLLOW-UPS.md, in a new contracts file
    `packages/contracts/src/fork/pcb-fab.ts`, including the two optional limits.
  - Built-ins as data with source URLs and a checked date of 2026-10-10: JLCPCB standard,
    JLCPCB advanced, PCBWay standard, OSH Park 2-layer, OSH Park 4-layer. Values a fab does not
    publish are null and marked "not published" in the notes.
  - User entries, environment-wide, in
    `<stateDir>/fork/pcb-preview/workspaces/fab-capabilities.json`
    with an optimistic version, like the hardware library. Up to 24 entries and a default.
  - The check: `kicad-cli pcb drc` on a temporary copy with appended fab rules and the board's
    own minimums cleared, so only fab limits apply. Never writes the user's files.
  - Board facts beyond DRC: copper layer count, thickness, finish, size, castellated pads,
    via-in-pad, and the via and drill sizes the cost rules need.
  - A cost-driver report per fab, from published pricing rules kept as data with sources.
  - Findings with source `"fab"`, drawn by L52's markers when L52 is present.
  - Manage dialog (Checks tab and PCB settings), fab picker, default fab.
  - MCP tools `loom_pcb_fab_capabilities`, `loom_pcb_save_fab_capabilities`,
    `loom_pcb_fab_check`, `loom_pcb_latest_fab_check`, and therefore `t3 pcb` actions.
- Out:
  - tscircuit designs. DRC needs a KiCad board. A later step can reuse L57's temporary
    `tsci export -f kicad_pcb` path. The Fab card says "Fab checks need a KiCad board".
  - Prices, quotes, ordering, uploads or any network call. Cost drivers are qualitative, except
    OSH Park, whose published per-area price gives an estimate.
  - Assembly (PCBA) capabilities, stencil, impedance and panelisation.
  - Mobile.

## Surfaces

- Web and desktop: supported.
- Mobile: not supported. Mobile has no PCB panel.
- Remote: works over LAN, Tailscale and T3 Connect. Results are small JSON over RPC; KiCad runs
  on the environment host.

## Extension points used

None new. Reuses L24's `ext-panels` (Checks tab), `ext-settings` (PCB preview settings
section), `ext-mcp` and `ext-cli`.

## Packet seams

None. Every file is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. KiCad 9 or newer on the environment host, as for L24. KiCad 10 also refills zones before
the check.

## Relationship to other follow-up packets

- L52 (check markers): with it, fab findings convert to `PcbFinding` with source `"fab"` through
  `checkFindings` and appear on the board with next and previous keys. Without it, the Fab card
  lists findings with Locate, exactly like DRC today.
- L55 (board stats): with it, board facts come from `boardStats` and the Fab card shows the
  measured minimums beside the fab limits. Without it, `fabCheck.ts` reads the few facts it
  needs from the board text itself.
- L54 (units): with it, limits and findings display in the chosen unit, and the edit dialog
  takes that unit. Stored values stay in millimetres. Without it, millimetres.
- L65 (fab package): reads the shared definition and the latest fab check for its checklist.
  L64 does not need L65.
- L58 (auto checks): could run the fab check after saves later; not part of this packet.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
