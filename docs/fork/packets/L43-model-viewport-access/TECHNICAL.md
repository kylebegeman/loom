# L43 technical

## Overview

Three small client changes: a keyboard nudge through OrbitControls' public API, accessible
attributes on the canvas, and one live region fed by a pure message helper. No contract, server
or storage change.

## Contracts

None.

## Server

None.

## Storage

None.

## Clients

### Keyboard nudges

`apps/web/src/fork/model-preview-3d/viewer/keyboard.ts` (new, pure):

```ts
export const ORBIT_STEP = Math.PI / 12; // 15 degrees
export const PAN_STEP = 0.1; // fraction of the viewport height
export type Nudge =
  { kind: "orbit"; left: number; up: number } | { kind: "pan"; x: number; y: number };
export function nudgeFor(key: string, shift: boolean): Nudge | null;
```

`key` is `event.key` (`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`); anything else returns
`null`. Signs follow OrbitControls' own key handler so the directions feel standard: left orbits
with `+left`, up with `+up`, and pan uses `(+x, 0)` for left and `(0, +y)` for up
(`apps/web/node_modules/three/examples/jsm/controls/OrbitControls.js:1188-1271`). Pan amounts
are fractions; the viewer converts them to pixels.

`viewer/createViewer.ts` gains two methods on the returned object:

- `nudge(n: Nudge)`: return if no model. Orbit calls `controls.rotateLeft(n.left)` and
  `controls.rotateUp(n.up)`; pan calls `controls.pan(n.x * h, n.y * h)` with
  `h = renderer.domElement.clientHeight`. Those public methods call `update()`, which dispatches
  `change`, so `controlsChanged` (line 363) renders and reports the camera. Then call
  `navigationStarted()` (line 342), as `zoom` does (line 490), so the active standard view
  highlight clears exactly as with a drag.
- `owns(target: EventTarget | null)`: `target === renderer.domElement`.

We do not call OrbitControls' `listenToKeyEvents`: it maps plain arrows to pan and modified
arrows to orbit (the reverse of what Kyle chose), listens on a separate element and moves pan in
fixed pixels.

`ModelPanel.tsx` key handler (lines 718-769): after the guard, one branch before `else return`:

```ts
else if (stats && viewer.current?.owns(event.target) && nudgeFor(event.key, event.shiftKey))
  viewer.current.nudge(nudgeFor(event.key, event.shiftKey)!);
```

(Compute once into a local in the real code.) The existing `preventDefault()` stops the page
from scrolling. The guard already excludes Cmd, Ctrl and Alt, so Shift is the only modifier
that reaches here.

### Canvas name and instructions

`createViewer.ts:71-74` sets a fixed `aria-label`. Replace it with:

- `role="application"` and `aria-roledescription="3D viewport"` at creation.
- A method `describe(name: string, descriptionId: string)` that sets `aria-label` to `name` and
  `aria-describedby` to `descriptionId`.

`viewer/ViewerCanvas.tsx` gains a `label: string` prop, renders
`<span id={useId()} className="sr-only">` with the instructions, and calls `describe` after the
viewer is created. ModelPanel passes the file name (`path.split("/").at(-1)`). Instructions:

"Arrow keys orbit. Shift and arrow keys pan. Plus and minus zoom. F fits the model. 1 to 4 choose
a standard view. Drag to orbit, right or middle drag to pan, scroll to zoom."

This mirrors upstream's instructions span in `apps/web/src/components/ui/color-picker.tsx:128`.

The focus ring already exists: `.model-canvas canvas:focus-visible` draws a 2px `--ring`
outline inset by 3px (`workspace.module.css:94-97`), which passes the fork's
`no-outset-state-indicators` lint rule. Keep it.

### Announcer

`apps/web/src/fork/model-preview-3d/announce.ts` (new, pure):

```ts
export type AnnounceInput = {
  file: string;
  geometryRevision: string; // "" until loaded
  stats: { size: readonly number[]; triangles: number } | null;
  fits: boolean | null;
  bedLabel: string;
  stale: boolean;
  hint: string | null;
  tool: "measure" | "annotate" | null;
  navigationMode: "orbit" | "pan";
  view: "iso" | "front" | "top" | "right" | null;
  success: string | null;
  formatSize: (size: readonly number[]) => string;
};
export function announcement(previous: AnnounceInput | null, next: AnnounceInput): string | null;
```

It compares two snapshots and returns the one message for the most important change, or `null`:

1. New `geometryRevision` with stats: "{file} loaded. {size}, {n} triangles. Fits the bed
   ({bed})." or "... Larger than the bed ({bed})." Triangles use `toLocaleString()`, as the status
   bar does (`ModelPanel.tsx:1143`).
2. `stale` turned true: "Showing the last good version."
3. `fits` flipped with the same revision: "Fits the bed ({bed})." or "Larger than the bed ({bed})."
4. `success` became non-null: the success text.
5. `hint` changed to non-null: the hint text (`ModelPanel.tsx:705-712`); `tool` turned null:
   "Measure off" or "Annotate off".
6. `navigationMode` changed: "Pan mode" or "Orbit mode".
7. `view` became non-null: "Iso view", "Front view", "Top view", "Right view".

`formatSize` is injected so L40 can pass `formatLength`; until then ModelPanel passes the status
bar format (`value.toFixed(1)` joined with " × " plus " mm", `ModelPanel.tsx:1138`).

`ModelPanel.tsx` keeps the previous input in a ref, calls `announcement` in an effect on those
inputs, and writes the result into a persistent element rendered once at the panel root:

```tsx
<div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
  {message && <span key={message.id}>{message.text}</span>}
</div>
```

The region itself never unmounts, which is what makes screen readers trust it. The keyed child
is replaced on every new message, so the same text twice in a row ("Pan mode") is still
announced. No timers. `bedLabel` comes from
`buildPlateLabel(settings.buildPlate)` (`buildPlate.ts:17-18`); `fits` from the existing
`oversized` (`ModelPanel.tsx:695`).

Remove `role="status"` from `ToolHint` (`WorkspaceTools.tsx:481`) and from the success toast
(`ModelPanel.tsx:1008`) so those messages are announced once, by the announcer. Leave
`OperationStatus` (`OperationStatus.tsx:20`) and the `role="alert"` notices as they are.

### Help and reduced motion

`HELP` in `WorkspaceTools.tsx:197-207`: "Orbit" becomes `"Drag, O, arrow keys"`, "Pan" becomes
`"Middle or right drag, H, Shift and arrows"`. Reduced motion: no change needed; moves are
instant, damping is off (`createViewer.ts:77`), and the panel's few transitions already honour
`prefers-reduced-motion` (`workspace.module.css:1024-1030`).

## Agent-facing tools

None. Agents already orbit and pan through the editor `camera` action and `snapshot`. The
announcer is for people.

## Performance

A key press renders one frame through the existing `requestRender`. The announcer is a pure
comparison in one effect and updates one text node only on transitions, never per frame or per
orbit step.

## Alternatives considered

- `controls.listenToKeyEvents(canvas)`: reverse mapping, see above.
- Announcing every keyboard step: noisy and laggy for screen readers.
- A shared upstream live-region helper: upstream has none; each feature renders its own
  `sr-only` status element (`ThemeSearchSection.tsx:337`). We follow that.
- Making arrows work anywhere in the panel: would steal arrows from segmented controls and
  scrubbers (`controls.tsx:212,340`).
