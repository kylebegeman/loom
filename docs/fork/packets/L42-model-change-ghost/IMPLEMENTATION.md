# L42 implementation

Base: `feat/model-bed-picker` (or `main` once it merges). Commit after each step with
`feat(fork-model-change-ghost): ...`. Paths are relative to
`apps/web/src/fork/model-preview-3d/` unless written in full.

## 1. Ghost

1. If `viewer/ghost.ts` does not exist, create it as in TECHNICAL.md, "Ghost". If L49 created it,
   add only the missing methods without changing `set` or `dispose`.
2. Add `viewer/ghost.test.ts` (see TESTING.md).

## 2. Viewer retention

1. In `viewer/createViewer.ts`, add the `ghosts` group beside `helpers` (line 327), remember the
   current model's triangle count from `meshStats` in `setModel`, and add
   `GHOST_TRIANGLE_LIMIT = 1_000_000` (export it from `ghost.ts` so the panel can word its note).
2. Replace the dispose in `setModel` (lines 521-524) with the retention branch, guarded by
   `keep`. With `keep` false the code path is identical to today.
3. Call the ghost from `applySection` (line 97) and `theme` (line 379); dispose in `dispose`
   (line 628).
4. Add `keepPrevious`, `showPrevious`, `clearPrevious` and `hasPrevious` to the returned object.
5. Extend `viewer/createViewer.test.ts`.

## 3. Contracts and server text

1. Add `previous` to `ModelEditorAction` and `ModelEditorState` in
   `packages/contracts/src/fork/model-editor.ts`.
2. Extend the editor tool description in `apps/server/src/fork/model-preview-3d/mcp.ts:16`.

## 4. Panel

1. `viewer/ViewerCanvas.tsx`: `keepPrevious` and `previousShown` props; pass
   `keepPrevious` and `previousShown` from `ModelPanel.tsx` (line 845). Do not pass them from
   `VariantsInspector.tsx`.
2. `ModelPanel.tsx`: `previous`, `previousShown`, `changed` state and the `reloadCause` ref;
   set the ref at line 461; the comparison in `onStats` (line 485); `togglePrevious`; the `d`
   key line next to line 763; reset `changed` to `null` when a new reload starts without a file
   change.
3. `WorkspaceTools.tsx`: `PreviousChip`; the `previous` prop and checkbox in `DisplayTools`
   (line 147); the `HELP` row (line 197). Add `.model-change-chip` to `workspace.module.css`
   next to `.model-hint` (line 700), with no transitions.
4. `ModelInspector.tsx`: `previousSize` on `PartSection` (line 336) with `DIMENSION_DELTA_MM`;
   pass it at `ModelPanel.tsx:1122`. Put the delta formatter in a small pure helper
   `dimensionDelta(current, previous)` in `ModelInspector.tsx` (or `units.ts` if L40 landed).
5. `actions.ts` and `palette.tsx`: `"toggle-previous"`; handle it in the listener at
   `ModelPanel.tsx:653`.
6. Editor `display` case (line 216) and `snapshot` state (line 392).

## 5. Docs

Add a short paragraph to `docs/fork/user/model-preview-3d.md` under live reload: the chip, `D`,
what the ghost shows, and that only the last version is kept.

## Done when

- Editing a SCAD file in another tool reloads the part and shows "Changed. Show previous (D)";
  `D` shows a grey translucent ghost of the old shape aligned with the new one; `D` hides it.
- Removed material is visible as ghost outside the part; added material is solid part.
- Part shows "X +2.0 mm" after widening the part by 2 mm, and no delta on unchanged axes.
- Applying a customizer parameter keeps a previous version without a chip; `D` compares.
- A cached re-render with the same mesh revision keeps no previous; the menu item is disabled.
- With a section plane on, the ghost is cut at the same plane.
- Captures include the ghost while shown and not otherwise.
- Closing the tab, or hiding the panel for over a minute, releases the previous mesh.
- A 1.5M triangle model never keeps a previous version and the menu says why.
- Variants thumbnails, the comparison view and the PCB 3D board behave as before.
- `loom_model_preview_3d_editor` `display` with `previous: true` shows the ghost, fails clearly
  with no previous, and `snapshot` returns `state.previous`.
