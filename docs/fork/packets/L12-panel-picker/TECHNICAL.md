# L12 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`) before any extension point is
applied. After `ext-panels` lands, `RightPanelTabs.tsx` lines shift by its eight marked
lines; search for the quoted code.

## Overview

Upstream's `apps/web/src/components/RightPanelTabs.tsx` builds two arrays of surface
actions:

- `actions` in `RightPanelEmptyState` (props at 313-333, array at 336-411), rendered as the
  "Open a surface" list (480-601). Each has `label`, `icon`, `shortcut`, `available`,
  `disabledReason`, `onClick`, `badgeCount`, and Device has `description`.
- `addSurfaceActions` in `RightPanelTabs` (863-928), rendered in the "+" `Menu`
  (1245-1332).

`ext-panels` appends `...(props.forkActions ?? [])` to both arrays, so fork panels are in
them too. This packet renders both arrays through one fork component, `LoomPanelPickerList`,
and changes nothing about how surfaces open: every row calls the action's own `onClick`.

```
RightPanelEmptyState (upstream)                 RightPanelTabs (upstream)
  actions[] (+ forkActions via ext-panels)        addSurfaceActions[] (+ forkActions)
        |  seam: early return                          |  seam: button instead of <Menu>
        v                                              v
  <LoomPanelPickerLauncher>                      <LoomPanelPickerButton> (Popover)
        \______________________  ______________________/
                               \/
                     <LoomPanelPickerList actions>
                        rankPanelActions(query, recents)
```

## Contracts

None. Client-only.

## Server

None.

## Storage

Client only, through `resolveStorage` (`apps/web/src/lib/storage.ts`), every access in
try/catch:

| Key                            | Value                                     |
| ------------------------------ | ----------------------------------------- |
| `loom:panel-picker:enabled:v1` | `"true"` or `"false"`; missing means true |
| `loom:panel-picker:recent:v1`  | JSON array of up to 5 action labels       |

Recents are keyed by label because labels are the only stable identity both arrays share
(upstream uses the label as the React key). A renamed surface simply drops out of recents.

## Clients

Directory: `apps/web/src/fork/panel-picker/`.

| File                         | Purpose                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `types.ts`                   | `PanelPickerAction` (structural subset of both upstream arrays).                                      |
| `rank.ts`                    | Pure `rankPanelActions(actions, query, recents)` and `upstreamSurfaceDescription(label)`.             |
| `rank.test.ts`               | Ranking and grouping tests.                                                                           |
| `preferences.ts`             | `useLoomPanelPicker()` (enabled flag via `useSyncExternalStore`), recents read and write.             |
| `PanelPickerList.tsx`        | Search field, grouped list, keyboard handling, Browser profile expansion.                             |
| `PanelPicker.tsx`            | `LoomPanelPickerLauncher`, `LoomPanelPickerButton` (exports used by the seams), request subscription. |
| `requests.ts`                | Tiny store: `requestPanelPicker()` increments a counter; components consume it.                       |
| `PanelPickerCommandHost.tsx` | `ForkRoot` component: handles `loom.panel-picker.open`.                                               |
| `palette.tsx`                | `panelPickerPaletteSource`.                                                                           |
| `settings.tsx`               | `panelPickerSettings: ForkSettingsSection` (id `panel-picker`, title "Panel picker").                 |

### Types

```ts
import type { ComponentType } from "react";

/** Both upstream action arrays and ForkSurfaceAction satisfy this. */
export interface PanelPickerAction {
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly shortcut: string;
  readonly available: boolean;
  readonly disabledReason: string;
  readonly onClick: () => void;
  readonly badgeCount?: number;
  readonly description?: string;
}

export interface PanelPickerBrowserProfiles {
  readonly profiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly onOpenInProfile: (profileId: string) => void;
}
```

Upstream's arrays are `as const` tuples of object literals; they are assignable to
`ReadonlyArray<PanelPickerAction>` because the extra literal types widen. If the Device
entry's `description` makes the union awkward, accept
`ReadonlyArray<PanelPickerAction>` via a parameter typed as the upstream element union's
supertype; do not edit upstream types.

### Ranking

```ts
export interface RankedPanelGroups {
  readonly recent: ReadonlyArray<PanelPickerAction>;
  readonly panels: ReadonlyArray<PanelPickerAction>;
  readonly unavailable: ReadonlyArray<PanelPickerAction>;
}

export function rankPanelActions(
  actions: ReadonlyArray<PanelPickerAction>,
  query: string,
  recents: ReadonlyArray<string>,
): RankedPanelGroups;
```

- Empty query: `recent` = available actions whose label is in `recents`, in recents order
  (at most 3 shown); `panels` = the other available actions in their given order (upstream
  order, then fork panels in registry order); `unavailable` = the rest in given order.
- Non-empty query (trimmed, lowercased): score each action by the best of
  - 0: one-character query equal to the action's letter (case-insensitive),
  - 1: label starts with the query,
  - 2: a word in the label starts with the query,
  - 3: label contains the query,
  - 4: description contains the query,
  - 5: fuzzy subsequence of the label.
    No match drops the action. Sort by score, then recents position, then given order. No
    `recent` group while searching; unavailable matches still go to `unavailable`.
- Descriptions: `action.description ?? upstreamSurfaceDescription(action.label)` where the
  map holds the copy in PRODUCT.md, keyed by upstream label.

### List component

`PanelPickerList` props: `actions`, `browser?: PanelPickerBrowserProfiles`,
`mode: "launcher" | "popover"`, `onPicked?: () => void` (closes the popover).

- Built on the same primitives as the command palette where they fit:
  `Command`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandGroupLabel`,
  `CommandItem`, `CommandShortcut` from `apps/web/src/components/ui/command.tsx`. If the
  autocomplete-based `Command` fights the launcher's "letters open surfaces" behavior,
  use a plain `input` plus a `role="listbox"` list with `aria-activedescendant`, like
  upstream's launcher (it has its own highlight state at 413-468). Keep the markup
  accessible either way: the input has `aria-controls` and each row `role="option"`.
- Row: 28 px high (`h-7`), icon (with badge when `badgeCount > 0`, same markup as
  upstream's `actionIcon`), label, description in `text-muted-foreground` truncated to one
  line, `Kbd` letter on the right. Unavailable rows are `aria-disabled`, dimmed, and show
  the reason inline instead of the description (no hover needed), plus the upstream-style
  tooltip.
- Highlight starts at -1 in the launcher (upstream's rule: highlight only after hover or
  arrows) and at 0 in the popover.
- Picking: record the label in recents, call `onClick`, then `onPicked`.
- Browser: when `browser.profiles.length > 1`, the Browser row shows a chevron; Right
  arrow or clicking the chevron inserts one row per profile below it ("Browser: Work"),
  which call `browser.onOpenInProfile(id)`. Clicking the Browser row itself opens the
  default profile (upstream behavior). Profile rows are also searchable ("browser work").
- Width: the launcher uses `max-w-xs` like upstream's; the popover is `w-80`. Height is
  capped (`max-h-80`) with its own scroll area.

### Launcher (empty state)

`LoomPanelPickerLauncher({ actions, browserProfiles, onAddBrowserInProfile })` renders the
heading, the search field and the list, vertically centered like upstream's
(`pb-[calc(var(--workspace-topbar-height)+--spacing(6))]`).

- Focus: on mount, focus the list container (not the input), so upstream's letter
  shortcuts (a window capture listener in `RightPanelEmptyState` at 424-440 that skips
  typing contexts) keep working. The listener stays active because it is registered before
  the seam's early return.
- Keys on the container: arrows and Enter navigate; `/` focuses the input; any other
  printable key without modifiers that is not an available surface letter focuses the input
  and types that key. Letters of available surfaces never reach this handler (the capture
  listener handles them first).
- Requests: when `requests.ts` fires and this launcher is visible
  (`element.offsetParent !== null`), focus the input.

### Popover ("+" button)

`LoomPanelPickerButton({ actions, browserProfiles, onAddBrowserInProfile })` renders the
same trigger markup as upstream's (`Button` `size="icon-xs"`, `variant="ghost"`, `Plus`
icon, `aria-label="Add panel surface"`) and a `Popover` (`apps/web/src/components/ui/popover.tsx`)
containing `PanelPickerList mode="popover"`. The popover opens with the input focused and
closes on pick, Escape (after clearing a non-empty query) or outside click. It also opens
when a request fires and the button is visible.

### Command and palette

- `FORK_KEYBINDING_COMMANDS` gains `"loom.panel-picker.open"`. `PanelPickerCommandHost`
  (in `FORK_ROOT_COMPONENTS`) subscribes with `onForkCommand`: it reads the active thread
  (`useHandleNewThread().activeThread`, as the ext-palette registry does), calls
  `useRightPanelStore.getState().show(ref)` (`apps/web/src/rightPanelStore.ts`, `show`
  in the store interface), then `requestPanelPicker()` on the next animation frame so the
  launcher or button is mounted when the request lands.
- Palette source: one item `action:loom:panel-picker:open`, title "Open panel picker",
  `shortcutCommand: "loom.panel-picker.open"`, only when there is an active thread; its
  `run` calls `dispatchForkCommand("loom.panel-picker.open")`.

### Settings

`panelPickerSettings` renders one `SettingsRow` with a `Switch` bound to
`loom:panel-picker:enabled:v1`. Client preference only, so it needs no environment scope and
works on any server.

### Fork panel descriptions (pending Kyle's answer)

With an optional `description?: string` on `ForkPanelDefinition` and `ForkSurfaceAction`,
and `description: panel.description` in `useForkPanelActions`, fork panels flow through
`action.description` with no change here. Until then, fork rows show only their title.

## Agent-facing tools

None.

## Performance

- The list is at most about 25 rows; ranking is trivial and runs per keystroke in memory.
- Nothing renders or subscribes while the popover is closed; the launcher only exists while
  the panel has no surfaces (as upstream's).
- No animation beyond the popover's default open transition.

## Alternatives considered

- Rebuild old Loom's catalog (hubs, facets, suggested cards): rejected by the brief as too
  heavy.
- Add search to upstream's `Menu`: Base UI menus own typeahead and focus; an input inside a
  menu popup fights them. A popover with a list is the standard pattern (the command
  palette uses the same primitives).
- Replace the arrays in `ChatView` instead of rendering them differently: would need seams
  in `ChatView.tsx` (the busiest upstream file) and would duplicate availability logic.
- A new extension point for "render the launcher": only this packet needs it; a packet
  seam is smaller and honest.
