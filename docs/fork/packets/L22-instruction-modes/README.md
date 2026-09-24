# L22: Instruction modes

Status: Not started. Not in selections.md: Kyle scoped it in the 2026-09-24 brief; confirm
before implementation (packets README).

Standing rule packs, such as "Minimal code", "Extra careful" or "Explain as you go", that a
thread keeps applying to every turn until they are turned off, for every provider. Pick modes
per thread from the composer, set defaults per project, and write your own packs. Loom
delivers the active modes with each turn on the server, so they apply whichever client sends
the message, including the upstream mobile app.

## Scope

- In:
  - A pack library per environment: three built-in packs plus user packs (create, edit,
    archive, restore, import a Markdown or `SKILL.md` file, export as Markdown).
  - Per-thread selection from a composer control, and per-project defaults that new threads
    follow until the thread picks its own.
  - Delivery to every provider through the `ext-turn-input` extension point in
    `ProviderService.sendTurn` ([EXTENSION-POINTS.md, section 16](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input)): a tagged block
    prepended to the provider-bound text of each turn while modes are active, and a one-time
    "cleared" notice after they are turned off.
  - "What the agent receives" preview.
- Out:
  - Native per-provider instruction channels (Codex developer instructions, Claude system
    prompt). One uniform path instead; see TECHNICAL.md, "Alternatives".
  - Skills (L21) and AGENTS.md or CLAUDE.md editing.
  - Pinned goals (L03). L03 contributes through the same extension point.
  - Sync of packs between environments (export and import cover it).
  - Mobile UI. Modes still apply to turns sent from mobile.
  - A turn-by-turn history of which modes applied (the preview and the composer show the
    current state).

## Surfaces

- Web and desktop: the composer control, a Loom settings section, palette items.
- Mobile: no UI; delivery still happens server-side.
- Remote: supported; state and delivery live on the environment.
- Upstream T3 server: the composer control is hidden and the settings section says "Needs a
  Loom server". Upstream clients on a Loom server get the modes delivered but cannot see or
  change them.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core): RPC group `loom.instruction-modes.*`, service, storage, a fork reactor for
  cleanup, capability `instruction-modes`.
- `ext-turn-input` ([EXTENSION-POINTS.md, section 16](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input)): per-turn delivery, contributor id `instruction-modes`, order 10.
- [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer): the "Modes" footer control.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings): the "Instruction modes" section (library and project defaults).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette): toggle a mode for the current thread, open the library.
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings): `loom.instruction-modes.open` (opens the composer control), unbound.

## Packet seams

None. The only upstream touch is the `ext-turn-input` extension point.

## Optional integrations

- If L17 is present, its drivers receive modes too (they go through `sendTurn`).
- If L03 is present, its goal block is sent after this packet's block (order 20 against
  10); neither packet depends on the other.

## Size estimate

Medium: about 1,800 to 2,300 lines including tests. Server (service, storage, contributor,
reactor, RPC) 700, contracts 200, web (composer control, settings section, pack editor,
palette) 800, tests 400.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder: PRODUCT, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING, REFERENCES.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
