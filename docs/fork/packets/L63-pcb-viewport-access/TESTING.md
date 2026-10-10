# L63 testing

Focused tests only, no sleeps, no repo-wide checks.

## Automated tests

| File                                                            | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/pcb-preview/announce.test.ts` (new)          | `describeSelection`: component with value; component unknown to the inspection; pin with name and net; pin with empty name or net; net only; nothing. `announcement`: `null` on the first snapshot; `null` when nothing announced changed; each message in TECHNICAL.md; priority (a step beats the selection and place change it caused; a selection beats a place change); "Selection cleared"; "Select" when a tool ends; check result only after a watched run, and not after an initial load or an unwatched result; zero counts left out; "could not run" for `failed` and `timed-out`; "Building board" only when nothing is shown; "Board updated" for a new source hash on the same sheet; "3D board ready"; a repeated notice text after another message is announced again. |
| `apps/web/src/fork/pcb-preview/workspace.interactions.test.tsx` | `SvgViewport`: the focusable element is `role="application"` named by its `label` and described by the instruction text; images are decorative; with `restoreFocus`, a remount while `document.body` has focus moves focus to the new viewport, and without it focus is left alone. `OperationStatus` with `silent` has no `role`. `ChecksView`: a "Go to" button passes its description to `onLocate`.                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/src/fork/pcb-preview/Board3D.test.tsx`                | With the existing viewer mock, `describe` is called with the given name and an id that resolves to the instruction text, and `onStatus` reports `loading` then `ready`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Whole-panel focus moves (`I`, `Escape`, close button) are not covered by an automated test: the
existing harness renders parts, not `DesignWorkspace`, and rendering it needs the full atom
setup. The manual check covers them.

## Commands

```sh
vp test run apps/web/src/fork/pcb-preview/announce.test.ts \
  apps/web/src/fork/pcb-preview/workspace.interactions.test.tsx \
  apps/web/src/fork/pcb-preview/Board3D.test.tsx
vp lint apps/web/src/fork/pcb-preview apps/web/src/fork/model-preview-3d/viewer/createViewer.ts
vp run --filter @t3tools/web typecheck
```

## Manual check

With a KiCad design that has a multi-sheet schematic, a board, and DRC findings, on desktop and
in Safari with VoiceOver, and in Chrome with NVDA if available:

1. Open the panel: nothing is spoken until the user acts. Tab: document bar, then the drawing
   ("power, Board, Front copper, drawing" and the instructions), then the shelves, the rail and
   the status bar. Arrow keys pan in VoiceOver and in NVDA browse mode.
2. Select a component and a pin in Inspect, then a net: each is spoken once with reference and
   value.
3. Press `1`, `2`, `3`, change sheet and layer preset: each place is spoken; focus stays on the
   drawing or the 3D board, the 3D board shows a focus ring, and the next shortcut works.
4. Run DRC: "Running DRC", then the counts. Close and reopen the panel: old results are not
   read out. Rail and chips read their counts.
5. Save the design in KiCad: "Board updated", once. Break the design: the failure alert is read
   once.
6. Press `I`: focus in the tools. Press `Escape`: focus back on the drawing. Open tools from the
   rail and close with "Close tools": focus back on the rail button.
7. Step findings with `.` and `,` (L52) or the "Go to" buttons: each step is spoken.
8. macOS Reduce motion on: the Checks group chevrons and revealed row tools change without
   transition.
9. With the panel open, the accessibility tree shows one `main` landmark.

## Merge safety

No upstream files. Run the merge preview from CONVENTIONS.md against the newest nightly before
merging, and `scripts/fork/loom.sh check` after.
