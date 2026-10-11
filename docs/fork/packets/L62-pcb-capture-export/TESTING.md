# L62 testing

## Local results

Focused checks passed on 2026-10-10:

- `svgExport.test.ts`: 5 tests for physical crop, rounded PNG limits, opacity/order, scoped
  ids/styles, active/external content removal and the 32 MiB cap.
- `workspace.interactions.test.tsx`: 8 tests, including visible-layer/overlay SVG export,
  hidden loading-layer omission, physical crop, legacy PNG sizing and bounded explicit export.
  The shared ResizeObserver fixture now supplies real target entries. The SVG case reproduced
  and verifies the duplicate namespace fix.
- `captureExport.test.ts`: 6 tests, including SVG filenames, secure clipboard checks,
  synchronous clipboard initiation, rejection handling and download URL lifetime.
- `captureStore.test.ts`: 6 tests for old PNG compatibility, XML SVG roots, supplied-format
  conflicts, decoded/UTF-8 byte limits and combined PNG/SVG retention with newest-file protection.
- `mcp.test.ts`: 10 tests across its retained base cases, printing and capture forwarding;
  the new capture case forwards full SVG and 2× PNG options in the caller's thread.
- `PcbPreviewService.test.ts`: 31 focused service regressions passed, including the new
  inspection cache/height behavior, print wiring, signed PDF limits and canonical output
  directory exclusions. Capture persistence is tested directly through the shared store;
  the existing editor bridge tests cover request claiming and duplicate-completion rejection.

Strict scoped lint passed for the changed capture and integration files. Contracts,
client-runtime, server and web package typechecks passed after integration. No repo-wide
suite, browser, GPU, dev server, real CAD export or live clipboard/download check was run.
The PNG interaction test uses a stubbed canvas and does not establish rendered pixel quality.

Focused reproduction:

```sh
./node_modules/.bin/vp test run \
  apps/web/src/fork/model-preview-3d/captureExport.test.ts \
  apps/web/src/fork/pcb-preview/svgExport.test.ts \
  apps/web/src/fork/pcb-preview/workspace.interactions.test.tsx \
  apps/server/src/fork/pcb-preview/captureStore.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts
```

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
