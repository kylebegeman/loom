# L30 product

## Problem

A Loom feature today is a packet of documents plus registrations spread across shared
registries: panels, palette, root components, keybinding commands, the RPC group, RPC
handlers, RPC scopes, server services, routes, migrations and advertised features. Nothing in
the code says "this is the snippets feature", so a feature cannot be seen, switched off or
moved as a unit. Kyle wants each feature to behave like a plugin: a self-describing unit that
can be turned on and off inside Loom, and later reused elsewhere, without hurting upstream
merges.

## What the user can do

- Open Settings, Loom, Plugins and see every plugin built into this Loom: its name, a
  one-sentence description, and whether it is on for the selected environment.
- Turn a plugin off for an environment. Its panels, palette items, shortcuts and settings
  disappear from every connected client right away, its agent tools and server methods stop
  answering, and its background work stops.
- Turn it back on. Everything returns without restarting the server or reloading the app.
- See when a plugin's background work failed to start, with the reason, and retry it by
  turning the plugin off and on.

## Entry points

- Settings, Loom, Plugins: the only place to switch plugins. One row per plugin with a
  switch.
- An open panel tab whose plugin was turned off explains that and links to the Plugins
  section. Closing the tab is the way out; turning the plugin back on restores the content.
- No palette command or keybinding for switching plugins in this packet. Turning a feature
  off is rare and deliberate; the settings row is enough. Revisit if that proves wrong.

## States

- Loading: the section shows plugin rows from the client build with their switches disabled
  until the environment's plugin state arrives.
- Upstream server or an older Loom server without the `plugins` feature: the section says
  the environment does not run Loom plugins. Plugins that have no server part stay usable and
  show as on; plugins that need the server show as unavailable.
- Error: the stream failed or a switch was refused. The row shows the error and keeps its
  last known state.
- Failed: the plugin is on but its background work stopped with an error. The row shows the
  reason.
- Client and server builds differ: a plugin known to the server but not to this client shows
  as "Not in this app version"; one known to this client but not to the server shows as
  unavailable. Neither crashes.

## Surfaces and connection modes

Web and desktop get the section. Mobile has no plugin UI; the server still applies each
environment's switches to mobile clients. Everything travels over the environment WebSocket,
so local, Tailscale and T3 Connect behave the same. Each environment keeps its own switches.

## Decisions and open questions

Decided with Kyle on 2026-10-09:

- Park the packet after documenting it. It is a design record, not selected work.
- Build plugins into the app first (this packet). Runtime installation comes later, if at
  all.
- Keep the upstream seams as they are. The plugin contract sits entirely in fork-owned code.
- Shape the server half of the manifest so it can map onto upstream's proposed plugin manifest
  (`id`, `name`, `version`, `description`, capabilities) if that proposal is accepted
  ([REFERENCES.md](./REFERENCES.md#upstream-t3-code)).
- Agent tools (MCP) are the part of a plugin that works in other agent hosts. UI stays specific
  to each host.

Decided while preparing this packet, on 2026-10-09 (Kyle can override):

- Plugin code stays in each package's `src/fork/<slug>/` folder instead of a separate
  `plugins/<slug>/` workspace package. A separate package cannot resolve the web app's `~`
  imports or reach server services, and moving its dependencies would need upstream JSON
  seams. Portability is a later phase with a deliberate host API.
- Plugins are on by default. A plugin can declare itself off by default.
- Enablement is per environment and stored on that environment's server, like other
  environment settings.
- Services of a disabled plugin are still built (construction must stay cheap); only its
  background work, contributions and methods are switched off. Migrations always run, so
  turning a plugin back on never waits on a schema change.

Open:

- Should the archived thread inspector (L04) return as a plugin that is off by default, to
  pilot the contract on a real feature? Recommended: no for now. Kyle archived it on
  2026-10-07, and a landed feature such as L23 is a better pilot because it is wanted.
  The fixture plugin in tests proves the contract until then.

## Later phases

Recorded so the direction is not lost. Neither is part of this packet or selected for work.

1. **Portable plugins.** A small, deliberate host API per layer (the server services and web
   components a plugin may use), exported from fork-owned modules. A plugin that imports only
   that API, `@t3tools/contracts`, `@t3tools/client-runtime`, `effect` and React could live in
   its own package and be reused by another fork. Build it when a second host exists.
2. **Runtime-installed plugins.** Install without rebuilding. The server half would follow
   upstream's child-process plugin host if it lands; UI would need declarative descriptions or
   sandboxed frames, because React Native cannot load component code at runtime and the hosted
   web app should not run code supplied by a user's server. Reassess when upstream decides on
   its plugin proposal.
