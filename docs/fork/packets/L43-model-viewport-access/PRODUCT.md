# L43 product

## Problem

The viewport can be focused (`createViewer.ts:75`) but only zoomed from the keyboard
(`ModelPanel.tsx:763-764`). Orbit and pan need a mouse. A screen reader hears a fixed label,
"3D model. Drag to orbit, right or middle drag to pan, scroll to zoom." (`createViewer.ts:71-74`),
with no file name and no way to learn the part's size or whether it fits. Status text in the
status bar (`ModelPanel.tsx:1135-1160`) is not announced, and the tool hint and capture message
are `role="status"` nodes that mount with their text already in place
(`WorkspaceTools.tsx:481`, `ModelPanel.tsx:1008`), which screen readers announce unreliably.

## What the user can do

- Tab to the viewport (or click it) and see the focus ring.
- Press arrow keys to orbit, Shift with arrow keys to pan, `+` and `-` to zoom, `F` to fit and
  `1` to `4` for standard views. Everything else in the panel keeps its own arrow keys.
- Hear "part.stl, 3D viewport" and the instructions when the viewport gets focus.
- Hear, after a model loads: "part.stl loaded. 42.0 × 30.0 × 12.5 mm, 1,234 triangles. Fits
  the bed (Bambu Lab H2D)." After a bed change that flips the result: "Larger than the bed
  (Bambu Lab A1 mini)."
- Hear tool and mode changes: "Click the first point to measure from", "Measure off",
  "Pan mode", "Orbit mode", "Front view", and capture results such as "Capture attached to the
  composer."

## Entry points

| Way in                         | Way out                                   | Where the state shows                                     |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------- |
| Tab or click into the viewport | Tab or Shift+Tab away, `Escape` in a tool | Focus ring                                                |
| Arrow keys orbit               | Arrow the other way, `F`, `1` to `4`      | The view; standard view highlight clears as with dragging |
| Shift with arrow keys pan      | Shift with the other arrow, `F`           | The view                                                  |
| Announcements                  | Not modal; nothing to dismiss             | Visible text stays where it is today                      |

## States

- Loading: arrows do nothing until a model has loaded (same rule as `F` and `1` to `4`, which
  check `stats`). The announcer says nothing until the load completes.
- Empty: until geometry arrives, arrow keys do nothing and the canvas keeps the file name.
- Error: the existing `role="alert"` notices keep announcing errors. On a failed reload with a
  previous mesh (status "Stale"), the announcer says "Showing the last good version."
- Disabled: when the panel is hidden (`visible` false) the key handler already returns.
- Stale: covered under Error.

## Surfaces and connection modes

Web and desktop. Mobile has no 3D panel. No server or wire change.

## Decisions

- Arrows act only when the canvas is the event target. Segmented controls and scrubbers in the
  same panel use arrows themselves (`controls.tsx:212,340`).
- Orbit 15 degrees per press, pan 10% of the viewport height: big enough to be useful, small
  enough to aim. Shift is the modifier because the panel guard already rejects Ctrl, Cmd and
  Alt (`ModelPanel.tsx:736-747`).
- Keyboard steps are not announced. The view changes on every press and speech would lag.
- One persistent live region rather than many conditionally mounted ones, following the upstream
  `sr-only` `role="status"` pattern (`ThemeSearchSection.tsx:337`).
- Reduced motion needs no new handling: every move is instant and damping is off
  (`createViewer.ts:77`). L43 adds no tweening.

## Decisions needed from Kyle

1. Canvas role. Recommendation: `role="application"` with `aria-roledescription="3D viewport"`,
   so screen readers pass arrow keys through to the viewport. The alternative, `role="img"`,
   reads well but tells screen readers the element is not interactive, and some will keep the
   arrow keys for their own navigation. Building to the recommendation is safe.
