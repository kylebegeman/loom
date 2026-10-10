# L39 implementation

Base: `feat/model-bed-picker` (or `main` once it merges). Commit after each step with
`feat(fork-model-scale-references): ...`. Paths are relative to
`apps/web/src/fork/model-preview-3d/` unless written in full.

## 1. Contracts

1. Create `packages/contracts/src/fork/model-scale.ts` with `ScaleReference` and export it from
   `packages/contracts/src/fork/index.ts`.
2. Add `scaleReference` with its decoding default to `ModelPreviewSettings` and to
   `DEFAULT_MODEL_PREVIEW_SETTINGS` in `packages/contracts/src/fork/model-preview-3d.ts`.
3. Add `reference: Schema.optional(ScaleReference)` to `ModelEditorAction` in
   `packages/contracts/src/fork/model-editor.ts`.
4. Fix any settings literal the typecheckers flag (server tests and web fixtures).
5. Add a decode test: settings JSON without `scaleReference` decodes to `"none"`.

## 2. Geometry

1. Create `viewer/references.ts` with `REFERENCE_GAP_MM`, `REFERENCE_SPECS`, `createReference`
   and `placeReference` as in TECHNICAL.md. Author the hand outline as a constant array of
   `[x, y]` pairs in a unit box and scale it to 190 mm long; keep it under 50 points.
2. Create `viewer/references.test.ts` (see TESTING.md).

## 3. Viewer

1. In `viewer/createViewer.ts`, add the reference state, `placeReferenceObject()` called from
   `placeBed()` (line 433), `setReference(kind)` on the returned object, and disposal in
   `dispose()` (line 628).
2. In `viewer/ViewerCanvas.tsx`, add the optional `reference` prop, an effect calling
   `setReference`, and apply it after load beside the display options (line 126).

## 4. Panel and settings

1. In `BedPicker.tsx`, add `useScaleReference` next to `useBuildPlate` (line 44) and append the
   "Show for scale" `Select` inside the fieldset after the pattern control (line 173).
2. In `SettingsSection.tsx`, add the "Show for scale" row after "Bed pattern" (line 245).
3. In `ModelPanel.tsx`, pass `reference={settings.scaleReference}` to `ViewerCanvas` (line 845)
   and handle `c.reference` in the `display` editor case (line 216). Keep the `loadKey` list at
   line 449 unchanged.
4. Extend the editor tool description in `apps/server/src/fork/model-preview-3d/mcp.ts:16`.

## 5. Docs

Add two sentences to `docs/fork/user/model-preview-3d.md` near the bed section: where to find
"Show for scale", that it appears in captures and is never part of the model.

## Done when

- Choosing "1 euro coin" in the Bed menu shows a 23.25 mm grey disc 10 mm to the right of the
  part, on the bed plane, and the choice survives a reload of the app.
- The same value shows in Settings and in `loom_model_preview_3d_settings`.
- Measure, Annotate, `F`, standard views, the status bar dimensions and the Part fit card ignore
  the reference.
- Reloading a larger version of the part moves the reference so it still clears the part.
- Single, four-view and named-view captures include the reference when it is in frame.
- `loom_model_preview_3d_editor` with `{ action: "display", reference: "hand" }` shows the hand;
  `"none"` removes it; on a connection without settings permission the call fails clearly.
- The variants thumbnail, variants comparison and PCB board viewers never show a reference.
- Older saved settings load with no reference.
