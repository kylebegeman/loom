# L22: Instruction modes

Status: Ready to build. Kyle confirmed the packet and answered its questions on 2026-09-24.

Standing rule packs, such as "Minimal code", "Extra careful" or "Explain as you go", that a
thread keeps applying to every turn until they are turned off, for every provider. Pick modes
per thread from the composer, set defaults per project, and write your own packs as Markdown
files in a folder you choose (default `~/.t3/userdata/fork/instruction-modes/`, easy to keep
in dotfiles). Loom delivers the active modes with each turn on the server, so they apply
whichever client sends the message, including the upstream mobile app.

## Scope

- In:
  - A pack library per environment: three fixed built-in packs ("Duplicate to edit") plus
    user packs stored as one Markdown file each in the modes folder (create, edit, archive
    into `archived/`, restore, import a Markdown or `SKILL.md` file, export the file). The
    folder is watched, reloadable, validated (bad files are listed, never sent), and edits
    from several clients are guarded by a content hash.
  - A per-environment modes folder setting; SQLite keeps only per-thread and per-project
    selections, the per-thread delivery marker and the folder setting.
  - Per-thread selection from a composer control, and per-project defaults that new threads
    follow until the thread picks its own.
  - Delivery to every provider through the `ext-turn-input` extension point in
    `ProviderService.sendTurn` ([EXTENSION-POINTS.md, section 16](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input)): a tagged block
    prepended to the provider-bound text of every turn while modes are active, and a one-time
    "cleared" notice after they are turned off.
  - "What the agent receives" preview with characters and an estimated token count.
- Out:
  - Native per-provider instruction channels (Codex developer instructions, Claude system
    prompt). One uniform path instead; see TECHNICAL.md, "Alternatives".
  - Skills (L21) and AGENTS.md or CLAUDE.md editing.
  - Pinned goals (L03). L03 contributes through the same extension point.
  - Sync of packs between environments. Point each environment's folder at a synced
    dotfiles checkout, or use export and import.
  - Follow-up: sending the block only when the set changes (Kyle chose every turn).
  - Follow-up: a live subscription for library changes (refetch on focus plus the hash
    check cover multi-client edits).
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

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core): RPC group `loom.instruction-modes.*`, service, storage (selections only), a fork
  reactor for cleanup, capability `instruction-modes`.
- `ext-turn-input` ([EXTENSION-POINTS.md, section 16](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input)): per-turn delivery, contributor id `instruction-modes`, order 10.
- [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer): the "Modes" footer control.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings): the "Instruction modes" section (library and project defaults).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette): toggle a mode for the current thread, open the library.
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings): `loom.instruction-modes.open` (opens the composer control), unbound; handled by the
  fork keydown listener, never written into `keybindings.json`.

## Packet seams

None. The only upstream touch is the `ext-turn-input` extension point.

## Optional integrations

- If L17 is present, its drivers receive modes too (they go through `sendTurn`).
- If L03 is present, its goal block is sent after this packet's block (order 20 against
  10); neither packet depends on the other.
- If L20's private mode is on for a project, its block (order 5) is sent before this one;
  neither packet depends on the other.

## Size estimate

Medium: about 2,000 to 2,500 lines including tests. Server (library files and watching,
service, selections storage, contributor, reactor, RPC) 850, contracts (including the pure
file parser and renderer) 250, web (composer control, settings section with folder row,
pack editor with conflict handling, palette) 850, tests 500.

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
