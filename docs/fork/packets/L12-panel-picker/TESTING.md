# L12 testing

## Automated tests

`apps/web/src/fork/panel-picker/rank.test.ts` (pure):

- Empty query: recents first (only available ones, recents order, at most 3), then the
  other available actions in given order, then unavailable ones in given order.
- One-letter query equal to a letter ranks that action first even when another label
  starts with the letter (`t` puts Terminal above a fork panel titled "Tasks" only if
  Terminal's letter is T; test both directions with a fixture).
- Prefix beats word-start beats substring beats description beats fuzzy; no match drops
  the action.
- Unavailable matches are returned in the `unavailable` group, never in `panels`.
- `upstreamSurfaceDescription` covers every label in upstream's two arrays. Guard against
  drift: the test imports nothing from `RightPanelTabs.tsx` (it is a component module), so
  it lists the eight labels explicitly; when upstream adds a surface, the test is updated
  with its description.
- Browser profile rows: generated only with more than one profile; searchable by
  "browser" plus the profile name.

`preferences.ts` behavior (in the same file or `preferences.test.ts`):

- Enabled defaults to true when the key is missing or storage throws.
- Recents keep at most 5 labels, most recent first, without duplicates.

No component render tests (AGENTS.md: do not render to static markup to assert markup).
The interaction checks are manual.

Registry invariants from the extension points (palette values, keybinding commands,
settings ids) run with their own tests.

## Commands

```sh
vp test run apps/web/src/fork/panel-picker/rank.test.ts \
  apps/web/src/fork/panels/registry.test.ts \
  apps/web/src/fork/settings/registry.test.ts \
  packages/contracts/src/fork/keybindings.test.ts
vp lint apps/web/src/fork/panel-picker apps/web/src/components/RightPanelTabs.tsx
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/contracts typecheck   # only if this packet added the keybinding command
```

## Manual check

With Kyle's permission, one pass with `test-t3-app` (web) and the desktop dev app:

1. Open a thread, open the right panel with `mod+alt+b`: the picker shows "Open a panel",
   the list, letters. Press `T`: a terminal opens (upstream letter behavior).
2. Close all tabs; press `j` (the one unassigned letter, EXTENSION-POINTS.md "Launcher
   letters"): the search focuses with "j" typed and filters. Arrows plus Enter open the
   highlighted surface.
3. With tabs open, click "+": the popover opens with the search focused; type `d`, Enter:
   Diff opens. Escape with a query clears it; Escape again closes.
4. With two browser profiles configured (desktop), Right arrow on Browser shows both;
   Enter on one opens that profile.
5. Open a thread without a project (or on web): Browser shows its reason inline.
6. Recents: the last surfaces opened appear first on the next open.
7. Bind `loom.panel-picker.open`; with the panel hidden, press it: the panel shows and the
   search (or the popover) is focused. Same from the command palette item.
8. Settings > Loom > Panel picker off: upstream's launcher and "+" menu are back,
   unchanged; on again: the picker returns.
9. The pull request page's right panel shows the picker with upstream surfaces only.
10. With a fork panel packet installed (for example L01), its panel appears in both
    lists; on an upstream server it is listed as unavailable with its hint.

## Merge safety

Run the `git merge-tree` preview from SEAMS.md on the branch and record the result. After
the merge to `main`, `scripts/fork/loom.sh integrate nightly --dry-run` from a clean,
synced `main`.

## Acceptance criteria

- Upstream's surfaces behave exactly as before when picked; only the list presentation
  changed.
- The setting restores upstream's UI completely.
- No console errors, no layout shift when the popover opens, no repainting animation.
