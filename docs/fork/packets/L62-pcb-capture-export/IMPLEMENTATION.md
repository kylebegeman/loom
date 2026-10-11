# L62 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Commit with the slug, for
example `feat(fork-pcb-capture-export): save PCB drawings as SVG`.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, PCB-FOLLOW-UPS.md, L44's folder
and this folder. Check whether `apps/web/src/fork/model-preview-3d/captureExport.ts` exists.
Use a KiCad design with a schematic of two or more sheets and a board with several layers, and
a tscircuit design, for the manual pass. No dev data seeding is needed for the automated steps.

## Steps

1. Shared helper. If `captureExport.ts` is missing, create it and its test exactly as L44's
   TECHNICAL.md and TESTING.md describe, in its own commit. Then add the optional `extension`
   parameter to `captureFileName` with a test for `.svg`.
2. Pure export module. Add `apps/web/src/fork/pcb-preview/svgExport.ts` with `LIGHT_CANVAS`,
   the limits, `exportFactor`, `visibleArea` and `composeSvg` (sanitize, id prefix, style
   scoping, size cap), and `svgExport.test.ts`.
3. Viewport. In `SvgViewport.tsx`, extract `draw(full, factor)` from `capture`, add `exportPng`
   and `exportSvg` to `PcbViewportHandle`, export or reuse `serializeOverlay`, and apply the
   background (`--pcb-canvas`) and Safari filter fallbacks. `capture` keeps its factor.
4. Preference. Add `pngScale` with `Schema.withDecodingDefault(Effect.succeed(2))` and `setPngScale` in
   `preferences.ts`.
5. Menu. Extend `CaptureMenu` in `WorkspaceChrome.tsx`: always show the chevron, add the
   "Copy image", "Save PNG" and (2D only) "Save SVG" groups and the "PNG size" radio group.
6. Panel. Add `exportCapture` to `PcbPreviewPanel.tsx`, the file name label (surface plus sheet
   for multi-sheet schematics), the success and failure notices, and the new menu props.
7. Contracts. Add `format` and `scale` to `PcbEditorAction` and `svg` to
   `PcbCompleteEditorInput` in `packages/contracts/src/fork/pcb-workspace.ts`.
8. Server. Create `captureStore.ts` with PNG/SVG validation and serialized shared
   retention, then call its `saveCapture` from `PcbPreviewService.ts`; reject both supplied
   formats at once. Update the `loom_pcb_editor` description in `mcp.ts`. Add the service test.
9. Editor command. Handle `format` and `scale` in the panel's `case "capture"` and send `svg`
   with the completion.
10. Documentation. One sentence in `docs/fork/user/pcb-preview.md` (Capture can copy or save
    PNG and SVG; copy needs a secure connection). Set the packet's Status in
    `docs/fork/packets/README.md` and PCB-FOLLOW-UPS.md if those tables carry one.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Every Capture menu action works in 2D and 3D on desktop and in a browser on localhost, and
  copy is disabled over plain HTTP by IP while save works.
- A saved SVG opens in a browser and in Inkscape with the visible layers at their opacity, the
  pinned marks in place, and a width and height in millimetres that match the drawing.
- Attached and exported PNGs have the canvas background, not transparency.
- `loom_pcb_editor` with `format: "svg"` returns a `.svg` host path; with `scale: 2` a larger
  PNG; with neither, the same PNG as before.
