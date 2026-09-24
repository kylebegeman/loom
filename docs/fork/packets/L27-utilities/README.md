# L27: Utilities catalog

Status: Ready to build. <!-- Not started | Designing | Ready to build | In progress | Done | Blocked: reason -->

Twenty-nine small developer tools that run entirely in the client, offline: encoders and
decoders, JWT decode, hashes and HMAC, color, case, number and timestamp conversion, a cron
explainer, a text diff, a regex tester, a CIDR/subnet calculator, a chmod calculator, UUID,
password and token generators, a user-agent parser and a few text helpers. They live in a right panel next to the thread, open from the command palette
straight to one tool, and fall back to a dialog when no thread is open. Nothing typed into
them leaves the device or is saved.

## Scope

- In:
  - The 29 tools listed in [TECHNICAL.md](./TECHNICAL.md#the-tools), each a pure function
    with typed options and tests. The regex tester matches in a Web Worker with a 1 second
    limit, so a runaway pattern cannot freeze the tab.
  - A "Utilities" right panel: search, categories, recent tools, tool view with live
    output and copy buttons.
  - A command palette submenu ("Utilities...") listing every tool; picking one opens it.
  - A dialog with the same content when no thread is active (for example on Settings or the
    empty start page).
  - An unbound keybinding command `loom.utilities.open`.
- Out:
  - Server RPCs, MCP tools and a CLI (old Loom had all three; agents can already run these
    operations in a shell).
  - JWT signature verification, key generation, encryption, YAML, and any tool that needs
    the network.
  - A BIP39 mnemonic generator (Kyle declined it).
  - Persisting inputs or outputs (they often hold tokens and secrets).
  - A settings section (nothing to configure) and mobile UI.

## Surfaces

- Web and desktop: supported.
- Mobile: not supported (no right panel system); nothing is shown.
- Remote: works everywhere, including a browser on plain `http://` over Tailscale, because no
  tool depends on `crypto.subtle` or `crypto.randomUUID`, which browsers only expose in
  secure contexts. See TECHNICAL.md.
- Upstream T3 server: works. The feature is client-only, so it is not gated on
  `loomFeatures`.

## Extension points used

- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels), may create it.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), may create it.
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (dialog host, command listener), may create it.
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (the unbound command), may create it.
- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core), only because `ext-panels` and `ext-palette` import its client helper
  (`loomFeaturesOf` from `@t3tools/client-runtime/fork`); create it if missing. This packet
  adds no server code and no `loomFeatures` entry.

## Packet seams

None.

## Optional integrations

- If packet L12 (panel picker) is present, the panel appears in it through the fork panel
  registry. No work here.
- If packet L13 (composer drawers) or another packet later adds "insert into composer" to
  the composer extension point, an "Insert" button beside "Copy" is a small follow-up. Not
  in this packet.

## Size

Medium-small: about 1,900 lines, half of it tests. One agent, 2 to 2.5 days. No new
dependencies: it uses `@noble/hashes`, `jose`, `culori` and `@pierre/diffs`, which
`apps/web` already depends on, plus platform APIs (`RegExp`, `BigInt`, Web Workers).

## How an agent starts

Read `AGENTS.md`, `FORK.md`, the packets `README.md`, `CONVENTIONS.md`,
`EXTENSION-POINTS.md` (sections 5, 6, 8, 9), then this folder in order: PRODUCT,
TECHNICAL, SEAMS, IMPLEMENTATION, TESTING, REFERENCES.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
