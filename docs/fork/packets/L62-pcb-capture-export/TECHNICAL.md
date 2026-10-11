# L62 technical

## Clients

`WorkspaceChrome.tsx` keeps Attach to draft and adds Copy image, Save PNG and, for 2D,
Save SVG. The menu is available in 3D, where it offers the current view without PNG size
controls. Copy uses L44's secure-context check; local downloads use the same shared helper.

`PcbPreviewPanel.tsx` shares capture busy/error notices between attach, export and agent
captures. `copyImage` is invoked before any rendering await, preserving the user gesture.
Names include the design, surface, a sheet label for multi-sheet schematics and local time.
The remembered `pngScale` defaults to 2 through the installed Effect decoding API.

`SvgViewport.tsx` exposes `exportPng(full, scale)` and `exportSvg(full)`. Both require the
base drawing and every visible layer to have decoded. PNG uses the existing renderer,
with the inherited `--pcb-canvas` background; an unavailable canvas filter uses a light
background for an unfiltered schematic. Legacy `capture(full)` retains its 2400 pixel
sizing policy. Explicit PNG export scales the viewport, or the whole drawing at its current
zoom, and reports dimensions and whether the browser limits reduced its size.

`svgExport.ts` caps PNG exports at 16,777,216 pixels and 8192 per side, including rounded
canvas dimensions. It maps the visible viewport through pan and zoom into clipped physical
coordinates. SVG nests the visible layer documents in DOM order, retains opacity and places
the serialized overlay last. Each document keeps its frame; the outer document has physical
millimetre dimensions. Overlay serialization resolves theme colours and font family and
removes the redundant namespace attribute before XML serialization.

SVG uses original CAD colours on a light background. Each layer's ids, references and flat
CSS selectors are scoped. Scripts, foreign objects, event attributes, external links,
external CSS URLs and imports are removed; local fragments and image data URLs remain.
Invalid geometry or exports above 32 MiB fail with a useful error. This CSS handling is
intended for the flat rule lists emitted by the CAD tools, not arbitrary CSS documents.

## Agent and host flow

The optional editor `capture` fields are `format: "png" | "svg"` and `scale: 1 | 2`.
Omitting both preserves the existing PNG behaviour. SVG rejects 3D and draft-image attachment.
The completion RPC adds optional SVG text; PNG still uses base64. Older payloads decode.
MCP and `t3 pcb editor` reach the same editor bridge and return the host capture path.

`captureStore.ts` captures FileSystem and Path when the service is built. Its semaphore
serializes saving and pruning. `PcbPreviewService.completeEditorAction` delegates to it only
for successful completions, after the editor bridge claims the request. Validation rejects
both supplied formats, even empty values; requires the existing PNG signature or an SVG
root, and limits decoded PNG or UTF-8 SVG bytes to 8 MiB. The SVG contract also caps string
length, so the server's byte check handles multibyte text.

PNG and SVG share `<stateDir>/fork/pcb-preview/captures/`, UUID filenames, 50 files and
50 MiB of retained output. The newest capture is protected while pruning. This helper is
separate from the large service to test the shared storage boundary directly.

## Compatibility and surfaces

No new dependency, database or upstream seam. Web and desktop share the UI; mobile has no
PCB panel. Downloads use client-held geometry, and agent captures use the existing scoped
completion path. Clipboard availability follows the client's origin. The additive fields
retain older PNG calls; an older server can discard new fields and return its older result.
