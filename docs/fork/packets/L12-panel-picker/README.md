# L12: Panel picker

Status: Ready to build. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

A compact, searchable picker for opening right-panel surfaces. It replaces upstream's flat
"Open a surface" launcher (shown when the right panel is empty) and the tab bar's "+" menu
with one list that filters as you type, shows a one-line description per surface, keeps
recently used surfaces at the top, and works entirely from the keyboard. Fork panels from
other Loom packets appear in it automatically through the fork panel registry. It is
deliberately much smaller than old Loom's catalog (about 1,000 lines of catalog and hub
code there; about 400 here).

Selection item: P14 (Panel picker), see [selections.md](../../selections.md).

## Scope

- In:
  - `LoomPanelPickerList`: search field, ranked results, recents group, unavailable rows
    with their reason, letter hints, arrow and Enter navigation.
  - Empty-state launcher: the list in place of upstream's launcher. Upstream's single-key
    letter shortcuts keep working; any other printable key starts a search.
  - "+" button in the tab bar opens the same list in a popover with the search focused.
  - Browser profiles: the Browser row expands (Right arrow or its chevron) into one row per
    profile when more than one profile exists.
  - Recents (last 5 surfaces opened through the picker), stored per client.
  - Descriptions for every row: fork-owned copy for upstream surfaces, and the optional
    `description` that fork panels set on their `ForkPanelDefinition` (`ext-panels`).
  - `mod+shift+'` opens the picker by default, through a fork keydown listener with a
    setting to turn it off (never written into `keybindings.json`). The keybinding command
    `loom.panel-picker.open` stays bindable in Settings > Keybindings, and a command palette
    item opens the picker too.
  - Loom settings: switch back to upstream's launcher and menu, and turn the default
    shortcut off.
- Out:
  - Hubs, facets, suggested cards, "more ways to open" sections (old Loom's catalog).
  - Opening a specific surface from the command palette (surface handlers live in
    `ChatView`; the palette opens the picker instead).
  - A default binding in `keybindings.json` (no `FORK_DEFAULT_KEYBINDINGS` seam): upstream
    T3 Code would flag it as an invalid entry after a rollback.
  - Default bindings for individual panels: panel commands stay unbound (L01's rule).
  - Mobile (there is no right panel on mobile).

## Surfaces

- Web and desktop: supported (same bundle). Client-only: no server change, no capability.
- Mobile: not applicable.
- Remote: nothing environment-specific; availability comes from the same props upstream
  already computes.
- Upstream T3 server: works the same (the picker is client-only); fork panels are listed
  as unavailable by their own `isAvailable` checks.

## Extension points used

- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (required: the fork panel actions reach the picker through its `forkActions`
  spread, and this packet's seams sit next to its seams in `RightPanelTabs.tsx`).
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings) (the switch back to upstream's launcher).
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (the command host and the default-shortcut listener) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (`loom.panel-picker.open`).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) ("Open panel picker").
- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core), only as the prerequisite of `ext-panels` and `ext-palette`; no server code.

Any of them may have to be created by this packet (run each existence check first).

## Packet seams

- `apps/web/src/components/RightPanelTabs.tsx`: one import, the picker in place of the
  empty-state launcher, and the picker button in place of the "+" menu. Six marked sites.
  See [SEAMS.md](./SEAMS.md).

## Optional integrations

- Every packet that registers a fork panel (L01 Snippets, L04, L05, L06, L29 and others)
  appears in the picker with no change to this packet. A panel that sets `description`
  shows it under its title; a panel without one shows only its title.

## Size estimate

Small to medium: about 500 to 650 lines including tests (picker list and ranking about
300, launcher and popover wrappers about 120, settings, command, default shortcut and
palette glue about 110, tests about 140).

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
