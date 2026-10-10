# L60 technical

## Overview

The panel already holds everything a "what changed" view needs, one version at a time: the
inspection for the current source hash (`usePcbWorkbench.ts:31-38`, keyed by
`revision: sourceHash`) and the drawing SVG for the current render (`usePcbPreview.ts:104-139`,
`display.svg`; per-layer SVGs in `LayerSheet.tsx:20-42`). This packet keeps the previous
version in a small client-side memory and diffs the two:

```
memory[design] = { sourceHash, inspection, drawing }      (last version the user saw)
      |  new inspection with another sourceHash arrives
      v
pair = { before: memory[design], after: current }
  pcbChangeSet(before.inspection, after.inspection)  -> parts and nets   (pure, sync)
  drawingRegions(before.drawing, after.drawing)      -> boxes            (raster, on demand)
      |
ChangeHighlights.tsx in the overlay SVG; chip and list; editor snapshot state.changes
```

No server change, no new RPC, nothing new on the wire.

## Contracts

### Change schemas (`packages/contracts/src/fork/pcb-workspace.ts`)

Beside `PcbComparison` (`:160-176`), using the file's `text`, `finite` and `list` helpers
(`:5-8`) and the existing `PcbLocation` (`:11-15`):

```ts
export const PcbChangeField = Schema.Literals([
  "value",
  "footprint",
  "pcb", // board position or side
  "schematic", // schematic position or sheet
  "orientation", // pins moved relative to the part: rotated, mirrored or flipped
  "pins", // pin numbers or names differ
  "nets", // a pin's net differs
]);
const PcbLocationChange = Schema.Struct({
  from: Schema.optional(PcbLocation),
  to: Schema.optional(PcbLocation),
});
export const PcbComponentChange = Schema.Struct({
  kind: Schema.Literals(["added", "removed", "moved", "changed"]),
  reference: text(),
  value: Schema.String,
  /** Empty for added and removed. */
  fields: list(PcbChangeField, 7),
  pcb: Schema.optional(PcbLocationChange),
  schematic: Schema.optional(PcbLocationChange),
});
export type PcbComponentChange = typeof PcbComponentChange.Type;
const PcbNetMember = Schema.Struct({ reference: text(), pin: text() });
export const PcbNetChange = Schema.Struct({
  name: text(),
  kind: Schema.Literals(["added", "removed", "changed"]),
  joined: list(PcbNetMember, 50),
  left: list(PcbNetMember, 50),
});
export type PcbNetChange = typeof PcbNetChange.Type;
export const PcbChangeRegion = Schema.Struct({
  x: finite,
  y: finite,
  width: finite,
  height: finite,
});
export const PcbChangeState = Schema.Struct({
  shown: Schema.Boolean,
  fromSourceHash: text(),
  toSourceHash: text(),
  components: list(PcbComponentChange, 200),
  nets: list(PcbNetChange, 200),
  /** In drawing millimetres, for the view and sheet in the snapshot's `view` and `sheet`. */
  regions: list(PcbChangeRegion, 50),
  drawing: Schema.Literals(["pending", "ready", "unavailable"]),
  truncated: Schema.Boolean,
});
export type PcbChangeState = typeof PcbChangeState.Type;
```

`kind` precedence: `added`, `removed`, then `moved` when `pcb` or `schematic` is in `fields`,
else `changed`. A moved part can also carry `value` or `nets`; the list shows all fields.

### Editor action and snapshot

- `PcbEditorAction.action` (`pcb-workspace.ts:300-329`): append `"changes"`. It uses the
  existing `enabled` field (`:339`): absent or `true` shows, `false` hides.
- `PcbEditorResult.state` (`:359-379`): append
  `changes: Schema.optional(Schema.NullOr(PcbChangeState))`. `null` means "no previous
  version for this design". Optional, so older clients and servers keep decoding; other
  packets add their own optional fields here too (L52 `findings`, L56 `layerPreset`).

### Pure diff (`packages/contracts/src/fork/pcb-changes.ts`, new)

Exported from `packages/contracts/src/fork/index.ts`. No Effect, no I/O.

```ts
export const MOVE_TOLERANCE_MM = 0.01;
export interface PcbChangeSet {
  readonly components: ReadonlyArray<PcbComponentChange>;
  readonly nets: ReadonlyArray<PcbNetChange>;
}
export function pcbChangeSet(before: PcbInspection, after: PcbInspection): PcbChangeSet;
/** The Compare tab's one-line form: "Added 10k", "Removed LED", "value, pcb". */
export function changeDetail(change: PcbComponentChange): string;
export function changeCounts(
  set: PcbChangeSet,
): Record<PcbComponentChange["kind"] | "nets", number>;
```

`pcbChangeSet`:

1. Components by `reference`, as `compareInspections` does today (`semantics.ts:444-450`).
   Union of keys in after-then-before order so the list follows the new design.
2. For a reference in both:
   - `value`, `footprint`: string inequality.
   - `pcb`: one side missing the location, a different `sheet`, or `|dx|` or `|dy|` above
     `MOVE_TOLERANCE_MM`. `schematic` the same.
   - `pins` and `nets`: match pins by `number`. Different number sets or names: `pins`. Same
     numbers with a different `net`: `nets`.
   - `orientation`: for pins present on both sides with a position in a view, the offset from
     the part's own location in that view (`pin.pcb - part.pcb`) differs beyond the tolerance.
     This is what rotation, mirroring and moving to the back side do; without it they would
     look like a pin edit.
     Absolute pin positions are not compared directly. That is the reason today's diff reports
     moved parts as "pcb, pins" (`semantics.ts:452-453`, the `pins` JSON includes positions).
3. `pcb` and `schematic` on the change carry `from` and `to` for moved, added (`to` only) and
   removed (`from` only) parts.
4. Nets by `name` from `PcbInspection.nets` (`pcb-workspace.ts:38-44`). A name only after is
   `added`, only before `removed`, both with different member sets `changed`. `joined` and
   `left` are the member differences keyed `reference:pin`, capped at 50 each. Unnamed or
   auto-named nets are compared like any other: a renamed net shows as removed plus added.
5. Order: added, removed, moved, changed, each by reference with natural numeric order
   (`R2` before `R10`). Nets by name.

`compareInspections` (`semantics.ts:443-459`) becomes:

```ts
export function compareInspections(before: PcbInspection, after: PcbInspection) {
  return pcbChangeSet(before, after).components.map((c) => ({
    kind: c.kind === "moved" ? ("changed" as const) : c.kind,
    reference: c.reference,
    detail: changeDetail(c),
  }));
}
```

so `PcbComparison.changes` keeps its schema (`pcb-workspace.ts:165-172`) and the Compare tab
and `loom_pcb_compare` keep working, with move noise removed. The existing test
(`workbench.test.ts:21-25`) still expects `detail: "value"` for a value edit.

## Server

No new server code beyond the `compareInspections` change above. No new RPC: both versions
are already in the client, and the server keeps no inspection history (`inspect`,
`PcbPreviewService.ts:1818-1859`, recomputes per call).

## Storage

None persisted. In memory on the client:

### Change memory (`apps/web/src/fork/pcb-preview/changeMemory.ts`, new)

A module-level LRU, so it survives the panel unmounting when its tab is hidden
(`PcbPreviewPanel.tsx:1597-1604` renders null when not visible) and design switches
(`DesignWorkspace` is keyed by design, `:1564-1565`).

```ts
export interface DrawingSnapshot {
  readonly view: PcbView;
  readonly sheetId: string;
  /** Visible layer names and opacities, or the preset, so only like-for-like drawings diff. */
  readonly layersKey: string;
  readonly frame: PcbBounds;
  /** In paint order. One entry for single-image drawings, one per visible layer otherwise. */
  readonly images: ReadonlyArray<{ readonly svg: string; readonly opacity: number }>;
}
export interface SeenVersion {
  readonly sourceHash: string;
  readonly inspection: PcbInspection;
  readonly drawing: DrawingSnapshot | null;
}
export const changeMemory: {
  get(key: string): SeenVersion | undefined;
  set(key: string, value: SeenVersion): void;
  setDrawing(key: string, sourceHash: string, drawing: DrawingSnapshot): void;
};
```

Key: `${environmentId}:${threadId}:${designId}`. At most 8 designs; drawings count against a
16 MiB budget of SVG text (drop the oldest entries' `drawing` first, then entries). SVG sheets
are capped at 4 MiB each by the server (`readSheet`, `PcbPreviewService.ts:1041-1048`).
`setDrawing` ignores a snapshot whose `sourceHash` is not the entry's.

## Clients

All web code is in `apps/web/src/fork/pcb-preview/`. Mobile has no PCB panel.

### Change state (`useChangeHighlights.ts`, new)

Called once in `DesignWorkspace` (the component in `PcbPreviewPanel.tsx` that owns `preview`,
`workbench`, `view`, `customLayers` and the key handler):

```ts
const changes = useChangeHighlights({
  key, // memory key
  inspection: workbench.inspection, // PcbInspection | null
  display: preview.display, // current drawing (usePcbPreview.ts:104-114)
  layerSvgs, // Map<sheetId, svg> for display.renderKey, from LayerSheet (below)
  customLayers,
  suspended: three || historyShown, // historyShown only once L66 exists
});
// -> { pair, set, counts, shown, chip, regions, drawing, show(on), dismiss() }
```

- **New pair.** When `inspection` changes and `inspection.sourceHash` differs from
  `changeMemory.get(key)?.sourceHash`, set `pair = { before: memory entry, after: { sourceHash,
inspection } }` (if an entry existed), then `changeMemory.set(key, { sourceHash, inspection,
drawing: null })`. Same hash: nothing. This runs in render with a "last seen hash" state
  comparison, as `usePcbPreview.ts:86-87` and `:116-139` already do, not in an effect.
- **Drawing snapshots.** When `display.sourceHash === inspection.sourceHash` and every image
  is present (`display.svg` for single-image drawings; for layered boards
  (`display.result.sheets[0]?.layer`, as at `PcbPreviewPanel.tsx:982`) every visible layer's
  svg in `layerSvgs`), call `changeMemory.setDrawing(key, hash, snapshot)`. `frame` is
  `svgFrame(display.svg)` (`geometry.ts:2-11`); all layer sheets share it because the server
  crops every layer to one physical frame (`svg.ts:5-14`). `layersKey` is `display.layers`
  plus, for layered boards, the visible layers' `name:opacity` list.
- **Set.** `set = pair && pcbChangeSet(pair.before.inspection, pair.after.inspection)`, memoized
  on the pair. `chip` is true when the set is non-empty or the drawing diff (once known) found
  regions; when the set is empty and the drawing is unknown, start the drawing diff right away
  (once, below) and show the chip only if it finds regions. A pure touch therefore shows
  nothing.
- **Shown.** `shown` persists across reloads within the mount: if highlights are on and
  another reload makes a new pair, they stay on for the new pair. `dismiss()` hides the chip
  for the current pair only.
- Render highlights only while `pair.after.sourceHash === display.sourceHash`, the same rule
  `DrawingOverlays` uses for component markers (`PcbPreviewPanel.tsx:991-995`).

### Layer SVGs

`LayerSheet` (`LayerSheet.tsx:7-42`) already holds each layer's svg string. Add an optional
`onSvg?: (sheetId: string, svg: string) => void` prop, called from the effect at `:35-42`
when `svg` changes. The panel passes a stable callback that writes into a
`useRef<{ renderKey: string; svgs: Map<string, string> }>` reset when `display.renderKey`
changes, and bumps a counter state so the hook sees completion. No new fetches.

### Drawing diff (`drawingDiff.ts`, new)

Two parts, so the pixel logic is testable without a browser:

```ts
/** Pure. Compares two equal-size RGBA buffers and returns changed regions in pixels. */
export function diffRegions(
  a: { width: number; height: number; data: Uint8ClampedArray },
  b: { width: number; height: number; data: Uint8ClampedArray },
  options?: { threshold?: number; cell?: number; minPixels?: number; maxRegions?: number },
): { regions: Array<{ x: number; y: number; width: number; height: number }>; truncated: boolean };

/** Browser. Rasterizes both snapshots onto one millimetre frame and returns regions in mm. */
export async function drawingRegions(
  before: DrawingSnapshot,
  after: DrawingSnapshot,
): Promise<{ regions: PcbChangeRegion[]; truncated: boolean } | null>;
```

`drawingRegions`:

1. Return `null` (status `unavailable`) unless `view`, `sheetId` and `layersKey` match.
2. Union the two frames. Scale `s = min(8, 1024 / max(union.width, union.height))` pixels per
   millimetre, so a canvas is at most 1024 px on its long side (4 MiB of RGBA).
3. For each side, a canvas of the union size; for each image, load it as the panel already does
   (`URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))`, `img.decode()`, as in
   `SvgViewport.tsx:283-293`), set `globalAlpha` to its opacity, and `drawImage` it at
   `((frame.x - union.x) * s, (frame.y - union.y) * s, frame.width * s, frame.height * s)`.
   Revoke URLs in `finally`. Then `getImageData`.
4. `diffRegions` with defaults `threshold: 48` (largest channel or alpha difference out of 255),
   `cell: 4` px, `minPixels: 3` changed pixels per cell, `maxRegions: 50`: mark cells, join
   8-connected marked cells (with one cell of dilation so a trace becomes one region), take
   each group's bounding box, merge overlapping boxes, keep the 50 largest by area and set
   `truncated` when more existed.
5. Convert to millimetres (`x / s + union.x`) and pad by 0.5 mm.

Runs at most once per pair and view: memoize the promise on `(pair.after.sourceHash, view,
sheetId, layersKey)`. Started when highlights are first shown, when the editor `changes` action
runs, or immediately when the structural set is empty (to decide whether to show the chip).
Same-origin blob SVGs do not taint the canvas; capture already relies on this
(`SvgViewport.tsx:283-298` draws a blob SVG and calls `toBlob`). The KiCad and tscircuit SVGs
reference no external resources. If `getImageData` throws anyway, status `unavailable`.

### Overlay (`ChangeHighlights.tsx`, new)

```tsx
export function ChangeHighlights(props: {
  set: PcbChangeSet;
  regions: readonly PcbChangeRegion[];
  view: PcbView;
  sheet: string;
}): JSX.Element;
```

A `<g pointerEvents="none" fill="none">` rendered inside the overlays prop of both
`SvgViewport`s, beside `DrawingOverlays` (`PcbPreviewPanel.tsx:983-997` and `:1447-1457`). Its
props are plain data, so L69 and a future Compare tab overlay can draw any `PcbChangeSet`.

- Location per view: `pcb` uses `change.pcb`; `schematic` uses `change.schematic` and only when
  its `sheet` equals the shown sheet, the rule `DrawingOverlays` uses (`Overlays.tsx:22-24`).
- Added: ring `r=1.8` stroke `var(--color-success)`. Removed: an X of half-size 1.4 at `from`,
  `var(--color-destructive)`. Moved: ring at `to` in `var(--color-info)` and a line from `from`
  to `to` with a small arrowhead `<marker>`; if only one end is on this sheet, the ring alone.
  Changed: ring `var(--color-warning)`. Tokens from `apps/web/src/index.css:222-239`;
  `--color-muted-foreground` is at `:246`.
- Net changes: a 0.6 mm square on each joined pin at its after position (success) and each left
  pin at its before position (destructive). Pin positions come from the respective inspection,
  so the hook passes both inspections' pin lookups; keep that inside the hook and give the
  overlay ready points: `netMarks: Array<{ x, y, sheet?, kind: "joined" | "left" }>`.
- Regions: `<rect>` with `stroke="var(--color-muted-foreground)"`, `strokeDasharray`, only
  when `view` and `sheet` match the regions' drawing.
- Stroke widths `.3` mm and sizes in millimetres, like `Overlays.tsx:37`. If L52's
  `useOverlayScale()` exists, multiply sizes by it so markers stay readable when zoomed out.
- Highlights draw under `DrawingOverlays` (selection and marks stay on top): render
  `ChangeHighlights` first in the overlays fragment.

No CSS animation, no transitions.

### Chip and list (`ChangesChip.tsx`, new)

In the doc bar's actions (`PcbPreviewPanel.tsx:1072`), before `SurfaceSwitch`, rendered when
`changes.chip && !three`:

- A `Button size="xs" variant="ghost-muted"` with `DiffIcon` and "Changed. Show changes (D)",
  or `aria-pressed` and "Hide changes (D)" while shown. `role="status"` on a wrapper so screen
  readers hear the change once. Tooltip: counts from `changeCounts`, for example "2 moved, 1
  added, 3 nets, drawing changed".
- A menu trigger beside it opening a `Popover` with the list: groups Added, Removed, Moved,
  Changed (using the `CHANGE` icon and tone map, exported from `RevisionCompare.tsx:37-41`, with
  a `moved` entry added there using `MoveIcon` and tone `info`), then Nets, then "Drawing
  changed (4 areas)" or "Checking the drawing…" or "Drawing changes are unavailable for this
  reload." Each part row shows reference, value and fields ("Moved, value"). Click calls
  `selectComponent(reference)` (`PcbPreviewPanel.tsx:205`), which focuses it. A net row calls
  `setNet(name)`.
- X button: `dismiss()`, tooltip "Dismiss until the next change".
- Existing `components/ui` variants only.

### Key and shortcut list

- Key handler (`PcbPreviewPanel.tsx:1053-1064`), one line after the `n` line:
  `else if (key === "d" && drawingTools && changes.pair) changes.show(!changes.shown);`
- `SHORTCUTS` (`WorkspaceChrome.tsx:252-261`): append
  `["Show changes since the last reload", "D"]`.

### Editor action and snapshot

In the editor switch (`PcbPreviewPanel.tsx:374-544`):

```ts
        case "changes":
          if (!changes.pair) throw new Error("This design has not changed since it was opened.");
          changes.show(c.enabled ?? true);
          if (c.enabled !== false) await changes.drawingSettled();
          break;
```

`drawingSettled()` resolves when the drawing diff for the current view is `ready` or
`unavailable` (it never rejects). In the snapshot state (`:546-570`) add
`changes: changes.state()`, which returns `null` without a pair, else a `PcbChangeState` with
the lists capped at 200 (`truncated` set) and regions for the snapshot's `view` and `sheet`.

`loom_pcb_editor`'s description (`apps/server/src/fork/pcb-preview/mcp.ts:27`) gains "show what
changed since the last reload (changes)". The CLI follows, because `t3 pcb <action>` calls
`loom_pcb_<action>` (`cli.ts:6-16`).

## Agent-facing tools

No new tool. An agent that just edited a design can call
`loom_pcb_editor { action: "snapshot" }` and read `state.changes` to confirm the edit landed
as intended (for example that R5 moved and nothing else did), or call
`{ action: "changes" }` then `{ action: "capture" }` to show the user an annotated image.
Both need the panel open on that design, like every editor action (L24 user guide).

## Performance

- Structural diff: linear in parts plus pins, once per pair, memoized. Boards stay under the
  inspection limits (5,000 parts, `pcb-workspace.ts:37`).
- Drawing diff: only on demand and once per pair and view; two canvases of at most 1024 px,
  one pass over at most 1M pixels, a cell grid of at most 256 by 256. Image decoding happens
  off the critical path in `img.decode()`.
- Memory: at most 8 designs and 16 MiB of retained SVG text.
- Rendering: highlights are static SVG in the existing overlay; pan and zoom transform the
  overlay as today. No loop, no timers, no animation.
- Wire: nothing new. The editor snapshot grows by at most a few tens of kilobytes when an agent
  asks for it.

## Alternatives considered

- **Parse traces on the server and diff geometry.** Exact for KiCad `segment`, `arc` and
  `via` tokens, but needs a second parser for tscircuit `pcb_trace` and schematic wires, adds
  every segment to `PcbInspection` (sent over the WebSocket on every reload), and still misses
  zones and graphics. The raster diff covers every drawn change with no wire cost.
- **A server `changes` RPC keeping old inspections.** The server keeps no inspection history,
  and the client already has both versions.
- **Reuse `compare` between checkpoints.** Needs a Git ref for "the version shown before", which
  does not exist for unsaved editor edits or turns still running.
- **Show highlights automatically on every reload.** Paints over the drawing the user may be
  measuring on; L42 made the same call.
- **Fade highlights out over time.** A timer and animation; rejected by the no-repaint rule.
