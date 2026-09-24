# L01: Snippets library and panel

Status: Not started. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

A saved library of reusable prompt text that lives on the environment, so it follows the
machine to every client. Search it as you type from anywhere (a palette-style dialog with
live results), or type `;alias` in the composer and pick from an inline menu that filters
as you type. Snippets can have fill-in fields (`[[name]]`), keep a revision history,
import and export as `.loom-snippet.md` files (including old Loom exports), and can be
sent to the thread's terminal. A right panel manages the library.

Selection items: P1 (Snippets panel) and F1 (Snippets library), see
[selections.md](../../selections.md).

## Scope

- In:
  - Server-side library per environment, stored in fork tables, with global and
    per-project snippets.
  - Snippets right panel: search, filter (all, pinned, this project, deleted), create,
    edit, pin, delete with restore, revision history with restore, import and export.
  - Snippet search dialog: live results as you type, preview, insert into the composer,
    copy, send to terminal, open in the panel.
  - Inline composer menu on `;` plus at least one character, filtering as you type; Tab
    or Enter inserts, so `;alias` + Tab expands an exact alias.
  - Fill-in fields with `[[name]]` and `[[name|default]]`, built-in values
    (`[[cursor]]`, `[[date]]`, `[[time]]`, `[[datetime]]`, `[[project.name]]`,
    `[[project.path]]`, `[[branch]]`), filled in a drawer above the composer.
  - Import of `.loom-snippet.md` files, including old Loom's `{{name}}` syntax (converted).
  - Export of one snippet or the whole library.
  - Command palette entries and unbound keybinding commands.
  - Send a snippet to the thread's active terminal (never presses Enter).
- Out:
  - Agent access through MCP tools (old Loom planned "MCP parity"; every tool costs prompt
    tokens on every turn, so it waits for a real need).
  - Snippet composition (`{{> alias}}` in old Loom), choices, typed or computed fields,
    clipboard or selection variables.
  - Cloud sync or sync between environments. Each environment has its own library;
    export and import move snippets between them.
  - Mobile UI (the shared atoms and engine work there; a mobile picker is a later decision).
  - Upstream's prompt stash (`ComposerStashMenu`), prompt recall (ArrowUp) and `$` skills
    stay as they are. Snippets add no behavior to them.

## Surfaces

- Web and desktop: supported (same bundle). No Electron-only parts.
- Mobile: not supported in this packet. The upstream App Store app never shows snippets;
  a Loom server works normally with it.
- Remote: all data goes over the environment WebSocket RPC, so snippets work locally, over
  Tailscale and through T3 Connect. The library belongs to the environment the active
  thread runs on.
- Upstream T3 server: every entry point is hidden or shows "Snippets need a Loom server."

## Extension points used

All may have to be created by this packet (run each existence check first):

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (RPC group, `ForkLayer`, persistence, capability `snippets`).
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (the Snippets panel).
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (search dialog host, keyboard shortcuts host).
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (`loom.snippets.search`, `loom.snippets.open`).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (palette items).
- [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer) (the fill-in drawer and the composer bridge used for insertion).
- [`ext-composer-menu`](../EXTENSION-POINTS.md#11b-composer-menu-trigger-ext-composer-menu) (the `;` trigger). This packet is the first expected user of it.

## Packet seams

None. Every upstream touch goes through an extension point. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L18 (project profiles) is present, it may reference snippet ids; this packet does
  not depend on it and exposes nothing extra for it.
- If L13 (composer drawers) is present, both register composer drawers; the ext-composer
  registry shows the first open drawer, so they never overlap.

## Size estimate

Large: about 3,000 to 3,800 lines including tests. Server and contracts about 900, engine
(template, ranking, artifact format) about 600 with tests, web UI about 1,600, glue and
registrations about 300. Plan for three phases (see IMPLEMENTATION.md); each phase ships.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
every file here in this order: PRODUCT.md, TECHNICAL.md, SEAMS.md, IMPLEMENTATION.md,
TESTING.md, REFERENCES.md. Start with IMPLEMENTATION.md step 1.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
