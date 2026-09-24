# L12: Panel picker

Status: Not started. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

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
  - Keybinding command `loom.panel-picker.open` and a command palette item.
  - A Loom setting to switch back to upstream's launcher and menu.
- Out:
  - Hubs, facets, suggested cards, "more ways to open" sections (old Loom's catalog).
  - Opening a specific surface from the command palette (surface handlers live in
    `ChatView`; the palette opens the picker instead).
  - Descriptions for fork panels until `ext-panels` gains an optional `description` field
    (question for Kyle; see PRODUCT.md). Upstream surfaces get descriptions from this packet.
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
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (`loom.panel-picker.open`).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) ("Open panel picker").
- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core), only as the prerequisite of `ext-panels` and `ext-palette`; no server code.

Any of them may have to be created by this packet (run each existence check first).

## Packet seams

- `apps/web/src/components/RightPanelTabs.tsx`: one import, the picker in place of the
  empty-state launcher, and the picker button in place of the "+" menu. Five marked sites.
  See [SEAMS.md](./SEAMS.md).

## Optional integrations

- Every packet that registers a fork panel (L01 Snippets, L04, L05, L06, and others)
  appears in the picker with no change to this packet.
- If `ext-panels` later carries a `description` per fork panel, the picker shows it
  (TECHNICAL.md explains the one-line change).

## Size estimate

Small to medium: about 450 to 600 lines including tests (picker list and ranking about
300, launcher and popover wrappers about 120, settings, command and palette glue about 80,
tests about 120).

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
