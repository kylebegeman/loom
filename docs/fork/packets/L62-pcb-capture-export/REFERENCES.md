# L62 references

## Old Loom

No matching selection in [selections.md](../../selections.md); this is a 2026-10-10 follow-up
to L24. Old Loom 0.13.10 had no PCB export.

## Prior art in the repo

- L44's design for 3D export: [L44 TECHNICAL.md](../L44-model-capture-export/TECHNICAL.md).
  L62 reuses its helper, wording and secure-context behaviour.
- Upstream image copy and save on chat media: `apps/web/src/components/media/MediaActions.tsx:
97-111` and `apps/web/src/components/media/mediaContent.ts:29-39`, the pattern L44 follows.
- PCB capture today: `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx:320-361` (attach),
  `537-543` (editor), `SvgViewport.tsx:251-301` (canvas render), `515-526` (overlay
  serialization), `Board3D.tsx:143` and `apps/web/src/fork/model-preview-3d/viewer/
createViewer.ts:572-627` (3D, 1200 px wide).
- Drawings arrive as SVG text over RPC (`packages/contracts/src/fork/pcb-preview.ts:130-133`),
  each sheet capped at 4 MiB (`apps/server/src/fork/pcb-preview/cache.ts:4`) and cropped to one
  physical millimetre frame (`apps/server/src/fork/pcb-preview/svg.ts:6-13`); tscircuit output
  is normalized to millimetres (`svg.ts:16-70`).
- Host capture files and pruning: `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:
2344-2389`.
- Desktop: app schemes are secure (`apps/desktop/src/electron/ElectronProtocol.ts:118-142`) and
  `connect-src` allows `blob:` (`ElectronProtocol.ts:88`), so `fetch` of a Blob URL works there.

## Facts

- `Clipboard.write()` needs a secure context and accepts a `ClipboardItem` whose value is a
  promise; `ClipboardItem.supports()` reports writable types. Verified (via L44):
  [MDN, Clipboard.write](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write),
  [MDN, ClipboardItem](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem/ClipboardItem),
  [MDN, ClipboardItem.supports](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem/supports_static).
- Electron without `setSavePath` "usually prompts a save dialog". Verified (via L44):
  [Electron DownloadItem](https://www.electronjs.org/docs/latest/api/download-item).
- `CanvasRenderingContext2D.filter` is not supported in Safari by default (behind a flag in
  recent versions). Verified:
  [MDN, CanvasRenderingContext2D.filter](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/filter),
  [caniuse](https://caniuse.com/mdn-api_canvasrenderingcontext2d_filter),
  [WebKit bug 198416](https://bugs.webkit.org/show_bug.cgi?id=198416). Whether the property is
  `undefined` (the detection L62 uses) when unsupported is not verified; the manual Safari check
  covers it.
- Safari limits a canvas to 16,777,216 pixels (4096 squared). Reported, not from Apple:
  [PQINA, canvas area exceeds the maximum limit](https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/).
  One later post reports iOS 18 raising it to 67,108,864; unverified:
  [lionpuro](https://lionpuro.com/posts/canvas-is-finally-usable-on-safari/). L62 keeps the
  lower number. The 8,192-pixel side cap is a Loom choice, not a browser limit.
- CSS `invert()` and `hue-rotate()` have defined SVG filter equivalents (Filter Effects Level 1,
  sections 13.1.4 and 13.1.5). Section anchors verified, markup not quoted in this pass:
  [Filter Effects, invert equivalent](https://www.w3.org/TR/filter-effects-1/#invertEquivalent),
  [hue-rotate equivalent](https://www.w3.org/TR/filter-effects-1/#huerotateEquivalent).
- Not verified here: whether kicad-cli SVG uses inline `style` attributes or `<style>` blocks,
  and whether it emits ids. No SVG fixtures are in the repo
  (`apps/server/src/fork/pcb-preview/fixtures/`) and kicad-cli is not installed on the machine
  that wrote this packet. The composer handles both.

## Licences

No third-party code is reused and no dependency is added. Exported files contain the user's own
KiCad or tscircuit output.
