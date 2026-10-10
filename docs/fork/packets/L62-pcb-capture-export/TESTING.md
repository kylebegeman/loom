# L62 testing

Focused tests only, no sleeps, no repo-wide checks.

## Automated tests

| File                                                                                                    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/model-preview-3d/captureExport.test.ts`                                              | L44's cases (created here if L44 has not landed), plus `extension: "svg"` and the default staying `.png`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/src/fork/pcb-preview/svgExport.test.ts` (new, `// @vitest-environment jsdom` for `DOMParser`) | `exportFactor`: unchanged under the limits; reduced to fit 16,777,216 pixels and 8,192 per side, with `reduced: true`. `visibleArea`: identity view maps the viewport to the frame; zoomed and panned views map to the expected millimetre box; clipped to the frame. `composeSvg`: root `width`/`height` in mm and `viewBox` equal to the area; opacity-0 layers skipped; layer order kept; `<script>`, `foreignObject`, `onload` and external `href` removed; duplicate ids in two layers become distinct and their `url(#…)` references follow; a `<style>` rule in one layer is scoped to that layer; the title is escaped; over 32 MiB throws the "Save a PNG instead" error. |
| `apps/web/src/fork/pcb-preview/workspace.interactions.test.tsx`                                         | Extend the existing jsdom harness (it already stubs Blob URLs and simulates image loads, lines 222-237). `exportSvg`: refuses before the drawing and visible layers decode, like `capture`; afterwards, with `fetch` stubbed per Blob URL, returns one document with the visible layers in DOM order at their opacity, the overlay last, and a hidden layer left out. `exportPng`: refuses before decode with the same messages.                                                                                                                                                                                                                                                   |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts`                                            | `completeEditorAction` with `svg` writes `<uuid>.svg` and returns its path; rejects non-SVG text, over-limit text, and `png` plus `svg` together; pruning counts `.png` and `.svg` together and keeps the new file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/fork/pcb-preview/mcp.test.ts`                                                          | `loom_pcb_editor` accepts `format` and `scale` and forwards them in the editor event (extend the existing capture case at line 187).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

jsdom has no canvas, so PNG pixels, the background fix and the Safari fallback are covered by
the manual check. Starting the clipboard write inside the click is covered by L44's
`copyImage` test; the panel only has to call it before any `await`, which review checks.

## Commands

```sh
vp test run apps/web/src/fork/model-preview-3d/captureExport.test.ts \
  apps/web/src/fork/pcb-preview/svgExport.test.ts \
  apps/web/src/fork/pcb-preview/workspace.interactions.test.tsx \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts
vp lint apps/web/src/fork/pcb-preview apps/web/src/fork/model-preview-3d/captureExport.ts \
  apps/server/src/fork/pcb-preview packages/contracts/src/fork/pcb-workspace.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/client-runtime typecheck
```

The contract change is additive and optional, but CONVENTIONS.md asks for every importing
package to be typechecked, hence the server and client-runtime lines.

## Manual check

With a KiCad design (multi-sheet schematic, board with copper, silkscreen and edge layers, one
layer at 50 percent opacity, one hidden, a pinned measurement and a note) and a tscircuit design:

1. Desktop app: every Capture menu action on the schematic, the board and 3D. Paste copies into
   Preview (File, New from Clipboard). Each save opens a Save dialog with the expected name;
   cancel one and confirm nothing breaks.
2. Open each SVG in a browser and in Inkscape: hidden layer absent, half-opacity layer faded,
   marks in place, document size in millimetres matches the board outline, nothing loads from
   the network.
3. PNG at 1x and 2x for visible area and whole drawing: sizes double; zoom in and save the
   whole drawing on a large schematic to see the reduced-size notice.
4. Dark theme: the schematic PNG matches the screen in Chrome; in Safari it uses the light
   canvas colour. Attach a capture and confirm it has a background, not transparency.
5. A browser over plain HTTP by LAN or tailnet IP: copy items disabled, saves work. Over
   `vp run dev --share` or T3 Connect: copy works.
6. Agent: `t3 pcb editor '{"designId":"…","command":{"action":"capture","format":"svg"}}'`
   returns a `.svg` path; `"scale":2` returns a larger PNG; no options returns today's PNG.

## Merge safety

No upstream files. Run the merge preview from CONVENTIONS.md against the newest nightly before
merging, and `scripts/fork/loom.sh check` after.
