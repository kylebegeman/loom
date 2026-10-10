# L03: Compaction and goal shortcuts

Status: Ready to build. The fork's own goals are retired (see [Retired parts](#retired-parts)).

Keyboard and palette shortcuts for two thread commands upstream already has. Compaction:
upstream compacts a conversation on demand for every provider (the "Compact context" button
in the context meter and `/compact`), but only from those two places; this packet adds
"Compact conversation" to the command palette and a keybinding, with the same rules upstream
applies. Goals: upstream has native `/goal` for Codex and Claude, with a goal row above the
composer; this packet adds palette items and a keybinding that send upstream's own `/goal`
commands.

## Retired parts

Kyle approved these retirements on 2026-10-09.

- **Fork goals** (a goal table, a chip above the timeline, a "Set goal" composer footer
  button, Working/Paused/Met states and delivery of the goal with every turn through
  `ext-turn-input`). Covered by upstream's native `/goal` for Codex and Claude, with its
  banner above the composer. The goal store, RPCs, cleanup reactor, turn input contributor,
  composer button and the `ChatView.tsx` chip seam are no longer part of this packet.

## Scope

- In:
  - Palette item "Compact conversation" and the unbound keybinding command
    `loom.compaction-and-goals.compact`, dispatching upstream's own `/compact` turn, gated
    the way upstream gates its button.
  - A documented per-provider compaction table (all six adapters already support it
    upstream; nothing to add per adapter).
  - Palette items "Set goal", "Pause goal", "Resume goal" and "Clear goal" and the unbound
    keybinding command `loom.compaction-and-goals.goal` (opens the set goal dialog). They
    send upstream's `/goal <objective>`, `/goal pause`, `/goal resume` and `/goal clear`
    turns, shown only where upstream supports them (Codex and Claude; pause and resume for
    Codex only).
  - Everything works against upstream T3 servers too: the packet only sends upstream
    commands.
- Out:
  - A fork goal store, chip or per-turn goal delivery (retired, see above).
  - Compaction with custom focus instructions (`/compact <focus>`): upstream only recognizes
    the exact text `/compact`.
  - Auto-compaction settings (upstream owns them, for example Claude's threshold).
  - Mobile UI.

## Surfaces

Web and desktop: supported. Mobile: not supported (the phone keeps upstream's own goal row
and `/compact`). Remote: works over every connection mode (upstream turn commands over the
WebSocket). Upstream T3 server: works; there is no fork server code.

## Extension points used

- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (two unbound commands).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (compaction and goal items).

## Packet seams

None.

## Size

About 450 to 600 lines including tests, all web: availability rules, the set goal dialog,
the palette source and the keybinding host.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
every file here. The citations in TECHNICAL.md predate V2; recheck them against current
source first.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
