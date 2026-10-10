# L42 technical

## Overview

Today `setModel` disposes the replaced model immediately
(`apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:521-524`). This packet lets the main
panel's viewer hand the replaced model to a ghost instead, drawn only when asked. The panel
tracks the previous revision and size, decides when to show the "Changed" chip, and exposes the
toggle through `D`, the Display menu, the palette and the editor command.

Retention is opt-in per viewer (`keepPrevious(true)`), so the variants thumbnail viewer
(`VariantsInspector.tsx:719`), the variants comparison canvas (`VariantsInspector.tsx:168`) and
the PCB board viewer (`apps/web/src/fork/pcb-preview/Board3D.tsx:89`) keep disposing as today.

## Ghost

`viewer/ghost.ts` follows the shared definition in
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md), "Ghost overlay":

```ts
export function createGhost(
  parent: Object3D,
  requestRender: () => void,
): {
  set(object: Object3D | null): void;
  dispose(): void;
  // Additive, needed by this packet (to be added to the shared definition):
  setVisible(visible: boolean): void;
  setTheme(dark: boolean): void;
  setClipping(planes: readonly Plane[]): void;
};
```

- `set(object)`: disposes the current ghost's geometries and materials, then takes ownership of
  `object`: every mesh's original materials (and their textures) are disposed and replaced by
  one shared `MeshBasicMaterial` (`transparent: true`, `opacity: 0.22`, `depthWrite: false`,
  `depthTest: true`, `side: FrontSide`). Lines and points in the object are hidden. The object
  is added to `parent`. `set(null)` clears.
- `setVisible`: toggles the ghost root's `visible` and requests a render. Without it, hiding
  would have to dispose the mesh and `D` could not bring it back.
- `setTheme(dark)`: colour `0xa3acb9` on dark, `0x6b7480` on light, close to the theme's muted
  foreground. three's `Color` cannot parse the app's CSS colour functions, so the bed already uses
  fixed hex values per theme (`viewer/bed.ts:79`); the ghost does the same.
- `setClipping(planes)`: sets `clippingPlanes` on the shared material. The renderer already has
  local clipping on (`createViewer.ts:60`).
- `parent` is typed `Object3D` (the shared definition calls it `scene`), so a viewer can group
  its ghosts.

The ghost is never inside `model`, so picking (`createViewer.ts:123`), fit and `box`
(`setModel`, line 526) and dimensions ignore it with no extra code.

## Contracts

`packages/contracts/src/fork/model-editor.ts`:

- `ModelEditorAction` (line 5) gains `previous: Schema.optional(Schema.Boolean)`, used with
  `action: "display"`.
- `ModelEditorState` (line 65) gains:

```ts
previous: Schema.optional(
  Schema.Struct({
    shown: Schema.Boolean,
    /** Size of the previous version in mm, X Y Z. */
    size: ModelPoint,
    sourceRevision: Schema.String,
  }),
),
```

Absent when there is no previous version. Optional, so older servers and clients still decode.
No settings and no workspace entity: the previous version is session state, by design.

## Server

No logic change. Extend the editor tool description in
`apps/server/src/fork/model-preview-3d/mcp.ts:16` with "display can show the previous version
of the model after a change (`previous`)". `completeEditor`
(`ModelPreviewService.ts:889-895`) already passes `state` through.

## Storage

None.

## Clients

### Viewer (`viewer/createViewer.ts`)

Additive:

- `const ghosts = new Group(); scene.add(ghosts);` next to `helpers` (line 327).
- `let keep = false`, `previous: ReturnType<typeof createGhost> | null = null`,
  `previousShown = false`, `previousAvailable = false`.
- In `setModel` (line 513), replace the dispose at lines 521-524 with: if `keep` and the
  outgoing model's triangle count (from the last `meshStats`) is at most
  `GHOST_TRIANGLE_LIMIT` (1,000,000), `scene.remove(model)`, create `previous` lazily with
  `ghosts` as parent, `previous.setTheme(dark)`, `previous.set(model)`,
  `previous.setVisible(previousShown)`, `previousAvailable = true`. Otherwise dispose as today
  and clear `previous`.
- `applySection` (line 97) also calls `previous?.setClipping(section.enabled ? [plane] : [])`.
- `theme()` (line 379) also calls `previous?.setTheme(dark)`.
- New methods on the returned object:
  - `keepPrevious(enabled: boolean)`: when turned off, clears and disposes the previous.
  - `showPrevious(visible: boolean)`: stores `previousShown`, applies it, `requestRender()`.
  - `clearPrevious()`: `previous.set(null)`, `previousAvailable = false`.
  - `hasPrevious(): boolean`.
- `dispose()` (line 628) disposes `previous`.

Capture needs nothing: `capture` renders the scene (line 595), so a shown ghost is in the image
and a hidden one is not.

### Panel (`ModelPanel.tsx`)

- `viewer/ViewerCanvas.tsx`: optional props `keepPrevious` and `previousShown`, applied in
  effects like `display` (line 162) and once after load.
- New state in `ModelPanel`:
  - `previous: { revision: string; size: Vector3Tuple; triangles: number } | null`
  - `previousShown: boolean`
  - `changed: "chip" | "dismissed" | null`
  - `reloadCause = useRef<"watch" | null>(null)`
- At line 461, inside the `seen.watched !== watched` branch, set `reloadCause.current = "watch"`
  (not for a `loadKey`-only change, which is a settings change).
- `onStats` (line 485): before storing the new stats, compare the outgoing
  `{ geometryRevision, stats }` with the incoming revision (`mesh?.revision`):
  - Same revision, or no outgoing stats: `viewer.current?.clearPrevious()`, `previous = null`.
  - Outgoing triangles over the limit: `previous = null` (the viewer disposed it).
  - Otherwise `previous = { revision: geometryRevision, size: stats.size, triangles }`.
  - If `reloadCause.current === "watch"` and a previous now exists, `changed = "chip"`. Reset
    `reloadCause`.
    Read the outgoing values through a ref so the callback's dependencies stay `[mesh?.revision]`.
- Toggle function `togglePrevious()` sets `previousShown`; it is a no-op without `previous`.
- Key handler (line 718): `else if (key === "d" && previous) togglePrevious();`, next to the
  `a` line (763).
- Chip: a small `role="status"` element in the viewport, in a new `PreviousChip` component in
  `WorkspaceTools.tsx`, reusing the hint's look (`.model-hint`, `workspace.module.css:700`) under
  a new class `.model-change-chip` positioned top centre. Text and actions:
  - hidden: "Changed." button "Show previous" with `Kbd` D, close button "Dismiss"
  - shown: "Showing previous." button "Hide" with `Kbd` D, close button "Dismiss"
    The chip renders only when `changed === "chip"`. No timers, no animation.
- `DisplayTools` (`WorkspaceTools.tsx:147`): optional prop
  `previous?: { available: boolean; shown: boolean; note: string | null; onChange(v): void }`;
  append a `MenuCheckboxItem` "Previous version" with `MenuShortcut` D after "Axes". Disabled
  with the note when not available. Append `["Previous version", "D"]` to `HELP` (line 197).
- Palette: add `"toggle-previous"` to `ModelAction` (`actions.ts:2`), a palette item
  "3D model: Show or hide previous version" in `palette.tsx` beside capture and re-render, and
  handle it in the `onModelAction` listener (`ModelPanel.tsx:653`).
- `PartSection` (`ModelInspector.tsx:336`): optional prop `previousSize`. Under each dimension
  (the `model-dims` map at line 373) show the signed delta ("+2.0 mm", "−1.5 mm") when its
  magnitude is at least
  `DIMENSION_DELTA_MM = 0.05`, with an accessible label "X changed by plus 2.0 mm". Pass it from
  `ModelPanel.tsx:1122`.
- Editor (`ModelPanel.tsx:216`, `display` case): `c.previous !== undefined` sets
  `previousShown`, failing with "No previous version yet." when there is none. The `snapshot`
  state (line 392) adds `previous` when one exists.

### Which reloads count

| Cause                                                                     | Previous kept | Chip |
| ------------------------------------------------------------------------- | ------------- | ---- |
| File change seen by the watcher (agent or editor edit, SCAD include edit) | Yes           | Yes  |
| SCAD parameter apply, Live mode, parameter set, re-render command         | Yes           | No   |
| Settings change in the `loadKey` (line 449)                               | Yes           | No   |
| Same mesh revision (cached SCAD render)                                   | No            | No   |
| First load, hidden release reload (line 470)                              | No            | No   |

A file touched without a content change gets a new revision (it hashes size, modified time and
inode, `ModelPreviewService.ts:97`), so the chip can appear for an identical mesh. Rare and
harmless: the ghost then coincides with the part.

## Agent-facing tools

No new tool. `loom_model_preview_3d_editor` with `{ action: "display", previous: true }` shows
the ghost; `capture` then includes it; `snapshot` returns `state.previous` with the previous
size and revision so an agent can report "X grew by 2.0 mm" without a capture.

## Performance

- Memory: at most two meshes per open model. At the 1,000,000 triangle cap, a non-indexed STL
  holds about 72 MB of positions and normals per copy on the CPU and the same on the GPU, so the
  previous version can double that. Above the cap nothing is kept.
- Rendering: one extra transparent draw per ghost mesh, only while shown. Nothing changes when
  hidden (`visible = false` skips it).
- No animation, no loop: toggles call `requestRender()` once.
- Network: none.

## Difference tint (phase 2, not in v1)

If Kyle wants it later: a worker receives the previous mesh's world-space triangles and the
current mesh's welded vertices (the same welding as L38's `snap.ts`). It bins previous triangles
into a uniform grid (cell size about twice the mean edge length) and, for each current vertex,
finds the distance to the nearest previous triangle by searching outward cells. Vertices further
than 0.05 mm get a tint through a vertex colour attribute on a cloned current material. Estimated
1 to 3 s at 1M triangles, capped at 500,000 triangles per side. Unsigned distance only shows
"changed", not "added" versus "removed"; the ghost already shows that. Costs: a worker, vertex
colours that conflict with coloured 3MF parts, and a material swap to undo.

## Alternatives considered

- Retain in the panel as a URL and reload on `D`: no memory cost, but a second download and parse
  every toggle, and the signed URL may have expired.
- A split or side-by-side view: clearer for large changes, but duplicates the camera, the canvas
  and every display option; the overlay answers "what changed?" in place.
- Use the viewer's single shared `setGhost` slot: simpler, but L49's timeline would replace the
  previous version and `D` would stop working. Two instances of the same factory cost nothing.
- Keep the previous version across hidden release: would hold memory for panels nobody is looking
  at, against L23's release rule.
