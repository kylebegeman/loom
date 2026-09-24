# L13: Composer drawers

Status: Not started. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

One "Composer tools" drawer that opens above the composer with four tabs:

- **Once**: send the next message with a different model, effort or access level, and have
  the thread switch back automatically afterwards.
- **Schema**: add a JSON Schema to the prompt so the agent answers in that shape.
- **Shell**: run a command in the thread's workspace on the environment and attach its
  output to the prompt.
- **Clipboard**: recent clipboard items to insert, local only, off until you turn it on,
  skipping anything that looks like a secret, and easy to clear.

Selection items: P15 (Composer drawers) and the clipboard part of F8, see
[selections.md](../../selections.md).

## Scope

- In:
  - Composer footer button that opens the drawer (hidden on narrow layouts like other
    appended footer controls; the keybindings and palette still work).
  - Once tab: arm, change settings with upstream's own pickers, send, automatic restore of
    the composer and of the thread's stored settings after that turn; cancel.
  - Schema tab: edit or pick a saved schema, validate it as JSON, insert a short
    instruction plus the schema into the prompt; save up to 10 schemas per client.
  - Shell tab: run a command through a fork RPC (timeout, output cap), preview the result,
    attach it as a fenced block; recent commands per client.
  - Clipboard tab: capture of copies made inside Loom, plus (desktop) the clipboard
    content when Loom regains focus; filters, limits, pin nothing, clear all, delete one.
  - Loom settings section for clipboard history.
  - Keybinding commands and palette items for each tab.
- Out:
  - Native structured output (Codex `outputSchema` on `turn/start`): needs a new optional
    field on upstream's `thread.turn.start` contract and adapter seams. Old Loom did it for
    Codex only. The prompt-level schema works for every provider; native enforcement is a
    follow-up for a provider-seam packet.
  - Per-turn working directory, personality or sandbox fields (old Loom's drawer): the
    permission level covers sandboxing through upstream's runtime modes.
  - Codex's native `thread/shellCommand` (old Loom's shell): provider-specific; the fork
    RPC works for every provider.
  - Reading clipboard content copied in other apps while Loom is in the background
    (needs Electron main-process polling through `ext-desktop`; see TECHNICAL.md,
    Alternatives).
  - Mobile.

## Surfaces

- Web and desktop: supported. Clipboard capture on focus is desktop only (browsers ask for
  permission); in-app copy capture works on both.
- Mobile: not supported; nothing changes there.
- Remote: the Shell tab runs on the thread's environment over the WebSocket RPC (local,
  Tailscale, T3 Connect). Clipboard history never leaves the client.
- Upstream T3 server: Once, Schema and Clipboard work (client-only). The Shell tab shows
  "Running commands needs a Loom server."

## Extension points used

- [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer) (footer block and drawer).
- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (the shell RPC, capability `composer-drawers`).
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings) (clipboard history settings).
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (commands).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (palette items).

Any of them may have to be created by this packet (run each existence check first).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L01 (Snippets) is present, both register composer drawers; ext-composer shows the
  first open drawer, and each closes when the other opens (they never stack).
- If L14's model presets are present, a preset can be applied while Once is armed; it is
  just another composer model change and is reverted like any other.

## Size estimate

Medium: about 1,300 to 1,700 lines including tests (drawer shell and tabs about 700,
Once controller about 250, clipboard capture and filters about 250, shell RPC and service
about 250, glue and settings about 150, tests about 250).

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
every file here. Start with IMPLEMENTATION.md step 1.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
