# L31 implementation

Branch from `main` (or `feat/model-bed-picker` until it merges). Commits use
`feat(fork-model-ortho-camera): ...`. Each step compiles and its tests pass.

1. **Contract.** In `packages/contracts/src/fork/model-workspace.ts` add `ModelProjection` and
   `ModelCamera.projection` with `withDecodingDefault(Effect.succeed("perspective" as const))`.
   Add `projection: Schema.optional(ModelProjection)` to `ModelEditorAction` in
   `model-editor.ts`. Add `projection: "perspective"` to the `ModelCamera` fixtures in
   `apps/server/src/fork/model-preview-3d/workspace.test.ts`,
   `apps/web/src/fork/model-preview-3d/viewer/captureSheet.test.ts` and
   `viewer/ViewerCanvas.test.tsx`. Add a contracts test that an encoded camera without the key
   decodes to perspective.
2. **Pure helpers.** Create `viewer/projection.ts` with `MARKER_SCALE`, `markerScale` and
   `syncOrthographic`. Add `viewer/projection.test.ts`.
3. **Viewer.** In `viewer/createViewer.ts` add `ortho`, `projection`, cached `sceneRadius`
   (computed in `setModel` and `setBed`), `activeCamera()` and `setProjection`. Switch `pick`,
   `placeMarks`, `paintMarks`, `render` and the capture loop to `activeCamera()`. Use
   `markerScale` where dots are created and in `setProjection`. Extend `snapshot` and `restore`.
   In `capture(four)`, force orthographic for the four-view loop and restore it in `finally`.
4. **Canvas and panel.** Thread `projection` through `ViewerCanvas` `display`, `ModelPanel`
   `display` state, `recall`, the editor `display` case and the `P` key. Add the "Orthographic"
   checkbox and help row in `WorkspaceTools.tsx`. Optionally add the "Orthographic" row detail
   in `ViewsSection.tsx`.
5. **Render tool.** Add `projection` to `pngArgs` (`openscad.ts`), `renderImages`
   (`ModelPreviewService.ts`), the tool parameters and `renderModelTool` (`mcp.ts`), with
   `DEFAULT_RENDER_PROJECTION`. Update `openscad.test.ts`, `ModelPreviewService.test.ts` and
   `mcp.test.ts` call sites.
6. **Docs.** In `docs/fork/user/model-preview-3d.md`, add `P` to the shortcuts paragraph and one
   sentence to the capture section: "The four-view sheet is always orthographic." Mention the
   render tool's `projection` where agent tools are described.

## Done when

- `P` and the Display menu toggle projection with no visible jump in framing.
- Orbit, pan, scroll and `+`/`-` zoom, `F`, `1` to `4`, measure and annotate picking, section
  and measurement dots all work in orthographic.
- A view saved in orthographic recalls in orthographic; views saved before L31 recall in
  perspective.
- The four-view sheet is orthographic from either projection, and the on-screen projection is
  unchanged afterwards.
- `loom_model_preview_3d_editor` `display` with `projection` switches the panel, and `snapshot`
  reports it.
- `loom_model_preview_3d_render` returns orthographic PNGs by default and perspective on request.
- No continuous rendering: an idle viewport draws no frames.
