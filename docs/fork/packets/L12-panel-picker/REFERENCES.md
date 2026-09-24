# L12 references

## Old Loom

Selection item P14 in [selections.md](../../selections.md). Old Loom is `bagelvault/loom`
at `a79ec506` (0.13.10).

| File                                                                                                                                            | Lines | Keep, adapt or drop                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/web/src/rightPanelCatalog.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/rightPanelCatalog.ts)                         | 514   | Adapt only the search idea (433-514: tokens, prefix and word matches, label weighted). Drop groups (107-126), ten hubs with facets (128-242), suggested and quick-access sets (244-253), "more panels" and "unavailable" sections. |
| [apps/web/src/components/RightPanelCatalog.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/RightPanelCatalog.tsx) | 504   | Drop: card grid, hub cards, collapsible sections. It had no arrow-key navigation, no recents and no pinning; this packet adds arrows and recents with far less UI. Keep: unavailable entries stay visible with a repair reason.    |
| [apps/web/src/rightPanelSurfaceRegistry.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/rightPanelSurfaceRegistry.ts)         | 328   | Reference for per-surface descriptions. Loom's equivalent is the fork panel registry (EXTENSION-POINTS.md, Right panels).                                                                                                          |
| [apps/web/src/components/ChatView.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/ChatView.tsx) (5451-5566)       | -     | Drop: 115 lines of inline add actions per kind. Upstream's arrays plus `ext-panels` replace them.                                                                                                                                  |
| [apps/web/src/rightPanelStore.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/rightPanelStore.ts) (47-72)                     | -     | Context only: 24 panel kinds, the reason a flat list stopped scaling.                                                                                                                                                              |

## Upstream T3 Code

- `apps/web/src/components/RightPanelTabs.tsx`: `SURFACE_DISABLED_REASONS` (151-160),
  `LAUNCHER_SHORTCUT_BLOCKING_LAYERS` (162-171), `SURFACE_UNAVAILABLE_HINTS` (174-183),
  `surfaceShortcutActionForKey` (246-258), `surfaceShortcutTargetsTypingContext` (266-273),
  `RightPanelEmptyState` (313-606, `actions` 336-411, letter listener 424-440, keys
  442-468), `RightPanelTabs` (819), `addSurfaceActions` (863-928), "+" menu (1245-1332),
  empty-state render (1388-1408).
- `apps/web/src/rightPanelStore.ts`: `show` (store interface), used by the command host.
- `apps/web/src/components/ui/command.tsx`, `popover.tsx`, `kbd.tsx`, `tooltip.tsx`.
- `apps/web/src/components/CommandPalette.tsx`: the reference for list keyboard behavior
  with `Command` primitives.
- EXTENSION-POINTS.md, Right panels (`ext-panels`): `ForkSurfaceAction`, `forkActions`.

## External

- WAI-ARIA Authoring Practices, "Combobox" and "Listbox" patterns
  (<https://www.w3.org/WAI/ARIA/apg/patterns/combobox/>): `aria-activedescendant` for a
  search field that drives a list.
- Base UI Popover and Autocomplete documentation (<https://base-ui.com/react/components/popover>,
  <https://base-ui.com/react/components/autocomplete>), the primitives under upstream's
  `popover.tsx` and `command.tsx`.
