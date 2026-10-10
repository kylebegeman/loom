# L61 technical

## Overview

`Board3D` already runs the model viewer. For each exported asset it creates a viewer with
`createViewer(host.current)` (`apps/web/src/fork/pcb-preview/Board3D.tsx:89`), turns off the
grid and axes (`:91-92`), loads the GLB with `loadModel(..., "glb", ...)` (`:94`), hands it over
with `created.setModel(model, false)` (`:99`) and disposes the viewer in the effect cleanup
(`:112-115`). The panel drives it through `Pcb3dHandle`, a `Pick` of the viewer's `fit`, `zoom`,
`setView`, `snapshot` and `restore` plus `refresh`, `capture`, `isReady` and `isLoading`
(`:31-36`, implemented at `:120-145`).

L61 keeps that shape and adds three layers:

1. Shared viewer pieces from L31, L37 and L38, used as they are. Board3D calls
   `setProjection`, `setSection` (with `caps`) and `setPickMode("measure", ...)` on the same
   viewer the model panel uses, so the 3D packets' rendering, caps and snapping apply to boards
   with no PCB copy.
2. Two pure PCB modules: `board3dParts.ts` sorts the loaded GLB into layers and components, and
   `heights.ts` turns that into heights and maps drawing coordinates onto the 3D board.
3. UI and agent wiring: the panel owns display state (projection, section, layers) so it
   survives reloads and surface switches; Board3D owns the transient tool, measurements and
   heights; the editor command and snapshot expose all of it.

Two small, additive viewer changes are L61's own: `pick` skips hidden objects, and
`invalidate()` redraws after Board3D changes visibility.

## Contracts

`packages/contracts/src/fork/pcb-workspace.ts`. Extend the import at line 3 to
`import { ModelCamera, ModelPoint, ModelProjection, ModelSection } from "./model-workspace.ts";`
(`ModelProjection` exists once L31's contract part is in, `ModelSection.caps` once L37's is; see
IMPLEMENTATION.md step 1).

New schemas, placed before `PcbEditorAction` (`pcb-workspace.ts:300`):

```ts
const layer3dState = Schema.Literals(["shown", "hidden", "unavailable"]);
/** Display state of the 3D board's part groups. */
export const Pcb3dLayers = Schema.Struct({
  board: layer3dState,
  soldermask: layer3dState,
  copper: layer3dState,
  silkscreen: layer3dState,
  topComponents: layer3dState,
  bottomComponents: layer3dState,
});
export type Pcb3dLayers = typeof Pcb3dLayers.Type;
/** Editor input: only the groups to change. */
export const Pcb3dLayersPatch = Schema.Struct({
  board: Schema.optional(Schema.Boolean),
  soldermask: Schema.optional(Schema.Boolean),
  copper: Schema.optional(Schema.Boolean),
  silkscreen: Schema.optional(Schema.Boolean),
  topComponents: Schema.optional(Schema.Boolean),
  bottomComponents: Schema.optional(Schema.Boolean),
});
export const Pcb3dSide = Schema.Literals(["front", "back"]);
export const Pcb3dSnap = Schema.Literals(["vertex", "midpoint", "edge", "face", "free"]);
/** A distance between two points, or a height (start on the board face, end at the point). */
export const Pcb3dMeasurement = Schema.Struct({
  kind: Schema.Literals(["distance", "height"]),
  start: ModelPoint,
  end: ModelPoint,
  lengthMm: finite,
  snaps: Schema.optional(Schema.Tuple([Pcb3dSnap, Pcb3dSnap])),
  side: Schema.optional(Pcb3dSide),
  reference: Schema.optional(text()),
});
export type Pcb3dMeasurement = typeof Pcb3dMeasurement.Type;
const extreme = Schema.NullOr(
  Schema.Struct({ heightMm: finite, reference: Schema.NullOr(text()) }),
);
export const Pcb3dHeights = Schema.Struct({
  boardThicknessMm: finite,
  /** Highest point of any part above the board's top face. */
  above: extreme,
  /** Lowest point of any part below the board's bottom face, leads included. */
  below: extreme,
  parts: list(
    Schema.Struct({ reference: text(), side: Pcb3dSide, aboveMm: finite, belowMm: finite }),
    100,
  ),
  partCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type Pcb3dHeights = typeof Pcb3dHeights.Type;
```

`side` uses `front` and `back` to match L55's `PcbBoardStats.tallest.side`; the UI says
"Top" and "Bottom".

`PcbEditorAction` (`pcb-workspace.ts:300-346`): append `"display"`, `"section"`, `"measure"` and
`"height"` to the action literals (after `"maximize"`, line 329), and append fields after `text`
(line 345):

```ts
projection: Schema.optional(ModelProjection),
section: Schema.optional(ModelSection),
layers3d: Schema.optional(Pcb3dLayersPatch),
points: Schema.optional(Schema.Array(ModelPoint).check(Schema.isMinLength(1), Schema.isMaxLength(2))),
snap: Schema.optional(Schema.Boolean),
side: Schema.optional(Pcb3dSide),
```

`PcbEditorResult` (`:359-379`): add `measurement3d: Schema.optional(Pcb3dMeasurement)` beside
`path`, and these optional keys to `state` after `loading`:

```ts
tool3d: Schema.optional(Schema.Literals(["none", "distance", "height"])),
layers3d: Schema.optional(Pcb3dLayers),
measurements3d: Schema.optional(list(Pcb3dMeasurement, 20)),
heights: Schema.optional(Schema.NullOr(Pcb3dHeights)),
sectionCaps: Schema.optional(Schema.Literals(["filled", "partial", "off", "open-mesh", "none"])),
snap3d: Schema.optional(Schema.Literals(["idle", "building", "ready", "off", "failed"])),
```

`sectionCaps` and `snap3d` repeat L37's and L38's value lists (L37 TECHNICAL.md line 39, L38
TECHNICAL.md line 188). `tool3d` is separate from `tool` so the existing 2D literal list
(`:373`) does not change shape. `PcbCompleteEditorInput` (`:381-389`) reuses
`PcbEditorResult.fields.state`, so it gets the state keys for free; add
`measurement3d: Schema.optional(Pcb3dMeasurement)` to it too.

Nothing here is persisted, so there are no decoding defaults of L61's own. The persisted
defaults it depends on are L31's `ModelCamera.projection` (default `"perspective"`) and L37's
`ModelSection.caps` (default `true`), which keep old saved views and annotation cameras loading.

## Server

No new service method. The editor bridge already carries any command to the panel and back.

- `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:2383-2387`: the result is built field by
  field; add `...(input.measurement3d ? { measurement3d: input.measurement3d } : {})`.
- `apps/server/src/fork/pcb-preview/mcp.ts:27`: extend the `loom_pcb_editor` description with
  "3D projection, section, layer visibility, 3D measurements and component heights".
- `apps/server/src/fork/pcb-preview/cli.ts`: no change. `t3 pcb editor '<json>'` forwards the
  command to `loom_pcb_editor`, so every new action and field works from the terminal.
- No capability string: the panel's tools are client-side, and the agent actions fail at the
  server's schema decode on an older server.

## Storage

None. Display state lives in panel state, measurements and heights in Board3D state.

## Clients

### Shared viewer (`apps/web/src/fork/model-preview-3d/viewer/`)

Used as L31, L37 and L38 define them:

- Projection: `setProjection(value)`, `activeCamera()` and `snapshot().projection`
  ([L31 TECHNICAL.md](../L31-model-ortho-camera/TECHNICAL.md), "Clients"). `restore(camera)`
  restores projection, so the editor `camera` action needs no PCB code.
- Caps: `setSection({ ...section, caps })`, the renderer's `stencil: true`, `createSectionCaps`
  and `closedMesh` ([L37 TECHNICAL.md](../L37-model-section-caps/TECHNICAL.md), "Stencil caps").
  Board3D reads the cap state the viewer reports for `sectionCaps`. Board3D does not call
  `setClosedHint`: GLB boards have no manifold summary.
- Snap: `setPickMode("measure", onPick)` builds the topology in the worker and snaps clicks;
  `snapStatus()`, `onSnapStatus(...)` and `snapPoint(point, radiusMm)` serve the hint and agents
  ([L38 TECHNICAL.md](../L38-model-measure-snap/TECHNICAL.md), "Viewer"). L38 says the PCB
  viewer never enters Measure (its line 191); after L61 it does, and that is fine because the
  build only starts on entering Measure and is capped at `SNAP_TRIANGLE_LIMIT`.

L61's own viewer changes, both additive:

- `pick` (`createViewer.ts:112-126`) keeps only hits whose object and every ancestor up to the
  model are `visible`. three's raycaster tests `layers`, not `visible`
  (`three/src/core/Raycaster.js:240-248`), so without this a hidden part still takes clicks and
  snaps. Add a module-level `shownIn(object, root)` beside `pick` and use it in the `.find`
  predicate at `:123-124`, together with the section test. This also helps the model panel once
  L48 hides assembly parts.
- `invalidate()` on the returned object: resyncs L37's caps (the helper meshes must take their
  source mesh's effective visibility, so a hidden part leaves no cap) and calls `requestRender()`.
  When L37 has landed, extend `syncTransforms` in `viewer/sectionCaps.ts` to copy
  `shownIn(source)` onto each helper pair; `invalidate()` calls it. If L37 has not landed, L61
  builds `createSectionCaps` with that behaviour from the start.

### Part classification (`apps/web/src/fork/pcb-preview/board3dParts.ts`, new, pure)

```ts
export type Board3dLayer =
  "board" | "soldermask" | "copper" | "silkscreen" | "topComponents" | "bottomComponents";
export type BoardComponent = { node: Object3D; reference: string | null; side: "front" | "back" };
export type BoardParts = {
  kind: "kicad" | "tscircuit" | "unknown";
  groups: Record<Board3dLayer, Object3D[]>;
  components: BoardComponent[];
  /** World Z of the board body's faces in mm, or null when no body was found. */
  top: number | null;
  bottom: number | null;
};
export function classifyBoard(root: Object3D, references: ReadonlySet<string>): BoardParts;
export function availableLayers(parts: BoardParts): Record<Board3dLayer, boolean>;
```

Call it once per load, after `setModel`, with the loaded root and the references from
`workbench.inspection?.components` (`PcbPreviewPanel.tsx:209`). Rules, in order:

1. Kind. KiCad if any material is named `board` (KiCad names its board material that,
   `pcbnew/exporters/step/step_pcb_model.cpp:3033` on the 10.0 branch). tscircuit if the root
   contains the node `Loom_millimetres_to_metres` (L24 wraps tscircuit scenes in a node named
   "Loom millimetres to metres", `apps/server/src/fork/pcb-preview/glb.ts:53`, and GLTFLoader
   replaces spaces with underscores, `three/src/animation/PropertyBinding.js:185-188`). Else
   unknown.
2. Board-side meshes by material name, which GLTFLoader keeps unchanged
   (`three/examples/jsm/loaders/GLTFLoader.js:3736`). KiCad's materials are `soldermask`,
   `silkscreen`, `copper`, `pad` and `board` (`step_pcb_model.cpp:3027-3033`, 10.0): `board`
   goes to Board, `soldermask` to Solder mask, `copper` and `pad` to Copper (vias use the
   `copper` material, `:3037`), `silkscreen` to Silkscreen. Both sides of silkscreen and mask
   share one name (`:3039-3042`); the toggles cover both sides, so the side does not matter.
3. Board body fallback (tscircuit and unknown, or KiCad with no `board` material): the mesh with
   the largest XY box area, the same rule L55 uses on the server. Its box gives `top` and
   `bottom`. For KiCad, `top`/`bottom` come from the union of `board` meshes.
4. Components: every other mesh belongs to a component node. The assembly root is found by
   descending from the loaded root while a node has exactly one child. Walking up from the
   mesh, the component node is the first ancestor whose name matches a reference (rules
   below), else the ancestor that is a direct child of the assembly root. KiCad names each component instance with its reference
   (`TDataStd_Name::Set(llabel, refdes)`, `step_pcb_model.cpp:1855`), and OCCT's glTF writer uses
   instance names for nodes by default (`myNodeNameFormat(RWMesh_NameFormat_InstanceOrProduct)`
   in `RWGltf_CafWriter.cxx`). circuit-json-to-gltf names each part node with the component's
   name (`name: box.label`, `dist/index.js:19046`, label from `sourceComponent?.name`, `:18500`).
   A name matches when it, or it with a trailing `_<digits>` removed (GLTFLoader's duplicate
   suffix, `GLTFLoader.js:3757-3771`), is in `references`. No match leaves `reference: null`; the part still counts for layers and
   heights.
5. Side: the component's box centre Z against the board mid-plane `(top + bottom) / 2`; above is
   front. Without a body, front.

`availableLayers` is false for a group with no objects. On tscircuit, copper and silkscreen are
board textures (circuit-json-to-gltf renders them into the board box's top and bottom textures,
`dist/index.js:18281-18290`), so those two are unavailable.

### Heights and board frame (`apps/web/src/fork/pcb-preview/heights.ts`, new, pure)

```ts
export const HEIGHT_PARTS_LIMIT = 100;
export function partHeights(parts: BoardParts): Pcb3dHeights | null;
export function heightAt(parts: BoardParts, point: Vector3Tuple): Pcb3dMeasurement | null;
export function heightOfPart(parts: BoardParts, reference: string): Pcb3dMeasurement | null;
export type BoardFrame = { toModel(point: PcbPoint): [number, number] };
export function boardFrame(parts: BoardParts, inspection: PcbInspection): BoardFrame | null;
```

- `partHeights`: null without a body. Per component, `new Box3().setFromObject(node, true)`
  (precise, so rotated models are not inflated), `aboveMm = max(0, box.max.z - top)`,
  `belowMm = max(0, bottom - box.min.z)`. `above` and `below` are the maxima with their
  references. `parts` holds the 100 tallest by `max(aboveMm, belowMm)` with a non-null
  reference; `partCount` is the full count. `boardThicknessMm = top - bottom`. All values in mm
  (the loader scales GLB metres by 1000, `viewer/load.ts:157-158`).
- `heightAt(point)`: `z >= top` gives `{ kind: "height", side: "front", start: [x, y, top],
end: point, lengthMm: z - top }`; `z <= bottom` the same against `bottom` with
  `side: "back"`; inside the board, length 0. `reference` from the component that owns the hit
  mesh when the caller passes it.
- `heightOfPart(reference)`: the vertical from the part's box top centre (front) or bottom
  centre (back) to the board face.
- `boardFrame`: agents give board points in the drawing frame used by `loom_pcb_inspect`
  (component `pcb` locations, `pcb-workspace.ts:23-31`, with Y down, `semantics.ts:418-440`).
  The 3D board's frame differs by an axis flip and an offset. Fit it: for each sign pair
  `(sx, sy)` in `{±1}²`, the offset is the median of `model.xy - (sx·x, sy·y)` over components
  matched by reference (model position: box centre; drawing position: `pcb` location), and the
  pair with the smallest median residual wins. With fewer than three matches, use the expected
  pair for the kind, KiCad `(1, -1)` and tscircuit `(-1, 1)`, and centre the inspection bounds
  on the board body box. The tscircuit pair is derived from `toGltfTranslation` returning
  `[-x, y, z]` with `z = center.y` (`dist/index.js:18491,18647,19048,19533`) and the loader's
  `rotation.x = π/2` (`load.ts:157`). The KiCad pair is the usual STEP convention and is not
  verified for the GLB; the fit decides in practice.

### Board3D (`apps/web/src/fork/pcb-preview/Board3D.tsx`)

New props: `display: Board3dDisplay`, `onDisplay: (next: Board3dDisplay) => void`,
`inspection: PcbInspection | null`, `onSelect: (reference: string) => void`.

```ts
export type Board3dDisplay = {
  projection: ModelProjection;
  section: ModelSection; // enabled false by default, caps true
  hidden: ReadonlySet<Board3dLayer>;
};
```

- Load effect (`:78-116`): after `created.setModel(model, false)` (`:99`), keep `model` in a
  ref, run `classifyBoard`, store `parts`, apply the current display (`setProjection`,
  `setSection`, visibility) and `partHeights`. Reset measurements and the tool.
- Display effect: on `display` change, set `visible` on every object in hidden groups (true for
  the rest), call `setProjection` and `setSection`, then `invalidate()`. Section bounds for the
  strip come from the model box along the axis.
- Tool state: `tool: "none" | "distance" | "height"`, `pending: ModelPoint | null`,
  `measurements: Pcb3dMeasurement[]` (at most 20; a new one replaces the oldest). Entering a
  tool calls `setPickMode("measure", onPick)`; `onPick([point])` completes a distance on the
  second point or a height on the first. Leaving calls `setPickMode(null, null)`.
- Overlays: `setOverlays(measurements.map(toOverlay), [], pending)`. `toOverlay` fills the
  `ModelMeasurement` identity fields (`id: "m<n>"`, `name`, `sourceRevision: sourceHash`,
  `visible: true`) and, when L38 has landed, `kind: "distance"`. Heights draw as vertical
  distance lines, so the existing label reads the height.
- Handle (`Pcb3dHandle`, `:31-36`) gains: `tool()`, `chooseTool(tool)`, `cancelTool()`,
  `measure(points, snap): Promise<Pcb3dMeasurement>`, `clearMeasurements()`,
  `height(query): Pcb3dMeasurement`, `state(): { tool3d, layers3d, measurements3d, heights,
sectionCaps, snap3d }`. `restore(next)` also calls `onDisplay` with `next.projection` and
  `next.section`, so a recalled camera and the panel's display state agree.
- `measure` snaps with `snapPoint(point, 0.5)` when `snap !== false` and L38's snap state is not
  `"off"`, and records the snap kinds.

### Board3DTools (`apps/web/src/fork/pcb-preview/Board3DTools.tsx`, new)

Rendered by Board3D in the top-left shelf after the Camera menu (`Board3D.tsx:150-176`):

- Display menu (`Menu`, `MenuCheckboxItem`, `MenuShortcut`, as the model panel's
  `DisplayTools`, `model-preview-3d/WorkspaceTools.tsx:147-196`): "Orthographic" with `P`; a
  separator; "Board", "Solder mask", "Copper", "Silkscreen", "Top components", "Bottom
  components". Unavailable items are disabled with the tooltips from PRODUCT.md. The trigger
  reads "Display", or "Display · 2 hidden" while any available group is hidden.
- Tool buttons using the PCB `ToolButton` (`Board3D.tsx:28`): "Measure" (`M`, `RulerIcon`),
  "Section plane" (`SliceIcon`, no key), "Heights" (`MoveVerticalIcon`, a `Popover` like the
  export log at `:224-236`).
- Hint while a tool is active, using the panel's existing `styles.toolHint` markup
  (`PcbPreviewPanel.tsx:714-748`): title "Distance · point 1 of 2" or "Height", a Distance or
  Height switch, the last result formatted with L54's `formatLength` when present, the snap
  state, "Clear" and "Done". Text: "Click two points. Alt places a free point." and "Click a
  point on a part. Alt places a free point."
- The section strip: the exported `SectionStrip` (`WorkspaceTools.tsx:420-477`), which carries
  L37's "Filled cut" toggle; Board3D feeds it the cap state from L37's viewer callback, as
  `ModelPanel.tsx` does. It shows `S` on its Remove button (`:472`); add an optional
  `removeKey?: string | null` prop there (default `"S"`, so the model panel is unchanged) and
  pass `null` until Kyle allocates `S` for the PCB panel.

### Panel (`apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`)

- State next to `three` (`:133`): `[display3d, setDisplay3d] = useState<Board3dDisplay>(...)`
  with perspective, section off with caps on, nothing hidden. Pass `display`, `onDisplay`,
  `inspection={workbench.inspection}` and `onSelect` (the existing selection setter used at
  `:206`) to `<Board3D>` (`:1176-1186`).
- Key handler (`:1041-1068`), one line each, before `else return`:
  - `else if (key === "escape" && three && (board3d.current?.tool() ?? "none") !== "none")
board3d.current?.cancelTool();` placed before the `escape && tab` line (`:1056`), so
    `Escape` leaves the 3D tool before it closes the dock.
  - `else if (key === "m" && three) board3d.current?.chooseTool("distance");`
  - `else if (key === "p" && three) setDisplay3d((d) => ({ ...d, projection: flip(d.projection) }));`
- Editor request handler (`:363-600`):
  - `display`: `model()`; apply `projection` and `layers3d` to `display3d`. Showing an
    unavailable layer throws the PRODUCT.md message. Setting a group that is already in that
    state is fine.
  - `section`: `model()`; require `section`; set `display3d.section`.
  - `measure`: `model()`; `enabled === false` clears; else require two `points` and return
    `measurement3d` from `board3d.current.measure(points, snap ?? true)`.
  - `height`: `model()`; one of `reference`, `point` (drawing frame, mapped with `boardFrame`
    and probed by a vertical raycast from above the board for `side: "front"`, default, or from
    below for `"back"`), or `points[0]` (model frame). Returns `measurement3d`. Errors:
    "Provide a reference, a board point or a 3D point.", "No part found at that board point.",
    "Heights need the board body in the 3D export."
  - `tool`: when `three`, accept `select` (leave the tool), `distance` and `height`; the 2D
    branch at `:511-516` stays as is.
  - `pick` keeps its 2D meaning.
  - Snapshot (`:545-570`): spread `board3d.current.state()` when `three` and ready.
  - The completion (`:574-586`) spreads `measurement3d` when the action returned one.
- Add `default: throw new Error(...)` to the editor switch (`:386`) naming the unsupported
  action, so an older client never acknowledges an action it did not perform. (Today it falls
  through and reports "Editor action completed.")

### Shortcut list (`apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx`)

`SHORTCUTS` (`:251-260`) lists 2D keys, and `ShortcutHelp` (`:262`) appears only in the 2D
viewport (`PcbPreviewPanel.tsx:966`). Add `SHORTCUTS_3D` and a `rows` prop on `ShortcutHelp`
defaulting to `SHORTCUTS`, and render `<ShortcutHelp rows={SHORTCUTS_3D} />` in Board3D's nav
shelf (`Board3D.tsx:202-239`). Rows: "Schematic, Board, 3D" `1 / 2 / 3`; "Measure" `M`;
"Free point without snapping" `Alt + click`; "Perspective, orthographic" `P`; "Tools panel" `I`;
"Cancel tool, then close panel" `Esc`. Also append `["Perspective, orthographic in 3D", "P"]`
to `SHORTCUTS`, as [PCB-FOLLOW-UPS.md](../PCB-FOLLOW-UPS.md) asks for every new key.

## Agent-facing tools

All through `loom_pcb_editor` and therefore `t3 pcb editor`:

| Command                                                                                                | Effect                               | Returns                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `{ action: "display", projection: "orthographic" }`                                                    | Projection                           | Message                                                                                                          |
| `{ action: "display", layers3d: { soldermask: false } }`                                               | Layer groups                         | Message                                                                                                          |
| `{ action: "section", section: { enabled: true, axis: "x", offset: 12, flipped: false, caps: true } }` | Section                              | Message                                                                                                          |
| `{ action: "tool", name: "height" }`                                                                   | 3D tool for the user                 | Message                                                                                                          |
| `{ action: "measure", points: [[...], [...]], snap: true }`                                            | Adds a measurement                   | `measurement3d`                                                                                                  |
| `{ action: "measure", enabled: false }`                                                                | Clears measurements                  | Message                                                                                                          |
| `{ action: "height", reference: "J3" }`                                                                | Part height                          | `measurement3d`                                                                                                  |
| `{ action: "height", point: { x: 40, y: 22 }, side: "back" }`                                          | Height under a board point           | `measurement3d`                                                                                                  |
| `{ action: "snapshot" }`                                                                               |                                      | `state.camera` (projection, section), `layers3d`, `tool3d`, `measurements3d`, `heights`, `sectionCaps`, `snap3d` |
| `{ action: "camera", camera }`                                                                         | Also restores projection and section | Message                                                                                                          |
| `{ action: "capture" }`                                                                                | Uses the current display             | PNG path                                                                                                         |

Model-frame points for `measure` come from `measurements3d`, `heights` and the camera; board
points for `height` come from `loom_pcb_inspect`.

## Performance

- No idle loop. Every change goes through the viewer's `requestRender()`. Layer toggles cost one
  frame. Hover snapping is L38's one `requestAnimationFrame` per pointer move, in Measure only.
- `classifyBoard` and `partHeights` run once per load. The precise box walks every vertex once;
  record the time on a large board in the PR (TESTING.md).
- Snap topology: L38's worker, built only on entering Measure, skipped above 1,000,000
  triangles.
- Section caps: two extra draws per closed mesh while a section is on (L37). A board with a few
  hundred part meshes stays well under a frame, but record the frame time with a section on.
- Payloads: the snapshot adds at most 100 height rows and 20 measurements, a few kilobytes. The
  GLB still streams over the signed URL (`Board3D.tsx:54-66`); no geometry crosses the
  WebSocket.

## Alternatives considered

- Heights on the server from GLB accessor bounds (L55's `readGlbBounds`). Cheap and available
  without opening 3D, but per-mesh boxes cannot answer "how high is this point" and Board3D has
  the geometry loaded anyway. L55 keeps the server summary; L61 does the interactive part.
- A PCB copy of the viewer tools. Rejected: two snap and cap implementations would drift, and
  [PCB-FOLLOW-UPS.md](../PCB-FOLLOW-UPS.md) says to reuse the 3D packets' modules.
- Hiding layers with three's `Layers` masks instead of `visible`. The raycaster would skip them
  for free, but layers do not inherit (every descendant mesh needs its mask), and the rig, the
  ortho camera and the capture path would all need the same mask. `visible` plus a pick filter
  is smaller.
- Saving 3D measurements in the PCB workspace like 2D ones. Needs a new entity and a frame that
  survives re-export; not requested. Kyle can change this later.
- Classifying parts by node name only. KiCad's board-side node names depend on the product name
  fallback in OCCT; material names are set explicitly and survive GLTFLoader unchanged.
