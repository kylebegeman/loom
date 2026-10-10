# L36 implementation

Start from the bed picker base named in
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md) (`8676e099e5` or `main` once it merges).
Each step leaves the tree compiling and its tests passing. Commit per step with the
`fork-model-overhangs` scope. Steps 6 and 7 wait for Kyle's answer on the render tool (PRODUCT.md);
steps 1 to 5 do not depend on it.

1. **Pure helper.** Create `packages/contracts/src/fork/model-overhangs.ts` with
   `OVERHANG_ANGLE`, `BED_BAND_MM`, `OverhangRegion`, `OverhangStats` and `overhangStats`, and
   export it from `packages/contracts/src/fork/index.ts`. Write its tests first.
2. **Contracts.** `overhangAngleDegrees` with its decoding default in `ModelPreviewSettings`
   (`model-preview-3d.ts:240-262`) and `DEFAULT_MODEL_PREVIEW_SETTINGS`
   (`model-preview-3d.ts:297-306`); `ModelCamera.overhangs` with its decoding default
   (`model-workspace.ts:11-21`); `ModelEditorAction.overhangs` (`model-editor.ts:48`, after
   `wireframe`). Fix object literals the typecheck flags (camera snapshots in tests, defaults).
3. **Shader patch.** Create `viewer/overhangs.ts` with `createOverhangShading`. Unit test the
   string patching and uniform sharing without WebGL (TESTING.md).
4. **Viewer.** In `createViewer.ts`, create the shading instance, patch materials in `setModel`
   (`createViewer.ts:513-534`), set `bedZ` from `box.min.z` there (and in L35's `setOrientation`
   if present), set colours in the theme callback (`createViewer.ts:379-385`), add
   `setOverhangs`, `setOverhangAngle`, `overhangInput`, and carry `overhangs` through `snapshot`
   and `restore` (`createViewer.ts:441-512`).
5. **Panel.** `display.overhangs` in `ModelPanel.tsx:134` and its recall at
   `ModelPanel.tsx:142`; the `V` line in the key handler (`ModelPanel.tsx:748-765`); the display
   menu item and `HELP` row in `WorkspaceTools.tsx:147-207`; `OverhangLegend` with the slider
   popover and the idle-time stats pass; the palette toggle in `actions.ts` and `palette.tsx`;
   the editor `display` case (`ModelPanel.tsx:216-224`). Hide the slider unless the server
   advertises `model-overhangs` (pattern at `Shortcuts.tsx:20`).
6. **Server stats.** Append `"model-overhangs"` to `LOOM_SERVER_FEATURES`
   (`apps/server/src/fork/features.ts:2`). Add `overhangMesh.ts` with `parseBinaryStl`. Add or
   reuse `meshArgs` in `openscad.ts`. In `renderImages` (`ModelPreviewService.ts:1104-1254`),
   export the mesh, compute `overhangStats` with the orientation's `up` when L35 is present, and
   return it.
7. **Render tool.** `overhangs` and `overhangAngle` parameters, the `overhangs` result and the
   description in `mcp.ts:181-227`.
8. **User guide.** In "Explore and review a design" of `docs/fork/user/model-preview-3d.md`, add
   a short paragraph: **V** shades overhangs, the chip sets the angle from vertical (45° default;
   slicers that measure from horizontal use 90° minus this), faces on the bed are not shaded,
   and agents can request overhang statistics from the render tool.

## Done when

- `V` on a mushroom-shaped test part shades the underside of the cap and not its stem or its
  base on the bed; the display menu and chip agree with the key.
- Dragging the slider from 30° to 70° changes the shaded area live with no visible hitch, and
  the value survives a reload; settings saved before the packet load as 45°.
- A cube shows "No overhangs over 45°".
- The shading is readable in both themes and in a greyscale screenshot (the hatch).
- A saved view with overhangs on turns them back on when recalled; a capture includes them.
- With L35, laying the part flat changes the shading without toggling anything.
- An agent can turn the mode on with the editor command and get statistics from
  `loom_model_preview_3d_render` with `overhangs: true`, with region centres in file coordinates.
- No frame renders while idle with the mode on.
- Focused tests, lint and the four typechecks in TESTING.md pass.
