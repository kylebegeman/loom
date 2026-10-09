# L30: Loom plugins

Status: Parked. Kyle approved the direction and had it fully documented on 2026-10-09, then
parked it the same day: not selected for implementation. No code exists. See
[Revisiting](#revisiting) before picking it up.

Turns every Loom feature into a plugin: one definition per feature per runtime layer, one
registry per layer, and a per-environment switch in Settings that enables or disables a
plugin live. The extension points stay; packets stop editing six or more shared registries
and instead declare what they contribute in one place. Nothing about upstream merging changes,
because the upstream seams stay exactly as they are.

## Scope

- In:
  - The plugin contract: a manifest in contracts, and a server plugin and a web plugin
    definition that reference it by id.
  - One plugin registry per layer (contracts, server, web). Every existing fork registry
    (panels, palette, root components, keybinding commands, RPC group and handlers, RPC
    scopes, services, routes, migrations, advertised features) derives from it.
  - A plugin slot for every extension point that exists today, and a rule that every
    extension point created later adds its own slot.
  - Per-environment enable and disable, persisted on the server, delivered live over a fork
    stream, with background work started and stopped accordingly.
  - A Plugins section on the existing Loom settings page (`ext-settings`).
  - Registry invariant tests and a typed fixture proving that a plugin's RPC stays typed on
    the client.
  - Updating EXTENSION-POINTS.md, CONVENTIONS.md and the packet template so every later
    packet registers through its plugin.
- Out:
  - Plugins as separate workspace packages under `plugins/<slug>/`. Verified on 2026-10-09
    that this breaks host imports; see [TECHNICAL.md, Alternatives](./TECHNICAL.md#alternatives-considered).
  - Installing plugins at runtime without rebuilding Loom, sandboxing, and plugins written
    by other people. Tracked as later phases in [PRODUCT.md](./PRODUCT.md#later-phases).
  - Mobile plugin management. The server still enforces enablement for mobile clients.
  - Converting the archived thread inspector (L04). See the open question in PRODUCT.md.
  - Slots for extension points that do not exist yet (`ext-composer`, `ext-providers` and
    the rest). Each one adds its slot when it is created.

## Surfaces

Web and desktop: supported. Desktop loads the web bundle; nothing is Electron-specific.
Mobile: no management UI. Mobile has no fork UI yet, and the server-side effects of disabling
a plugin (hidden RPCs, stopped background work) apply to every client. Remote: the switch and
its stream go over the environment WebSocket, so it works locally, over Tailscale and through
T3 Connect. Upstream servers lack the `plugins` feature, so the section explains that the
environment does not run Loom plugins, and client-only plugins stay available there.

## Extension points used

`ext-core`, `ext-web-root`, `ext-panels`, `ext-palette`, `ext-keybindings`, `ext-settings`,
`ext-mcp` and `ext-cli`, all of which exist.

This packet changes how all of them are registered into. It adds no upstream seams.

## Packet seams

None. Details in [SEAMS.md](./SEAMS.md).

## Revisiting

The design was drafted against an outdated local checkout and refreshed the same day
against `main` at `be3bf78d94`. By then L23, L24, L10, L09, L05 and L19 (phases 1 and 2)
had landed, along with the switchboard and Codex sign-in email features, and all of them
register the old way. Picking L30 up therefore includes converting each of them into a
plugin, which moves registrations without changing behavior
([IMPLEMENTATION.md](./IMPLEMENTATION.md), step 7).

Before starting, Kyle moves L30 into the selected queue. Then re-verify every citation in
TECHNICAL.md and SEAMS.md against current source, recheck the upstream proposals in
REFERENCES.md (if upstream accepted a plugin or panel registry design, reconcile with it
first), and settle the open question in PRODUCT.md.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): upstream proposals and sources.
