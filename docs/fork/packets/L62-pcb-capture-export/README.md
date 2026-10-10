# L62: Copy and save PCB captures

Status: Ready to build

Approved by Kyle on 2026-10-10.

Captures can leave Loom. Next to "Attach to draft", the PCB Capture menu offers "Copy image",
"Save PNG" and, on the schematic and board, "Save SVG", each for the visible area or the whole
drawing. The 3D view gets "Copy image" and "Save PNG". PNGs show what is on screen, including
layer visibility, opacity and theme, at 1x or 2x. SVGs keep the drawing as vectors at true
millimetre scale, with the same layers and pinned marks, and open on their own in a browser,
Inkscape or a document. Files are named after the design, the surface and the time, such as
`power-board-20261010-1432.svg`. Agents can ask the editor for an SVG or a 2x PNG and get a host
file path back, as they already do for PNGs.

## Scope

- In:
  - Capture menu groups "Copy image", "Save PNG" and "Save SVG" (2D only), each with "Visible
    area" and "Whole drawing". In 3D: "Copy image" and "Save PNG" for the 3D view.
  - A "PNG size" choice, 1x or 2x, remembered on this device.
  - SVG export of the visible area or whole drawing: visible layers with their opacity, pinned
    measurements, notes, selection and net highlights, KiCad's own colours, no external
    references, capped at 32 MiB.
  - File names `<design>-<surface>-<yyyymmdd-hhmm>.<ext>`, local time.
  - Insecure-origin fallback from L44: copy disabled, save available.
  - Fix the capture background so PNGs (attached or exported) are not transparent, and a light
    fallback where the browser cannot apply the dark schematic filter (Safari).
  - Editor command `capture` gains optional `format` (`png`, `svg`) and `scale` (1, 2). SVG
    captures are written beside PNG captures on the host.
- Out:
  - Larger 3D images or 3D scale options (the 3D renderer is shared with the model panel).
  - PDF, JPEG or Gerber-style exports (fabrication outputs belong to L65).
  - Copying SVG text to the clipboard.
  - Saving into the project folder.
  - Palette entries (the PCB palette has only its toggle).
  - Mobile (no PCB panel).

## Surfaces

Web and desktop. Mobile has no PCB panel. Remote: drawings are already in the client as SVG
text from `loom.pcb-preview.readSheet`, and the 3D board as a GLB from the signed file route, so
user exports send nothing over the network. Agent SVG captures travel on the existing editor
completion RPC, like agent PNG captures today. Clipboard availability depends on a secure
context; see [PRODUCT.md](./PRODUCT.md).

## Extension points used

L24's existing ones: the PCB panel (`ext-panels`), the `pcb-preview` capability, the
`loom_pcb_*` MCP registration and `t3 pcb` pass-through (`apps/server/src/fork/pcb-preview/cli.ts`).
Creates none.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L44 (3D capture export): defines `captureExport.ts`, which L62 reuses. L62 adds one optional
  `extension` parameter to `captureFileName`. If L44 has not landed, L62 creates the file
  exactly as L44 specifies, plus that parameter.
- L63 (PCB accessibility): "Image copied." and "Download started." go through the panel notice,
  which L63 announces. Without L63 the visible message is the same.
- L52, L60, L69 (overlays): anything drawn inside the drawing's overlay `<svg data-overlays>` is
  in both PNG and SVG exports with no extra work. Overlays drawn outside it are not.
- L54 (units): exports stay in millimetres, the drawing's own coordinates; nothing to change.
- L61 (3D projection): 3D exports follow whatever projection the viewer shows.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
