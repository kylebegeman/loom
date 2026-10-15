# L71: 3D panel parity with the Loom 3D widget

Status: Implemented; focused checks pass. Real-client checks pending.

Kyle uses Loom's 3D panel day to day, and the Loom 3D ChatGPT widget shipped eight feature
packets first. This packet ports them so both surfaces behave the same. The widget's specs live
in its repository at `docs/product/feature-packets.md`, sections F1 to F8; its source is the
reference implementation. Each port reuses L23's existing settings, panel, viewer and toast
paths instead of copying the widget's shell.

## Scope

| Widget packet | Loom behavior                             | Status      |
| ------------- | ----------------------------------------- | ----------- |
| F1            | Copy values with a chosen precision       | Implemented |
| F2            | Automatic extent dimensions on the part   | Implemented |
| F3            | Model context menu                        | Implemented |
| F4            | Feature snapping                          | Implemented |
| F5            | Undo and redo                             | Implemented |
| F6            | Parameter scrubbing with automatic render | Implemented |
| F7            | Variant explorer                          | Implemented |
| F8            | Linking model features to parameters      | Implemented |

Out: mobile (no 3D panel), and widget-only shell features such as `.loom3d` packages.

## F1: copy values with chosen precision

- Contract: optional `displayPrecision` (`"auto"`, 0 to 3) in `ModelPreviewSettings`. Absent
  decodes as before and means automatic; a save without it keeps the stored choice.
- `units.ts`: `formatLength`, `formatLengths`, `formatDelta` and `formatArea` take a precision.
  Automatic keeps every call site's previous output; a chosen precision shows exactly that many
  decimals and overrides a site's own digits and trimming. A delta's sign follows the shown
  value and uses a true minus.
- Applied to part dimensions and their changes, plate and bed fit text, measurements (rows,
  canvas labels and captures), assembly and enclosure fit values, variant comparisons, the
  status bar and overhang area. Catalog bed sizes, settings values and input fields keep
  their automatic form.
- `CopyValue` (`controls.tsx`) and `copyValue.ts` copy the shown value without digit
  grouping and confirm with a toast; a blocked clipboard selects the value and says to press
  Cmd or Ctrl+C.
- Precision is chosen in Loom settings next to Units.

## F2: automatic extent dimensions

- `viewer/extents.ts`: `extentDimensions` ports the widget's function unchanged. X runs along
  the front edge, Y along the right edge and Z up the front-left corner of the posed world
  bounds, offset by 8% of the largest side (at least 2 mm). A flat axis gets no line.
- `createViewer.ts` `setExtents`: draws dashed witness lines, the dimension line and end ticks
  in a neutral ink (`#4a515c` light, `#9aa1ab` dark, never the accent) in their own scene group,
  with labels such as "X 20.00 mm" on the existing mark path. Labels follow the length format,
  so units and precision apply, and `paintMarks` puts them in captures. They are redrawn
  whenever the bounds change (model load, refresh, orientation and lay flat) or the theme
  changes, and markup redraws leave them alone. Nothing is saved.
- Toggle: **K**, **Display > Overall dimensions** next to Overhangs, and an entry in the
  shortcut help. Off by default and held in panel state only, outside the saved camera.
- Differences from the widget: Loom draws extents as scene lines, so the dimension line is 1 px
  (WebGL line width) rather than 1.5 px, and dash and tick sizes scale with the part rather
  than staying fixed in screen pixels. Canvas labels use the measurement labels' two automatic
  decimals. The assembly panel has no extents toggle yet.

## F3: model context menu

- `pointActions.ts`: `pointActions` and `sectionAxisThrough` port the widget's functions, with
  the widget's tests. Entries that would fail are left out. Loom additions: a separate pin limit
  (30 pins against 100 measurements, the workspace schema limits), `canEdit` (history, sliced
  layers or a read-only workspace keep only Center, Section and Copy) and `canLayFlat` (hosts
  without lay flat). `coordinateText` formats the model-space point with the F1 formatter.
- `createViewer.ts`: a context pick on a still right click (under 5 px), Ctrl+left click, or a
  primary touch held 500 ms (cancelled by 8 px of movement, `pointercancel` or a release; the
  release after a long press does not also pick). The browser's `contextmenu` is always
  prevented and a right drag still pans. The pick snaps like a measurement pick once snapping
  is ready (Alt for a free point) and reports the model and world point, the face normal in
  both spaces, and canvas-relative x and y with the canvas rectangle. A miss opens nothing.
  New `contextAtCenter()` and `centerAt(world)`.
- Keyboard: the Menu key or Shift+F10 while the canvas has focus opens the menu at the view
  center (`opensPointMenu` in `viewer/keyboard.ts`); a miss toasts "No part at the view
  center." Both are in the shortcut help.
- `PointMenu.tsx`: Loom's `Menu` primitives with a virtual anchor at the pick, clamped 8 px
  inside the canvas and opening toward the larger free side. It focuses the first item; arrows,
  Home and End come from the menu. A keyboard close returns focus to the canvas, and an outside
  click closes it. `ModelPanel` closes it on any navigation or camera change and on a geometry
  revision, pose or pick-ability change.
- Actions: Measure switches to the distance tool with the point as the pending first pick;
  Pin opens the existing one-point change request; Center calls `centerAt`; Section enables the
  section on `sectionAxisThrough(worldFace, axis)` at the point's world coordinate; Lay flat
  uses the existing point-based `faceOrientationAt`; Copy uses `copyValue` and its toast.
- Passing check: Loom already centers a new section axis on posed bounds (`stats.box` holds the
  oriented world box), so the widget's unposed-bounds defect does not occur here.
- Differences from the widget: `contextAtCenter` uses the canvas center (Loom has no viewport
  insets). `centerAt` moves the camera at once because Loom has no fly-to animation. Base UI's
  popup exposes no collision boundary, so the stage clamp is done on the anchor plus the side
  choice. The assembly panel has no point menu yet.

## F4: feature snapping

- `viewer/snap.ts` ports the widget's additions onto Loom's snapping: `SnapKind` gains `center`
  (hole center) and `faceCenter`, and `SNAP_PRIORITY` is vertex, center, midpoint, faceCenter,
  edge, then the surface. An earlier kind within reach beats a nearer later one; candidates
  within 0.01 px tie and the one nearer the camera wins. `snapNear` collects the smooth regions
  it visits and offers `faceCenter` (area centroid, only when the whole region is one flat face
  within 1 degree and 0.01 mm, cached per region) and each fitted rim's center with its
  `CircleFit`, and returns `rims` the cursor passed, deduplicated with `sameRim`. New
  `snapToRimCenter`. Rims are traced and fitted once per region through a per-topology region
  index, which `circleAt` now shares.
- `createViewer.ts`: the latest four passed rims stay "woken" (cleared whenever snapping
  resets: model load, refresh and pose changes). They compete as centers on the surface, and on
  a raycast miss in Distance mode with snapping ready and Alt up, hover and the pick use
  `snapToRimCenter`, so a through hole's center is pickable. The pick reports kind `center`.
- Hover: a ringed cross for a hole center with its rim drawn dashed and the caption "Hole
  center, ⌀ 8.00 mm" from the length format (units and precision); an open diamond and "Face
  center" for a face center. The Measure hint says "Corner, edge and center snapping ready"
  once the index is built, and the shortcut help carries the widget's hint.
- `pcb-preview/Board3D.tsx` shares the viewer. Its saved `Pcb3dSnap` schema predates centers,
  so a center pick is recorded there as `free` rather than widening the PCB workspace schema.
- Not mapped: Loom has no snap on/off switch (snapping is always on, Alt picks freely), so the
  widget's "Snap to corners, edges and centers" switch label has no home. Loom keeps its world
  space topology rebuilt on every pose change, so the widget's `modelRay` is not needed. Agent
  snaps (`snapNearPoint`) still snap to corners and edges only. The point menu (F3) keeps
  "a miss opens nothing" and does not pick woken centers.

## F5: undo and redo

- `undoHistory.ts` ports the widget's `shared/history.ts`: steps keep only the fields they
  changed, `HISTORY_LIMIT` 100, `COALESCE_MS` 800 for one key, a run that ends where it started
  is dropped, a new step clears redo and `rebase` drops steps on fields that moved. Two
  additions: `undo` and `redo` also return `from`, the values a step replaces, and a merged
  run is relabelled from its whole change. `same` ignores key order and absent keys, because
  the server returns items with its own key order.
- `undoSlice.ts`: the slice is measurements, pins, section, orientation and customizer values.
  `describeChange` names each step and gives its coalescing key, prefixed by the changed
  fields: added, deleted, cleared, showed or hid a measurement, renamed a measurement, moved a
  point (keyed by measurement); added, edited, deleted or moved a pin and changed its status;
  section on or off, axis, flip, filled cut and moved; changed or reset the orientation; chose
  a parameter set, restored source defaults, changed a parameter (keyed by name).
- `useUndoHistory.ts` keeps one history per file revision in memory, outliving a panel
  remount, for the latest 40 files. Status reaches the panel through `useSyncExternalStore`.
  Steps are recorded where they are committed: workspace operations once saved (the next list
  is the history's own present with the operation applied, as the server applies it), section
  and orientation values when set, and customizer values as observed, their first load
  adopted rather than recorded.
- `useModelEditing` takes `{ undo: true }` from the model panel. `mutate` records measurement
  and pin operations after a successful save; `editSection` records section changes; a saved
  orientation records itself. Undo first clears a half-made measurement, then applies the
  step item by item with `listPatch`: an item still as the step left it is saved back, one
  already at the target needs nothing, and one changed elsewhere since is left alone. A step
  where nothing could apply is dropped with a "Could not undo …: it changed somewhere else."
  toast. Customizer values go back through the session's own history (`nearestEntry`), so
  its history menu stays in step; when no entry matches, it records "Restored values".
- Keys (`viewer/keyboard.ts`): `undoShortcut` maps Cmd or Ctrl+Z to undo, Shift with it and
  Ctrl+Y to redo; Cmd+Y and Alt combinations do nothing and key repeat steps again.
  `isTextEntry` leaves text fields their own undo. The shortcut help shows Undo and Redo with
  ⌘ on a Mac and Ctrl elsewhere, plus Ctrl+Y off a Mac.
- Toolbar: Undo and Redo lead the document actions, labelled "Undo <step>" and "Redo <step>",
  or "Nothing to undo" and "Nothing to redo" and disabled. Below 400 px wide, Redo shows only
  when there is something to redo. Each step shows a toast ("Undid: …", "Redid: …"), which
  screen readers announce, as the widget's toasts do.
- Deviations:
  - Loom has no measurement point dragging, so the "point drag" is any saved measurement edit;
    the hook test covers add, move, undo, redo and a conflict.
  - The scope is the content revision (the CAD source, or the mesh for other files), not the
    render: measurements are tagged with the render revision, which changes with each
    parameter render, and undoing a parameter change must reach across it.
  - The widget replays whole fields into local state. Loom's markup is saved on the server and
    can change from the agent or another window, so undo patches items and checks each one.
  - Only entering a file revision rebases. The workspace stream lags a save, so rebasing on
    every observation would drop the user's own steps.
  - The 3D assembly panel keeps its own placement undo (20 steps, its own shortcut); the model
    panel has no assembly. Edits made in the assembly panel's markup are not recorded.
  - The customizer's undo and redo buttons stay as local controls, retitled "Undo parameter
    edit" and "Redo parameter edit"; the panel shortcut now owns Cmd+Z.
  - A pin deleted and restored by undo may lose its review image when the server has already
    pruned it; the restore retries without it.
  - Agent edits that run through the same editing paths (picks, lay flat, reset orientation)
    are recorded too. Agent section commands and recalled views are not.
  - The section always applies, since it is local to the panel.
  - Clearing earlier versions' measurements undoes as one step.

## F6: parameter scrubbing with automatic render

- `nameScrub.ts` ports the widget's `shared/scrub.ts` with its tests: `SCRUB_PX_PER_STEP` 4,
  `SCRUB_FACTOR` 10 (Shift faster, Alt finer), fractional steps that accumulate from the drag
  start and are held by `clampSteps`, and `scrubValue` on the grid through the minimum,
  clamped and rounded to the step's decimals. Loom also has parameters without a range, so a
  missing minimum or maximum leaves that side open, with the grid through zero.
- `controls.tsx`: `ScrubName` makes a number parameter's name the handle (pointer capture,
  `ew-resize` cursor, `touch-action: none`, a neutral hover, no accent). Its tooltip carries
  the hint. Loom's existing `Scrub` value field stays as it was and remains the keyboard
  route; it now reports drags through an optional `onHold`, as `ScrubName` does. A shared
  `useHold` releases the hold if a row unmounts mid-drag, so filtering or collapsing a group
  cannot leave renders held. `ParameterRow` passes `onHold` to both.
- `useParameterPreview.ts`: the quiet time is `AUTO_RENDER_MS` 400 (was 300), and a held
  preview does not schedule, so no render starts while the pointer is down. Releasing an
  unchanged scrub renders nothing because the values equal the applied ones, which also
  covers the widget's skip when the CAD equals the active revision's. `ScadCustomizer` keeps
  the held state. Typed values already committed only on Enter or blur, and only when changed.
- The **Live** switch is now **Auto-render**, still on by default, with the widget's hint as
  its tooltip.
- Supersede: a new applied state remounts `ScadRender` under a new key. Its result atom has
  `idleTtlMs: 0`, so the old request is interrupted when its last reader closes (covered by
  client-runtime's "interrupts document-lived commands when their final reader closes"). The
  server's `renderJob` also interrupts the previous job for the same file under `jobLock`
  (covered by "a newer render cancels the older render for the same file"). The new
  `ScadCustomizer` test drives hold, the 400 ms pause and a replacement with fake timers.
- Deviations:
  - No busy retry. The widget's one-job worker answered "busy" until an aborted job freed
    it. Loom's server has no such reply: the same file's previous job is interrupted, and
    `renderSlots` waits for a free slot instead of rejecting, so `renderWithRetry` has
    nothing to retry.
  - "Each render is a revision with its parent" maps to Loom's existing mesh lineage. Every
    render is a new mesh revision, and the panel's previous-version ghost and dimension
    changes compare against the one it replaced. No new revision store was added.
  - Loom keeps its own value-field scrub, which spans the range across the field's width and
    uses Shift for fine. The name handle follows the widget (4 px a step, Shift faster, Alt
    finer), so the two drags differ by design.
  - Loom has no separate slider. Arrow keys on the value field and the reset dot schedule on
    change.
  - Hint copy says "The preview renders" instead of "A new revision renders", because Loom
    calls these previews.
  - The name handle also works in the Variants and assembly part editors, which share
    `ParameterRow`. They pass no `onHold`, so their own render timing is unchanged.
  - A manual Apply exists only while Auto-render is off, so there is no pending timer for it
    to clear. Loom has no separate cancel-render button in Customize.

## F7: variant explorer

- Extends Loom's existing Variants workbench (`VariantsInspector.tsx`, its parameter sweep,
  the variant render and cancel commands and `loom_model_preview_3d_propose_variants`). No
  second explorer.
- `variants.ts` ports the widget's `shared/variants.ts` with its tests: `MAX_VARIANT_VALUES` 6,
  `MAX_VARIANTS` 6, `parseValues` (commas, spaces or semicolons), `variantValue`
  (`Number(v.toFixed(6))`), `variantName` ("width 40 · wall 2") and `expandVariants` with the
  widget's checks and messages: one or two different parameters, a known name, at least one
  and at most six unique values each, inside the parameter's range, and at most six
  combinations ("That makes 9 variants; explore up to 6 at once."). Values are OpenSCAD
  literals on top of the current values, so `expandVariants` takes Loom's `ScadParameter`
  list and returns candidates instead of widget CAD objects. `sweepValues` reads a typed list
  per parameter kind.
- Sweep dialog: errors appear inline after the first attempt and then follow each edit; a
  parse error names its parameter ("width: "abc" is not a number."). The submit button counts
  the variants it will make. The dialog also refuses a sweep that would pass the workspace's
  24-variant limit before saving anything, and shows a save failure in the dialog rather than
  behind it.
- Rendering stays Loom's batch: one variant at a time through `models.render` with its
  `variantId`, thumbnails from the offscreen viewer. The batch button now reads **Stop**.
  Stopping cancels the running variant and keeps every finished card with its thumbnail.
- The latest sweep is the generated set. A bar shows its size with **Discard all**, which
  stops its renders and deletes the generated variants not yet kept. Each generated card has
  **Keep** (accessible name "Keep width 40 · wall 2"), enabled once its thumbnail exists.
  Keep uses Loom's promote: the values become the working values with a "Use width 40 ·
  wall 2" history step, and the card stays as a saved variant with its original source
  revision. Every card with a render now shows its X × Y × Z size in display units and the
  chosen precision.
- Fixed in passing: freshly saved variants did not render. `render` read the variant list
  from the closure of the click that saved them, which never contained the new items, so
  "From current values", "Duplicate" and sweeps saved cards without rendering them. Saved
  items are now passed to `render`, with the latest workspace list as a fallback. A failed
  render message no longer starts with "Error: ".
- Limit wording, the widget's revision-cap defect: Loom's version history has no cap message,
  but a full workspace collection returned the raw schema validation error, including to `propose_variants`. `MODEL_WORKSPACE_LIMITS` in
  the contracts now defines each cap once for the schema, the server and the panel, and
  `applyWorkspaceOperation` refuses a new item in a full collection with "Keep up to 24
  variants. Delete some before adding more." (saved views, measurements, change requests and
  review sheets name themselves the same way). Edits to items a full collection already
  keeps still save.
- Deviations:
  - Unkept variants are saved workspace variants, as Loom's workbench always stored them.
    They never become versions or customizer steps, and Discard all removes them. The
    widget kept its exploration in memory only.
  - Keep does not discard the rest of the set, unlike the widget, because Loom's cards are
    saved candidates that stay comparable. The generated marker lives in the inspector, so
    closing the panel turns an open set into ordinary saved variants.
  - Switch and text parameters stay sweepable, as before: switches take true or false and
    text splits on commas or semicolons. Numbers follow the widget exactly. Vector
    parameters are still excluded.
  - Names use the parameter's source name, as the widget does ("width 40"), instead of the
    previous prettified label with ", " between parameters.
  - A sweep makes at most six variants (was twelve). The agent's `propose_variants` limit of
    twelve is unchanged.

## F8: linking model features to parameters

- `viewer/linking.ts` ports the widget's pure core next to the F4 snap topology, with its
  tests (width, height, inset, unmoved, changes shape, and `regionAt` on a shared edge).
  `linkParameter` samples up to 12 triangle centers per 20° smooth region and measures each
  sample's signed move along its normal to the nearest same-facing surface of a nudged render
  (grid hash, reach 10% of the diagonal, a miss counts as reach). A region moves when its RMS
  move passes 1e-4 of the diagonal; its rate is the median move per unit, averaged over the
  nudges. A different region count is "changes shape". `MAX_LINKED_PARAMETERS` is 8.
- `useParameterLinks.ts` is the runner. It renders through the panel's model path
  (`models.render`, or `models.renderModel` for Python CAD) with its own `variantId`
  `loom-link`, so the preview and variant jobs are never cancelled by it. It loads each mesh
  with `loadModel` and reads model-space triangles with `modelPositions` (new in
  `snapTopology.ts`). Each chosen number parameter steps ± its customizer step inside its
  range (`parameterRange`, moved to `nameScrub.ts` so the runner needs no UI module), one
  render at a time. A parameter with no room gets "Its range leaves no room for a step."
  Results are kept per source revision and rendered values (the last 8). Cancel aborts the
  loop, cancels the server job and drops the partial result. A source edit or a file change
  cancels a running analysis.
- **Customize** gains a **Linked faces** section below the parameters: a chip picker when
  more than eight number parameters exist, **Analyze parameters** / **Analyze again**,
  **Cancel analysis**, progress "Rendering x of y" through `OperationStatus`, and rows reading
  "Moves N face(s)", "Moves no face", "Changes shape" or the failure, each toggling a
  highlight of that parameter's faces. The analysis starts only when the part on screen is
  the rendered values' mesh.
- The viewer's `setLinked(positions)` draws the faces under the orientation root in the
  lay-flat face's fill, clipped by the section plane, never picked, hidden during captures
  and cleared when a model loads. The panel draws it again after each load.
- The F3 point menu gains a "Moved by <names>" group with one row per parameter that moves the
  face under the pick (`regionAt` with the pick's model-space point and face normal). Dragging
  a row sideways scrubs that parameter through `useNameScrub`, the F6 name-scrub logic now
  shared by `ScrubName` and the menu, holding the automatic render until release. A plain
  press opens Customize and focuses the parameter's control, clearing a search that hides it
  and opening its group. `ScadSession` gains `edit` and `hold` for this.
- Deviations:
  - The analysis renders the base part itself (one extra render, usually cached) instead of
    reading the mesh on screen, so the base and the nudges come from the same loader and
    frame. Progress counts it, so "Rendering 1 of 5" covers the base.
  - Analysis is not exclusive with rendering, as it is in the widget. Its own job key keeps
    the preview and variants running; the host's render slots still order the work.
  - Only number parameters without an option list are analyzed; switches, text, vectors and
    dropdowns have no step. The widget's CAD model has only numbers.
  - Parts over 200,000 triangles are refused with "Parameter analysis works on parts up to
    200,000 triangles.", because topologies are built on the main thread. The widget has no
    limit.
  - The point menu opens for links alone when no other action applies, and a drag keeps it
    open so a second drag can follow; the render after release closes it when the model
    changes.

## Bug bash (October 14, 2026)

Fixed, each with a test:

- Undo and redo pressed again before the workspace stream caught up (a held Cmd+Z) compared
  against the stale list, read the first undo's own write as an edit made elsewhere and dropped
  the step. Undo saves the stream has not shown yet are now laid over the live list
  (`withPending`), and forgotten once the stream shows them or the save fails.
- Showing a changed parameter from the point menu focused its reset button, so Enter or Space
  threw the value away. `focusParameterControl` now looks only inside the row's control.
- Copy coordinates from the point menu, where the host blocks the clipboard, claimed "The value
  is selected" with nothing selected. With nothing on screen to select, the notice now shows
  the value to copy by hand.
- A failed link analysis kept showing its error after the values or the source changed. The
  error now belongs to the values it ran on.
- A declared step of zero (`[0:0:10]`) made the name scrub and the slider write NaN. It now
  steps by 1, and a negative step counts by its size.

Left as is:

- When an undo step is dropped as a conflict, the history's present still carries the step's
  earlier state. List undo only touches items that differ, so this has no visible effect.
- Whether a touch release after a long press closes the point menu is unverified without a
  device. Finger drift during the hold no longer moves the camera (see below).

Second round, bugs confirmed in the widget and checked against this port. Present and fixed,
each with a test:

- A touch long press opened the point menu but left navigation live, so finger drift before
  the lift turned the camera and the camera change closed the menu. The hold now suspends
  navigation until the finger lifts or the touch is cancelled (`createViewer.test.ts`).
- The name scrub could stop one step short of a decimal limit: `(5 - 1.2) / 0.1` is
  37.99999, so the clamp truncated to 37 steps. Step counts within float noise of a whole
  number now count as that number (`nameScrub.test.ts`).
- Quick adds or deletes of different measurements or pins within 800 ms merged into one undo
  step, because the step key named only the kind of change. Keys now name the item, and
  "Clear earlier versions" groups its deletes into one step (`undoSlice.test.ts`,
  `useModelEditing.test.tsx`).
- Choosing a point menu item with the mouse left focus on the page body, so viewer keys such
  as Escape did nothing. The menu now gives focus back to the canvas after a chosen item,
  unless the action moved focus itself, as a pin's note field does (`PointMenu.focus.test.tsx`).
- Copied deltas carried the typographic minus (U+2212), which code and spreadsheets do not read
  as a sign. Copies now use an ASCII hyphen (`copyValue.test.ts`).
- Overall dimension lines seen end-on in an orthographic standard view collapsed to a point
  and their label sat on top of the others. An axis shorter than 4 px on screen now hides its
  lines and label, live and in captures (`createViewer.test.ts`).

Also fixed in passing: the variant comparison showed a "(0.0)" change for a difference that
rounds to zero at the chosen precision. It now hides it, as the Part tab already did.

Absent:

- Jittery right click closing the point menu. Loom never enables orbit damping, so no camera
  change fires after the button is released.
- A render finishing mid-edit resetting the edited values. A render only records what was
  rendered; the parameter history resets only when the source revision changes.
- A held scrub or slider dropping the pending 400 ms render. `held` is a dependency of the
  auto-render effect, so the release reschedules it (`useParameterPreview.test.tsx` now
  covers a hold that changed nothing). Analysis runs on its own job key and does not hold the
  preview; typing during it schedules a render as usual.
- Undo or redo lost or misapplied across a revision or model switch. `ModelFile` remounts per
  path, and the undo scope and the list it patches come from the same loaded revision, so a
  step cannot land on another revision; while a revision loads, undo does nothing.
- A change that rounds to zero tinted by its unrounded sign. `formatDelta` takes its sign from
  the rounded value and the delta styles do not tint by sign.
- The slider rendering while its thumb is held still. The thumb holds the render from press
  to release, however long it rests.
- Variants built from unrendered edits but parented to the active revision. Loom has no
  revision parent for variants: each stores its full value set, renders it, and Keep applies
  exactly those values as one undo step. The sweep dialog says it starts from the current
  values.
- Bake or other renders starting while variants or analysis hold a one-job worker. Bake here
  is a request to the agent, not a render, and the server has no one-job worker: jobs are
  keyed by file and variant and wait for a render slot.

## Surfaces

Web and desktop: supported wherever the 3D panel runs. Mobile: not supported. Remote: the
setting rides the existing settings RPC.

## Extension points used

None new. Reuses L23's `ext-settings`, `ext-panels` and `ext-mcp`.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).
