# L12 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Work in a worktree. No server work and no test data are needed. Ask Kyle before
starting a dev server or browser.

## File layout

```
apps/web/src/fork/panel-picker/types.ts
apps/web/src/fork/panel-picker/rank.ts
apps/web/src/fork/panel-picker/rank.test.ts
apps/web/src/fork/panel-picker/preferences.ts
apps/web/src/fork/panel-picker/requests.ts
apps/web/src/fork/panel-picker/PanelPickerList.tsx
apps/web/src/fork/panel-picker/PanelPicker.tsx
apps/web/src/fork/panel-picker/PanelPickerCommandHost.tsx
apps/web/src/fork/panel-picker/palette.tsx
apps/web/src/fork/panel-picker/settings.tsx
```

## Steps

1. Extension points: run the existence checks for `ext-panels`, `ext-settings`,
   `ext-web-root`, `ext-keybindings`, `ext-palette`; create missing ones exactly as
   specified, one commit each, with their FORK.md rows and tests. `ext-settings` needs the
   route tree regenerated (`vp run --filter @t3tools/web build` once, or the dev server;
   see EXTENSION-POINTS.md, Settings).
2. `types.ts`, `rank.ts` and `rank.test.ts` (test-first; TESTING.md lists cases).
3. `preferences.ts`: a module store over `resolveStorage` with `useSyncExternalStore`;
   `useLoomPanelPicker(): { enabled: boolean }`, `setLoomPanelPickerEnabled(value)`,
   `readRecentPanels()`, `recordRecentPanel(label)`. All storage access in try/catch;
   defaults when storage throws (enabled, no recents).
4. `requests.ts`: `requestPanelPicker()`, `usePanelPickerRequest(onRequest)`.
5. `PanelPickerList.tsx`: search, groups, keyboard, Browser profile rows. Reuse
   `Kbd`, `Tooltip`, `ScrollArea` and, if they fit, the `Command*` primitives
   (`apps/web/src/components/ui/command.tsx`). Match upstream's row styling tokens
   (`rounded-[var(--control-radius)]`, `bg-accent/60` highlight).
6. `PanelPicker.tsx`: `LoomPanelPickerLauncher`, `LoomPanelPickerButton`, re-export
   `useLoomPanelPicker`.
7. Seams in `RightPanelTabs.tsx` exactly as SEAMS.md shows. Run `vp fmt` on the file and
   re-check marker placement; `git grep -c 'fork: panel-picker'` prints 6.
8. `settings.tsx` (append to `FORK_SETTINGS_SECTIONS`), `PanelPickerCommandHost.tsx`
   (append to `FORK_ROOT_COMPONENTS`), `"loom.panel-picker.open"` in
   `FORK_KEYBINDING_COMMANDS`, `palette.tsx` (append to `FORK_COMMAND_PALETTE_SOURCES`).
9. FORK.md "Packet seams" row (SEAMS.md). User doc: a short
   `docs/fork/user/panel-picker.md` (how to search, the letters, the setting, the
   keybinding command).
10. Checks (TESTING.md). Commit `feat(fork-panel-picker): search and open panels from a compact picker`.
11. Update the packet index Status.

## Code sketch

```tsx
export function LoomPanelPickerButton(props: {
  actions: ReadonlyArray<PanelPickerAction>;
  browserProfiles: ReadonlyArray<{ id: string; name: string }>;
  onAddBrowserInProfile: (profileId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePanelPickerRequest(() => {
    if (triggerRef.current?.offsetParent !== null) setOpen(true);
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            ref={triggerRef}
            aria-label="Add panel surface"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        <Plus className="size-3.5" />
      </PopoverTrigger>
      <PopoverPopup align="start" side="bottom" sideOffset={6} className="w-80 p-0">
        <PanelPickerList
          mode="popover"
          actions={props.actions}
          browser={{
            profiles: props.browserProfiles,
            onOpenInProfile: props.onAddBrowserInProfile,
          }}
          onPicked={() => setOpen(false)}
        />
      </PopoverPopup>
    </Popover>
  );
}
```

## Pitfalls

- Hook order: the launcher's early return must stay after every hook in
  `RightPanelEmptyState`. If upstream adds a hook below `focusOnMount`, move the seam below
  it when merging (SEAMS.md says so).
- Upstream's launcher letter listener runs in the capture phase on `window` and skips
  typing contexts; the picker's search input is a typing context, so letters typed there
  filter instead of opening surfaces. That is intended.
- `LAUNCHER_SHORTCUT_BLOCKING_LAYERS` (`RightPanelTabs.tsx:162-171`) includes
  `[data-slot="popover-popup"]`: while the "+" popover is open, upstream's empty-state
  letters are blocked. The popover only exists when tabs exist, so the two never compete.
- The Browser row keeps upstream's semantics: a click opens the default profile; touch
  users reach profiles through the chevron (upstream handles touch the same way in its
  menu, `shouldOpenDefaultBrowserProfileFromMenuClick`).
- Upstream's arrays are rebuilt every render; do not memoize on their identity. Ranking is
  cheap enough to run on every render of the picker.
- The pull request page (`routes/_chat.pull-requests.tsx`) also renders `RightPanelTabs`
  without fork actions; the picker must work with only upstream actions.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Every upstream surface opens from the launcher and the popover by letter, by search and
  by click, exactly as it did from upstream's lists.
- Turning the setting off restores upstream's launcher and menu with no reload.
