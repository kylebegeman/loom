# L49 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling and its tests passing.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, MODEL-3D-FOLLOW-UPS.md, this
folder, and L41's and L42's TECHNICAL.md (shared files). Start from `main` once
`feat/model-bed-picker` has merged, otherwise from that branch (`8676e099e5`). Check which
shared files exist:

- `apps/server/src/fork/model-preview-3d/scadIncludes.ts` and `formats.ts` (L41): if present,
  use them as written and skip their creation in step 3.
- `apps/web/src/fork/model-preview-3d/viewer/ghost.ts` and the viewer's `ghosts` group (L42): if
  present, skip their creation in step 11.
- `apps/web/src/fork/model-preview-3d/units.ts` (L40): if present, use `formatLength` in step 11.

For manual checks, seed the worktree's `.t3` with `vp run migrate-dev-db` and use a Git
workspace where a thread has several turns editing `bracket.scad`, which includes `gear.scad`,
plus an STL export. Do not run against `~/.t3/userdata`.

## Steps

1. **Contracts.** In `packages/contracts/src/fork/model-preview-3d.ts` add the `"conflict"`
   reason, the history schemas, the five method names and RPCs (TECHNICAL.md, "Contracts").
   Add the rows to `apps/server/src/fork/rpcAuthorization.ts` and
   `packages/contracts/src/fork/clientRpcPermissions.ts`. In
   `apps/server/src/fork/model-preview-3d/rpc.ts` add handlers that fail with
   `command-failed` ("Not implemented") so the group typechecks. Create
   `packages/contracts/src/fork/model-preview-3d.test.ts` if L41 has not, with history decode
   tests.
2. **Annotation link field.** Add `resolvedIn` to `ModelAnnotation` in
   `packages/contracts/src/fork/model-workspace.ts` with its decoding default, and
   `resolvedIn: null` at `apps/web/src/fork/model-preview-3d/useModelEditing.ts:68` and
   `:157`. Add a decode test (a stored workspace without `resolvedIn` decodes with null). Add
   `turn-history`, `turn-compare` and `turnHistory` to
   `packages/contracts/src/fork/model-editor.ts`.
3. **Pure server helpers.** Create `formats.ts` and `scadIncludes.ts` exactly as L41's
   TECHNICAL.md defines them (with `scadIncludes.test.ts`), unless present. Create
   `apps/server/src/fork/model-preview-3d/history.ts` with the limits, `parseLsTree`,
   `contentKey`, `historyCandidates`, `isLfsPointer` and the `UndoManifest` schema, and
   `history.test.ts`.
4. **Git plumbing.** Create `historyGit.ts` with `makeHistoryGit(runner)` exposing `repoPrefix`
   (or reuse L41's), `treeOids`, `lsTree`, `materialize` and `hashObjects`. Test against a temp
   Git repository whose workspace is a subdirectory (`historyGit.test.ts`).
5. **Listing.** In `ModelPreviewService.ts` (`make`, `:103`): create `historyDir` (real path,
   like `cacheDir` at `:116-118`), the tree protection, the `lsTree` LRU and `historyLock`. Add
   private `trackedPaths` and the public `history(input)`. Wire the `history` handler. Test with
   a fake projection store and a temp repository.
6. **Materialization and versions.** Add `materializeVersion(file, checkpointId, allowLarge)`
   (TECHNICAL.md, `historyVersion` steps 1 to 5 and 8), `pruneTrees`, and the startup cleanup of
   stale `*.pending-*` directories. Add the `options` parameter to `runRender` (`:403`) with
   snapshot mode, then `historyVersion` and `historyCancel` with the `"\0history"` job key in
   `jobs`. Extend `clearCache` (`:1082`) to remove `history/trees`. Wire both handlers.
7. **Restore and undo.** Create `historyRestore.ts` as L66's TECHNICAL.md defines it (unless
   L66 landed it), using `fs.copyFile` and `fs.rename` with symlink resolution through
   `resolveSymlinkTarget` from `@t3tools/shared/symlink`. Add `historyRestore` and `historyUndo`
   to the service as thin calls into it. Wire both handlers.
8. **Render tool.** Give `renderImages` (`:1104`) the optional `checkpointId`. The timeout
   handling is fixed in `59638f0231` (local `fix/preview-defects`); if that commit is not on
   your base, pass `timeoutBehavior: "timedOutResult"` at `:1203-1210` and fail `timeout` when
   `result.timedOut`, committed separately as
   `fix(fork-model-history): report agent render timeouts as timeouts`.
9. **Annotation link.** Add `latestTouching` and the `resolvedIn` normalization in
   `updateWorkspaceMany` (`:805-839`). Test: accepting sets it; reopening clears it; a client
   value is ignored; a failing lookup still saves.
10. **Agent tools.** In `mcp.ts` add `loom_model_preview_3d_history` and
    `loom_model_preview_3d_restore_version`, the render tool's `checkpointId`, and the editor
    tool description sentence. Add both names to `mcp.test.ts:48`. Test the handlers with a fake
    service: disabled agent tools, restore without `checkpointId`, undo without `undoId`.
11. **Client plumbing.** Add the five commands to
    `packages/client-runtime/src/fork/model-preview-3d.ts`. Create
    `apps/web/src/fork/model-preview-3d/history.ts` (pure helpers) with `history.test.ts`, and
    `useModelHistory.ts`. Create `viewer/ghost.ts` and the `ghosts` group if L42 has not, and
    add `setCompareModel` to `viewer/createViewer.ts` (theme, section and dispose included).
12. **Strip and viewing.** Create `HistoryStrip.tsx`. In `ModelPanel.tsx`: the state from
    TECHNICAL.md, `shownMesh` at the canvas (`:845-864`), the history `onStats`, `editDisabled`
    while viewing (`:539`), empty measurements and annotations on the canvas, the disabled
    Customize fieldset, the status bar label (`:1135-1162`), the toolbar button (`:787`), and
    keys `t`, `[`, `]` in the handler (`:718-772`), with the brackets handled before the modifier
    return at `:736-746`.
13. **Compare.** Load the compared version with `loadModel`, hand it to `setCompareModel`, and
    show the delta with `sizeDelta` and the length helper. Clear on "Stop comparing", Now, and
    strip close.
14. **Restore UI.** Create `RestoreVersionDialog.tsx` and the Undo notice in `ModelFile`; gate
    Restore on `models.historyRestore.permissionAtom(environmentId)`.
15. **Markup link, actions, palette, editor command.** "Accepted in turn N" and "View turn N"
    in `MarkupSection.tsx` (`:394-398`) with an `onViewTurn` prop. Extend `ModelAction` in
    `actions.ts`, handle it at `ModelPanel.tsx:651-657`, add three entries to `palette.tsx`.
    Handle `turn-history` and `turn-compare` in `handleEditorRequest` (`:187`) and report
    `turnHistory` state.
16. **Docs.** In `docs/fork/user/model-preview-3d.md` add a short "History" section: `T` or the
    History button shows the turns that changed the model; `[` and `]` step; Compare overlays
    another version; Restore writes the file back as a normal edit with Undo; history needs a
    Git workspace and covers this thread's turns only. Update this packet's Status and the
    index row in MODEL-3D-FOLLOW-UPS.md if Kyle asks.

Commit messages use the slug, for example
`feat(fork-model-history): list and view a model's turn versions`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- In a thread where turns 2, 4 and 7 changed `bracket.scad` or `gear.scad` and turns 3, 5 and 6
  changed only code, the strip shows Start, Turn 2, Turn 4, Turn 7 and Now.
- `[` from Now shows turn 7, then turn 4; `]` returns. The status bar reads "Viewing turn 4 of
  9" when the thread has nine turns, and the camera does not move.
- Turn 4 of `bracket.scad` renders with `gear.scad` as it was at turn 4, even though
  `gear.scad` has changed since. An STL version loads over a remote connection.
- Pressing `[` repeatedly while an old SCAD renders cancels the stale renders (one OpenSCAD
  process at a time for that model).
- While viewing, measure, annotate, capture, section toggle, saved views and the customizer are
  disabled; orbit, standard views and display toggles work.
- Compare overlays the chosen version as a ghost and shows the size and triangle delta; "Stop
  comparing" removes it and frees its memory.
- Restore writes the file, the panel returns to Now showing turn 4's geometry, and Undo puts
  back the previous bytes. Restoring after the file changed elsewhere reports the conflict and
  writes nothing.
- Accepting an annotation shows "Accepted in turn N"; "View turn N" opens that version;
  reopening clears it. Workspaces saved before L49 load.
- A rolled-back turn disappears from the strip after a refresh, and selecting it from a stale
  strip shows "no longer available".
- A non-Git workspace shows the "needs a Git workspace" message and no errors.
- `loom_model_preview_3d_history`, `loom_model_preview_3d_render` with `checkpointId` and
  `loom_model_preview_3d_restore_version` (restore and undo) work from an agent, and
  `turn-history` drives the strip.
- No requests are made while the strip is closed and no version is shown.
- `loom.sh check` passes and the merge check in SEAMS.md is clean.
