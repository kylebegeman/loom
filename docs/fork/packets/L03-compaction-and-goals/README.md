# L03: Manual compaction and pinned goals

Status: Ready to build.

Two small thread controls. Compaction: upstream already compacts a conversation on demand
for every provider (the "Compact context" button in the context meter and `/compact`), but
only from those two places; this packet adds "Compact conversation" to the command palette
and a keybinding, with the same rules upstream applies. Goals: the user pins a standing
objective to a thread ("Get the iOS build green without touching the API"), shown as a chip
above the timeline with Working, Paused and Met states, and set from a "Set goal" button in
the composer footer. While the goal is active, Loom prepends it to every turn the provider
receives, for every provider, without showing it in the user's message.

## Scope

- In:
  - Palette item "Compact conversation" and the unbound keybinding command
    `loom.compaction-and-goals.compact`, dispatching upstream's own `/compact` turn, gated
    the way upstream gates its button. Works against upstream T3 servers too.
  - A documented per-provider compaction table (all six adapters already support it
    upstream; nothing to add per adapter).
  - Goals stored per thread in a fork table (`fork_compaction_and_goals_goals`): objective
    (up to 4,000 characters), state (active, paused, met), timestamps.
  - A goal chip pinned at the top of the chat column with pause, resume, mark met, edit and
    clear, plus an editor popover.
  - A "Set goal" button in the composer footer (through `ext-composer`), which opens the
    same editor ("Edit goal" when the thread has one).
  - Palette items "Set goal", "Pause goal", "Resume goal", "Mark goal met", "Clear goal"
    and the unbound keybinding command `loom.compaction-and-goals.goal` (opens the editor).
  - Delivery: an active goal is prepended to each provider turn's input on the server,
    through the `ext-turn-input` extension point in `ProviderService.sendTurn`, which
    reaches Codex, Claude, OpenCode, Cursor, Grok and Antigravity alike.
  - Cleanup of goals when threads or projects are deleted.
- Out:
  - Follow-up: Codex native goal mirroring (`thread/goal/set|clear`, with statuses like
    `budgetLimited`). Goals already reach every provider, Codex included, through
    `ext-turn-input`; mirroring would need a Codex adapter seam and would double-deliver.
    Revisit only if Codex native goals add behavior the text path lacks, for example
    persistence across Codex's own compaction.
  - Follow-up: a Jev goal-drift check. Not selected for now; kept as an idea in L29's
    catalog.
  - Automatic "met" detection from the model's replies.
  - A goal pill in the sidebar (needs a sidebar seam).
  - Compaction with custom focus instructions (`/compact <focus>`): upstream only recognizes
    the exact text `/compact`.
  - Auto-compaction settings (upstream owns them, for example Claude's threshold).
  - Mobile UI.

## Surfaces

Web and desktop: supported. Mobile: not supported; goals still reach the provider for turns
sent from the mobile app, because delivery is server-side, but the phone shows no chip.
Remote: works over every connection mode (fork RPCs over the WebSocket). Upstream T3
server: compaction entry points work (they use upstream's command); goal UI is hidden
(`loomFeatures` lacks `compaction-and-goals`).

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (goal RPCs, store, cleanup reactor, capability).
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (two unbound commands).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (compaction and goal items).
- [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer) (the "Set goal" footer button, a `FORK_COMPOSER_BLOCKS` entry). Shared hook; if this
  packet has to create it, that is the extension point's five `ChatComposer.tsx` seam lines,
  not packet seams.
- `ext-turn-input` ([EXTENSION-POINTS.md, section 16](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input)): the goal block, contributor id `compaction-and-goals`,
  order 20.

## Packet seams

- `apps/web/src/components/ChatView.tsx`: mount the goal chip in the timeline banner
  overlay (import plus one JSX line).

## Optional integrations

- If L02 (thread lineage) is present, the fork dialog may offer "Copy goal to the new
  thread"; L02 would call this packet's `setGoal` RPC when `loomFeatures` includes
  `compaction-and-goals`. Not required by either packet.
- If L04 (thread inspector) is present, register a "Goal" section in its
  `FORK_INSPECTOR_SECTIONS` (`apps/web/src/fork/thread-inspector/sections.ts`) showing the
  objective and state with an Edit button. The section checks `loomFeatures` itself.

## Size

About 1,150 to 1,550 lines including tests: server store, service, reactor and contributor
about 450; contracts 100; web chip, editor, footer button, palette and keybindings about 600.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
every file here.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
