# L12 product

## Problem

Upstream lists eight right-panel surfaces in a flat menu, and Loom packets will add many
more (Snippets, Thread Inspector, File Outline, Source Control and others). A flat list of
fifteen or more entries with no search, no descriptions and no memory of what you use gets
slow to scan. Old Loom solved this with a large catalog of hubs and cards that was heavier
than the problem. Kyle wants something far more compact: type a few letters, press Enter.

## What the user can do

- Open the right panel (upstream `rightPanel.toggle`, `mod+alt+b`) and, when it is empty,
  pick a surface from a compact list: press its letter (as upstream), or start typing to
  filter, use the arrows, and press Enter.
- Click "+" in the panel's tab bar to get the same list in a popover with the search field
  focused.
- See a one-line description under each surface name, and the letter that opens it.
- Find recently used surfaces at the top of the list.
- See unavailable surfaces at the bottom, dimmed, with the reason ("Available when a project
  is open.").
- Choose a browser profile from the Browser row when there is more than one.
- Open the picker from anywhere with the `loom.panel-picker.open` keybinding or the command
  palette item "Open panel picker".
- Switch back to upstream's launcher and menu in Settings > Loom > Panel picker.

## Entry points

| Way in                                        | What happens                                                                                              | Way out                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Right panel empty state                       | The picker list renders in place of "Open a surface". Focus lands on the list, not the search field.      | Pick a surface, or close the panel. |
| "+" in the panel tab bar                      | Popover with the list; search focused.                                                                    | Escape, click outside, or pick.     |
| Keybinding `loom.panel-picker.open` (unbound) | Shows the thread's right panel; focuses the empty-state search, or opens the "+" popover when tabs exist. | Escape.                             |
| Command palette "Open panel picker"           | Same as the keybinding.                                                                                   | Escape.                             |
| Settings > Loom > Panel picker                | Switch "Use the compact panel picker" (on by default).                                                    | Switch it back on.                  |

Keyboard in the list:

- Up and Down move the highlight; Enter opens; Escape clears the search, then closes the
  popover.
- In the empty state, a surface's letter opens it immediately (upstream behavior, kept);
  `/` or any other printable key focuses the search and starts filtering.
- In the popover, typing always filters. A one-letter query that equals a surface's letter
  ranks that surface first, so `t` Enter opens Terminal just as `T` did in upstream's menu.
- Right arrow on Browser expands its profiles; Left collapses.

## States

- Nothing matches: "No panels match `query`."
- All surfaces unavailable (no thread): the list shows them dimmed with reasons, as
  upstream does.
- Loading: none; the list is built from props already computed.
- Setting off: upstream's launcher and "+" menu, unchanged.

## Copy

- Empty-state heading: "Open a panel". Search placeholder: "Search panels". Hint on the
  right of the search field: `/`.
- Group labels: "Recent", "Panels", "Unavailable".
- Descriptions for upstream surfaces (fork-owned, one line each):
  - Browser: "Preview a page in the built-in browser."
  - Terminal: "Open a shell in this thread's workspace."
  - Files: "Browse and open project files."
  - Diff: "Review this thread's changes."
  - Pull request: "Review this branch's pull request."
  - Linked pull requests: "Pull requests linked to this thread."
  - Agents: "Watch subagents and background work."
  - Device: upstream's own text, "Watch an iOS Simulator or Android Emulator."
- Setting: "Use the compact panel picker", description "Search and recent panels in the
  right panel's launcher and + menu. Off shows the standard list."

## Surfaces and connection modes

Web and desktop. Mobile has no right panel. The picker is client-only and behaves the same
on local, remote and tunnel connections and on upstream T3 servers.

## Decisions and open questions

Decisions:

- Replace both upstream lists with one component instead of adding a third way in.
- Keep upstream's single-key letters in the empty state; they are fast and users know them.
- Recents are per client (localStorage), not synced: they are a convenience, not data.
- The picker takes upstream's own action arrays as input, so new upstream surfaces appear
  automatically with their label, icon, letter and availability.
- A setting to fall back to upstream's UI is the "way out" for a UI replacement.

Open questions for Kyle:

1. Fork panel descriptions need an optional `description` on `ForkPanelDefinition` and
   `ForkSurfaceAction` in EXTENSION-POINTS.md (backward-compatible, one line each plus one
   line in `useForkPanelActions`). Approve that change? Until then fork panels show no
   description.
2. Suggested binding for `loom.panel-picker.open`: none by default, or `mod+shift+'`?
