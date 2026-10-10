# L62 technical

## Overview

User exports are client side. PNG reuses the canvas path the attach capture already uses
(`SvgViewport.tsx:251-301`) with an export size, and the 3D capture (`Board3D.tsx:143`). SVG is
new: a pure composer nests the visible layer SVGs, which the client already holds as Blob URLs,
plus the serialized overlay, into one document. Both feed L44's `copyImage` and `saveImage`.
Agents reach the same renderers through the editor `capture` command, which gains `format` and
`scale`; the client sends SVG text back on the existing completion RPC and the server writes it
next to PNG captures.

```text
Capture menu ──► exportCapture(full, action)
                   ├─ png:  viewport.exportPng(full, scale) | board3d.capture() ─► copy/save
                   └─ svg:  viewport.exportSvg(full) ─► composeSvg ─► save
Editor capture ──► same handle methods ─► completeEditorAction { png | svg }
                   ─► captures/<uuid>.(png|svg)
```

## Contracts

`packages/contracts/src/fork/pcb-workspace.ts`:

- `PcbEditorAction` (300-346) gains two optional fields beside `full` and `attachToDraft`:

  ```ts
  format: Schema.optional(Schema.Literals(["png", "svg"])),
  scale: Schema.optional(Schema.Literals([1, 2])),
  ```

  Absent `format` means `png`. Absent `scale` keeps today's attach size
  (`Math.min(2, 2400 / longest side)`, `SvgViewport.tsx:260`), so existing agent calls return
  the same image. Both are optional, so no decoding default is needed and older payloads decode.

- `PcbCompleteEditorInput` (381-390) gains
  `svg: Schema.optional(Schema.String.check(Schema.isMaxLength(8 * 1024 * 1024)))`.

Version skew: an older server decodes `PcbEditorAction` without the new fields and drops them,
so an agent gets a PNG and a `.png` path, which is honest. A newer client talking to an older
server sends `svg`, which the older schema drops as an excess property; the agent then gets the
acknowledgement without a path.

## Server

`apps/server/src/fork/pcb-preview/PcbPreviewService.ts` `completeEditorAction` (2344-2389):

- Reject input with both `png` and `svg` ("Send one capture format.").
- For `svg`: require `Buffer.byteLength(svg) <= 8 MiB` and `/^\s*(<\?xml[^>]*\?>\s*)?<svg\b/`,
  else fail with `invalid-report`, "The editor capture must be an SVG under 8 MiB." Write
  `<uuid>.svg` in the same `captures` directory.
- Change the prune filter regex to `/^[a-f0-9-]{36}\.(png|svg)$/` so both kinds share the
  50-file, 50 MiB budget.
- Pull the write-and-prune block into a local `saveCapture(bytes, extension)` so PNG and SVG use
  one path. No new file: the block is about 35 lines and stays in the service.

`apps/server/src/fork/pcb-preview/mcp.ts:25-33`: the `loom_pcb_editor` description becomes
"... load views, or capture a PNG or SVG (`format`, PNG `scale` 1 or 2). Returns an
acknowledgement and a host file path for captures." `t3 pcb editor` passes JSON through to the
same tool (`cli.ts`), so it needs nothing.

## Storage

Host files only: `<stateDir>/fork/pcb-preview/captures/<uuid>.(png|svg)`, pruned as today. The
web client stores one preference (below). No tables.

## Clients

### Shared helper: `apps/web/src/fork/model-preview-3d/captureExport.ts`

Reuse L44's module. L62 adds one optional parameter:

```ts
export function captureFileName(
  path: string,
  label: string,
  date: Date,
  extension: "png" | "svg" = "png",
): string;
```

Behaviour is otherwise unchanged. If L44 has not landed, create the file exactly as L44's
TECHNICAL.md describes (`captureFileName`, `canCopyImages`, `copyImage`, `saveImage`,
`ExportAction`) with this parameter, and add L44's `captureExport.test.ts` cases.

PCB call: `captureFileName(design.id.replace(/\.circuit\.tsx$/, ".tsx"), label, new Date(), ext)`.
Dropping the last extension of that path gives `design.name` for every discovered kind
(`discovery.ts:46,54,66,82`), including names with dots such as `v1.2`. Labels: `schematic`
(or `schematic-<sheet label>` when there are several sheets), `board`, `3d`.

### Export geometry and the SVG composer: `apps/web/src/fork/pcb-preview/svgExport.ts` (new, pure)

```ts
import type { PcbBounds } from "@t3tools/contracts/fork";
export const LIGHT_CANVAS = "#f1f3f5"; // workspace.module.css:15
export const MAX_EXPORT_PIXELS = 16_777_216; // Safari canvas area limit
export const MAX_EXPORT_SIDE = 8192;
export const SVG_EXPORT_MAX_BYTES = 32 * 1024 * 1024;
export function exportFactor(
  width: number,
  height: number,
  wanted: number,
): { factor: number; reduced: boolean };
export function visibleArea(
  view: { x: number; y: number; scale: number },
  viewport: { width: number; height: number },
  drawing: { width: number; height: number },
  physical: PcbBounds,
): PcbBounds;
export type SvgLayer = { svg: string; opacity: number };
export function composeSvg(input: {
  area: PcbBounds; // millimetres
  layers: readonly SvgLayer[];
  overlay: string | null; // serialized <svg data-overlays>
  background: string | null;
  title: string;
}): string;
```

- `exportFactor` returns `wanted` unless `width * height * wanted²` exceeds `MAX_EXPORT_PIXELS`
  or the longest side exceeds `MAX_EXPORT_SIDE`; then the largest factor that fits, and
  `reduced: true`.
- `visibleArea` maps the viewport rectangle through the view transform into drawing pixels and
  then into millimetres, the inverse of `focus` (`SvgViewport.tsx:165-170`). It is clipped to
  `physical`.
- `composeSvg` writes:

  ```xml
  <svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm"
       viewBox="{area}">
    <title>{design}, {surface}</title>
    <rect x y width height fill="{background}"/>       <!-- when background is set -->
    <g opacity="{o}"><svg id="layer-1" x y width height viewBox="{frame}">…</svg></g>
    …
    <svg id="overlay" …>{overlay children}</svg>
  </svg>
  ```

  Each layer keeps its own `viewBox` (every sheet shares the physical frame, `svg.ts:6-13`), and
  its `x`, `y`, `width` and `height` are that frame, so layers and overlay line up and the file
  is 1:1 in millimetres. Hidden layers (opacity 0) are skipped. `title` is escaped.

- Per layer, before nesting, the composer parses the source with `DOMParser`
  (`image/svg+xml`) and:
  - removes `script` and `foreignObject` elements, every `on*` attribute, and `href` or
    `xlink:href` values that are not `#fragment` or `data:` URLs;
  - prefixes every `id` with `layer-<n>-` and rewrites `url(#…)`, `href="#…"` and
    `xlink:href="#…"` references to match;
  - scopes each `<style>` rule's selectors with `#layer-<n> ` (flat rule lists; at-rules are
    kept as they are), so two layers' class rules cannot restyle each other.
- After joining, if the UTF-8 size exceeds `SVG_EXPORT_MAX_BYTES`, throw "This drawing is too
  large to save as SVG. Save a PNG instead."

The structure of real kicad-cli and tsci SVG output (inline styles versus `<style>` blocks, use
of ids) was not checked against files in this pass; the composer handles each case either way.

### `SvgViewport.tsx`

`PcbViewportHandle` (38-49) gains:

```ts
exportPng: (full: boolean, scale: 1 | 2) => {
  image: Promise<Blob>;
  width: number;
  height: number;
  reduced: boolean;
};
exportSvg: (full: boolean) => Promise<string>;
```

- Extract the body of `capture` (251-301) into a local `draw(full, factor)`, which returns the
  `toBlob` promise. `capture(full)` keeps its factor. `exportPng` uses
  `exportFactor(area.width, area.height, full ? scale * view.current.scale : scale)` with
  `area = full ? drawing.current : size.current`, starts `draw` synchronously and returns the
  promise with the size, so a clipboard write can start inside the click.
- Background fix, which also fixes attach: line 264 reads the viewport's computed
  `backgroundColor`, which is transparent because the colour lives on `.canvas` and `.pane`
  (`workspace.module.css:186,204`), not `.viewport` (550-558). Read
  `getComputedStyle(container).getPropertyValue("--pcb-canvas")` instead, which inherits from
  `.root` (15, 22), falling back to `LIGHT_CANVAS`.
- Safari fallback: line 276 sets `context.filter`, which Safari's canvas ignores. When
  `typeof context.filter !== "string"` and any drawn image has a computed filter other than
  `none`, fill with `LIGHT_CANVAS` instead, so the unfiltered schematic stays readable.
- `exportSvg(full)` throws the same readiness errors as `capture`, then reads each `img` in the
  scene with computed opacity above 0, in DOM order, as text with `fetch(img.src)`. The
  sources are the component's own Blob URL (177) and `LayerSheet`'s (`LayerSheet.tsx:36-42`).
  The overlay comes from `serializeOverlay` (515-526), which resolves theme colours to values;
  set `font-family` on the overlay root from its computed style so note text keeps a sans font.
  `area` is `physical` for the whole drawing or `visibleArea(...)` for the visible one. Calls
  `composeSvg` with `background: LIGHT_CANVAS` (see Theme).

### Theme

Per the recommendation in PRODUCT.md, SVG keeps KiCad's and tscircuit's colours and uses the
light canvas colour, whatever the theme. If Kyle picks "match the screen", `exportSvg` passes
the current `--pcb-canvas` and, for a dark-theme schematic, wraps layers in a
`<filter id="theme">` built from the Filter Effects equivalents of `invert(0.88)` and
`hue-rotate(180deg)`, the filter used on screen (`workspace.module.css:588-589`). That change is
about ten lines in `composeSvg` and one input field.

### `WorkspaceChrome.tsx` `CaptureMenu` (143-197)

- Props: add `canCopy: boolean`, `pngScale: 1 | 2`, `onPngScale(scale)`, and
  `onExport(full: boolean, action: "copy" | "png" | "svg")`.
- Always render the chevron menu. In 2D, after "Attach to draft", add groups "Copy image" and
  "Save PNG" (`CopyIcon`, `DownloadIcon`) and "Save SVG" (`FileCodeIcon`), each with "Visible
  area" and "Whole drawing", then a "PNG size" `MenuRadioGroup` with "1x (as on screen)" and
  "2x" (`~/components/ui/menu` exports it, `menu.tsx:341-345`). In 3D, the menu holds "Attach to
  draft: 3D view", "Copy image" and "Save PNG". Copy items take `disabled={!canCopy}`. Do not
  reorder existing items.

### `preferences.ts`

Add `pngScale: Schema.Literals([1, 2]).pipe(Schema.withDecodingDefault(() => 2))` to
`Preferences` and `pngScale: 2` to `defaults`, plus a `setPngScale` action. Saved preferences
without the field still decode; today a decode failure resets every preference (`load`), which
the default avoids.

### `PcbPreviewPanel.tsx`

- `exportCapture(full, action)` beside `capture` (320-361), sharing `captureBusy`:

  ```ts
  if (captureBusy) return;
  setCaptureBusy(true);
  setNotice(null);
  const name = captureFileName(stem, label, new Date(), action === "svg" ? "svg" : "png");
  // No await before copyImage: it must start inside the click.
  const task =
    action === "svg"
      ? drawing.exportSvg(full).then((t) => saveImage(new Blob([t], { type: SVG }), name))
      : (() => {
          const png = three ? { image: board3d.capture() } : drawing.exportPng(full, scale);
          if (action === "copy") return copyImage(png.image);
          return png.image.then((b) => saveImage(b, name));
        })();
  ```

  On success: "Image copied." or "Download started." (with the reduced-size sentence when
  `reduced`). On failure: "Image could not be copied", "PNG could not be saved" or "SVG could
  not be saved", then the error message. `finally` clears `captureBusy`. Readiness errors
  (no handle, no display) are thrown synchronously and reported the same way.

- Pass `canCopy={canCopyImages()}`, `pngScale`, `onPngScale` and `onExport` to `CaptureMenu`
  (1076-1081).
- Editor handler `case "capture"` (537-543):

  ```ts
  if (c.format === "svg") {
    if (three) throw new Error("SVG captures are available for the schematic and board.");
    if (c.attachToDraft) throw new Error("Attach to draft takes PNG captures.");
    svg = await drawing().exportSvg(c.full ?? false);
    break;
  }
  const blob = three
    ? await model().capture()
    : c.scale
      ? await drawing().exportPng(c.full ?? false, c.scale).image
      : await drawing().capture(c.full ?? false);
  ```

  and send `...(svg ? { svg } : {})` with the completion (574-584).

### `docs/fork/user/pcb-preview.md`

Extend the Capture sentence (line 47): Capture can also copy the image or save it as PNG or
SVG; copying needs a secure connection (desktop, localhost or HTTPS).

## Agent-facing tools

Extend, do not add: `loom_pcb_editor` with `{ "action": "capture", "format": "svg" }` or
`"scale": 2`, and `t3 pcb editor` through the existing pass-through. Agents cannot use the
user's clipboard or Downloads folder, so copy and save stay user actions; the files they need
already come back as host paths.

## Performance

Everything runs on click; nothing repaints while idle. PNG export draws the same images as
attach, at most 16.8 million pixels. SVG export fetches Blob URLs already in memory and parses
each visible layer once (each at most 4 MiB). An agent SVG crosses the WebSocket once, capped at
8 MiB, the same order as the existing 12 MiB PNG field. Object URLs are revoked after 30 seconds
(L44's `saveImage`).

## Alternatives considered

- Layers as `<image href="data:image/svg+xml;base64,…">`: isolates styles and ids for free,
  but editors treat them as opaque pictures. Nested `<svg>` keeps them editable.
- Rendering SVG on the server from the cached sheets: needs a new route and the client's layer
  state; the client already has every byte and the state.
- A signed upload route for agent SVGs: PNG captures already use the completion RPC; adding a
  route for one more capped field is machinery without a need.
- Changing the 3D capture size: the renderer is shared with the model panel (`createViewer.ts:
572-627`); a size option belongs with L44 or a later 3D packet.
- `showSaveFilePicker`: Chromium only; a download matches upstream's "Save image".
