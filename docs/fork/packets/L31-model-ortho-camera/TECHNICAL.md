# L31 technical

## Overview

The perspective camera stays the rig. OrbitControls, `setView`, `zoom`, `refit`, `restore` and
`snapshot` keep moving `camera` exactly as now (`createViewer.ts:53,76,391-402,481-512,536-548`).
When orthographic is on, a second `OrthographicCamera` is synced from the rig right before each
render, pick and capture, and those calls use whichever camera is active. Distance from the
target remains the only scale, so zoom, fit and saved views need no ortho branch.

Sync rule, from the rig camera `p` with target `t` and distance `d = |p.position - t|`:

- `ortho.position` and `ortho.quaternion` copy `p`'s; `ortho.up` copies `p.up`.
- `halfHeight = d * tan(p.fov / 2)`, `halfWidth = halfHeight * p.aspect`; `left/right/top/bottom`
  are `±halfWidth` and `±halfHeight`; `zoom = 1`.
- `near = d - 2 * sceneRadius` (negative is fine for an orthographic matrix) and
  `far = d + 2 * sceneRadius`, where `sceneRadius` is the bounding sphere radius of the model
  box joined with the bed footprint. This keeps parts behind the eye visible when zoomed in and
  keeps depth precision tight (orthographic depth is linear).

At the target plane the two frusta match exactly, so toggling does not jump. Pan speed matches
too: OrbitControls' perspective pan already scales by `targetDistance * tan(fov / 2)`
(`three/examples/jsm/controls/OrbitControls.js:994-1010`), which is the ortho half-height.

Because `fitDistance` sizes the bounding sphere into the vertical and horizontal fov
(`viewer/views.ts:13-20`), the same distance gives an ortho frustum of half-height
`d * tan(fov / 2)`, which is larger than the sphere radius for every aspect. Fit stays correct;
the test in TESTING.md pins this.

### Overlay sprites

Measurement dots are `Sprite`s with `sizeAttenuation: false` and `scale 0.015`
(`createViewer.ts:229-237`). three multiplies that scale by view depth only for perspective
projection (`three/src/renderers/shaders/ShaderLib/sprite.glsl.js:21-23`), so in ortho the dots
would shrink to almost nothing. While ortho is active, set each dot's scale to `0.015 * d`
(same on-screen size), and restore `0.015` when switching back. The helper is
`markerScale(projection, distance)` in `viewer/projection.ts`.

## Contracts

`packages/contracts/src/fork/model-workspace.ts`:

```ts
export const ModelProjection = Schema.Literals(["perspective", "orthographic"]);
export type ModelProjection = typeof ModelProjection.Type;

export const ModelCamera = Schema.Struct({
  // existing fields unchanged (lines 11-21)
  projection: ModelProjection.pipe(
    Schema.withDecodingDefault(Effect.succeed("perspective" as const)),
  ),
});
```

This follows `BuildPlateSetting.pattern` (`packages/contracts/src/fork/model-preview-3d.ts:237`).
The key becomes optional in the encoded JSON and required in the decoded type, so every saved
view and annotation camera already on disk decodes as perspective. `ModelSavedView.camera`,
`ModelAnnotation.camera`, `ModelEditorAction.camera`, `ModelEditorResult.camera` and
`ModelEditorComplete.camera` inherit it (`model-workspace.ts:30,44`, `model-editor.ts:47,86,97`).

`packages/contracts/src/fork/model-editor.ts`, on `ModelEditorAction` next to `wireframe`:

```ts
projection: Schema.optional(ModelProjection),
```

## Server

`apps/server/src/fork/model-preview-3d/openscad.ts:72-82`: `pngArgs` gains a
`projection: ModelProjection` argument and emits `--projection=o` or `--projection=p` instead of
the hard-coded `"--projection=p"` at line 79.

`ModelPreviewService.renderImages` (`ModelPreviewService.ts:1104`) gains a `projection`
argument after the existing `overrides` argument and passes it to `pngArgs` at line 1179.
Keeping the new argument last preserves existing positional callers. STL, 3MF and OBJ are already
wrapped in an `import()` SCAD there, so ortho works for every format the tool accepts.

No change to the workspace store: it decodes with `Schema.fromJsonString(ModelWorkspace)`
(`apps/server/src/fork/model-preview-3d/store.ts:11,26`), which applies the default.

## Storage

Only the new `projection` key inside each stored camera. Rows written before L31 have no key and
decode as perspective. Rows written after L31 read fine by an older build only if it ignores
unknown keys; `Schema.Struct` does by default on decode, so a downgrade keeps working.

## Clients

`apps/web/src/fork/model-preview-3d/viewer/projection.ts` (new, pure, no DOM):

- `syncOrthographic(ortho, rig, target, sceneRadius)`: applies the sync rule above.
- `markerScale(projection, distance)`: `0.015` or `0.015 * distance`. Move the `0.015` literal
  from `createViewer.ts:237` here as `MARKER_SCALE`.

`viewer/createViewer.ts`:

- Create `ortho = new OrthographicCamera()` beside `camera`; keep `let projection`.
- `activeCamera()` returns `ortho` (after `syncOrthographic`) or `camera`.
- Use it in `pick` (line 115-121), `placeMarks` (190), `paintMarks` (287), `render` (353) and the
  capture loop (595).
- Cache `sceneRadius` in `setModel` and `setBed`.
- New method `setProjection(value)`: set, rescale dots, `requestRender()`.
- `snapshot()` returns `projection`; `restore()` applies `state.projection` like `wireframe`.
- `capture(four)`: when `four`, set `projection = "orthographic"` for the loop and put it back in
  the existing `finally` (lines 615-626).

`viewer/ViewerCanvas.tsx`: `display` (line 55) gains `projection`; apply it in the load effect
(126-130) and the display effect (163-167) with `setProjection`.

`ModelPanel.tsx`:

- `display` state (line 134) gains `projection: "perspective"`.
- `recall` (141-149) copies `camera.projection`.
- Key handler: `else if (key === "p") setDisplay(...)` toggling projection, next to `w`
  (line 760).
- Editor `display` case (216-224) applies `c.projection` when present.
- `DisplayTools` props gain `orthographic` and `onOrthographic`.

`WorkspaceTools.tsx`: append a `MenuCheckboxItem` "Orthographic" with `MenuShortcut` `P` after
Axes in `DisplayTools` (184-189), and a help row `["Perspective, orthographic", "P"]` in `HELP`
(197-207).

`ViewsSection.tsx`: the row detail (227-234) adds "Orthographic" when the view is orthographic
and no other detail applies. Optional, one line.

`captureSheet.ts` needs no change: `viewer.restore(view.camera)` (line 39) now restores each
view's projection, and `restore(original)` puts the user's back.

## Agent-facing tools

- `loom_model_preview_3d_editor` (`mcp.ts:14-24`): no new action. `display` accepts
  `projection`; `camera` already carries it through `ModelCamera`; `snapshot` returns it.
- `loom_model_preview_3d_render` (`mcp.ts:181-201`): add
  `projection: Schema.optional(ModelProjection)` to parameters, update the description to
  mention it, and pass `input.projection ?? DEFAULT_RENDER_PROJECTION` from `renderModelTool`
  (`mcp.ts:212-226`). `DEFAULT_RENDER_PROJECTION` is `"orthographic"` per the recommendation in
  PRODUCT.md.

## Performance

No idle loop: `setProjection` and the sync run only inside the existing `requestRender` path.
The sync is a handful of float copies per frame. One extra camera object, no extra render
target. Workspace JSON grows by about 30 bytes per saved camera.

## Alternatives considered

- Switch `controls.object` to the ortho camera and zoom through `camera.zoom`. OrbitControls
  supports that, but `zoom()`, `setView`, `refit`, `fitDistance`, `snapshot` and `restore` all
  reason in distance, so every one would need an ortho branch and saved views would need a
  zoom field. Rejected.
- A very long focal length (tiny fov) to fake ortho. Distorts picking near the edges, needs huge
  distances and breaks `near` and `far`. Rejected.
- A setting for the default projection. Not requested; one key is enough.
