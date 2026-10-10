# L32 references

## Old Loom

No old Loom equivalent. The bed picker and fit card come from L23 and commit `8676e099e5`.

## Loom source this packet builds on

- `packages/contracts/src/fork/model-preview-3d.ts:141-238`: bed presets and setting.
- `apps/web/src/fork/model-preview-3d/buildPlate.ts:9-52`: bed helpers and `fitsBuildVolume`.
- `apps/web/src/fork/model-preview-3d/ModelInspector.tsx:335-423`: Part, fit card, rotated
  advice, printer menu.
- `apps/web/src/fork/model-preview-3d/BedPicker.tsx:44-69`: `useBuildPlate` optimistic save.
- `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:1104-1260`: `renderImages`.
- `apps/server/src/fork/model-preview-3d/mcp.ts:181-200`: the render tool.
- `apps/server/src/fork/model-preview-3d/openscad.ts:96-109`: summary bounding box.
- `packages/contracts/src/fork/model-editor.ts:65-82`: editor state.

## External

- Slicer behaviour: Bambu Studio and OrcaSlicer flag objects outside the plate and auto-arrange
  rotates in steps when enabled; this packet's 90 degree check mirrors the common manual fix.
  Not verified against a specific slicer setting; treat as background.
- Rectangle in a rectangle at any angle: the condition quoted in TECHNICAL.md is Carver's
  (1956), as stated in Wikipedia's "Packing problems" article and discussed in John E. Wetzel,
  "Rectangles in Rectangles", Mathematics Magazine 73(3), 2000, doi:10.2307/2691523
  (https://doi.org/10.2307/2691523). **Not verified** against the paper: I could not open it,
  and the formula was confirmed only from a secondary summary. Verify before implementing the
  diagonal option. The equivalent form given by Wetzel for the tilted case is
  `((a + b) / (p + q))^2 + ((a - b) / (p - q))^2 >= 2` (also unverified).
- No code or assets are reused, so no licence applies.
