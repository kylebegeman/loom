# L41 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, MODEL-3D-FOLLOW-UPS.md and this
folder. The implementation branch is `feat/model-follow-ghost-snap`, stacked after L34/L36/L45. Check whether `apps/server/src/fork/model-preview-3d/scadIncludes.ts` exists:
if L49 landed first, step 2 is done. For manual checks, seed the worktree's `.t3` with
`vp run migrate-dev-db` and use a Git workspace containing a few `.scad` files, one of which
includes another.

## Steps

1. **Contracts.** In `packages/contracts/src/fork/model-preview-3d.ts` add `AgentModelsMode`,
   the `agentModels` field with its decoding default, the default value, `TurnModel`,
   `TurnModels`, the two method names and the two RPCs (TECHNICAL.md, "Contracts"). Add the
   stream tag to `ForkSubscriptionRpcTag` in `packages/contracts/src/fork/rpc.ts:55-68` and two
   read rows to `apps/server/src/fork/rpcAuthorization.ts:49-65`. Add stub handlers in
   `apps/server/src/fork/model-preview-3d/rpc.ts` that fail with `command-failed` so the group
   typechecks. Add a decode test for old settings without `agentModels`.
2. **Formats and parser.** If `modelFormatOf` is not yet in
   `packages/contracts/src/fork/model-preview-3d.ts` (L50), add `MODEL_EXTENSIONS` and
   `modelFormatOf` there as TECHNICAL.md shows, with a contracts test (`part.STL` is `"stl"`,
   `a.stp` is `"step"`, `notes.txt` and `Makefile` are null). Delete the local `formats` in
   `ModelPreviewService.ts:71-80` and call `modelFormatOf` at its six uses. Create `formats.ts`
   with only `PREVIEWABLE_FORMATS` and `SCAD_INPUT_EXTENSIONS`. Create `scadIncludes.ts` with
   `scadReferences`, `resolveScadReference` and `scadIncludes.test.ts`. Skip the parser if it
   already exists, but read it and use it as written.
3. **Turn model mapping.** In `ModelPreviewService.ts` add the private helpers `repoPrefix`
   (cached `git rev-parse --show-prefix`), `scadDependents(root, changedAbsolute)` (the merged
   in-memory map and static scan, with the revision-keyed cache) and
   `modelsForFiles(root, prefix, files)`. Put the pure parts (prefix stripping, ordering,
   capping, transitive closure over a reverse edge map) in a new `turnModels.ts` so they are
   testable without a service. Add `turnModels(threadId, runId)` to the returned service object.
   Wire the real handler in `rpc.ts`.
4. **Event stream.** Yield `ThreadManagementService` in `make`; add
   `turnModelEvents(threadId)` (TECHNICAL.md, "Turn models"). Wire the handler. Confirm
   `ForkLayer.ts` still builds; if the layer type complains, provide
   `ThreadManagementService` the way `ProjectLifecycle.layer` gets it.
5. **Atoms.** Add `turnModels`, `loadTurnModels` and `turnModelEvents` to
   `packages/client-runtime/src/fork/model-preview-3d.ts`.
6. **Opening helpers and titles.** Create `apps/web/src/fork/model-preview-3d/agentModels.ts`
   with `modelSurface`, `openModels`, `hasModelTab`, `mayAffectModels` and the background and automatic-open
   `setState` helpers, plus `agentModels.test.ts`. Switch `ModelPicker.tsx:123-126`,
   `palette.tsx:44-47` and `Shortcuts.tsx:38` to `modelSurface`. This alone fixes the
   "3D model" title on agent-opened tabs; commit it separately
   (`fix(fork-model-follow-agent): title tabs the agent opens`).
7. **Marks and tab icon.** Create `agentModelMarks.ts`. Add optional `TabIcon` to
   `ForkPanelDefinition` and use it in `ForkSurfaceIcon`. Add `ModelTabIcon` to `panel.tsx`.
   In `ModelPanel.tsx`'s `ModelFile`, clear the mark in an effect when `visible` is true. Update
   EXTENSION-POINTS.md section 6's fork-owned files with one sentence about `TabIcon`.
8. **Host.** Create `AgentModelsHost.tsx` and render it from `ModelPreview3dShortcuts`
   (`Shortcuts.tsx:82`, return it instead of `null`). Implement the three modes.
9. **Chip and seam.** Create `ModelTurnChip.tsx`. Add the two marked lines to
   `apps/web/src/components/chat/ChangedFilesTree.tsx` exactly as SEAMS.md shows, then
   `vp fmt` that file. Add the FORK.md paragraph and the `docs/fork/seams.tsv` row in the same
   commit. Run `scripts/fork/loom.sh check`.
10. **Picker and palette.** Add the "Changed by the agent" section and the `pickerTurn` entry to
    `ModelPicker.tsx`, and the palette entry to `palette.tsx`.
11. **Setting.** Add the "When an agent writes a model" row to `SettingsSection.tsx` after
    `:291`.
12. **Docs.** In `docs/fork/user/model-preview-3d.md`, add a short paragraph after the first
    section: after a turn writes or changes a model, its changed files card offers to open it;
    while the panel is open, new models arrive as tabs and changed tabs show a dot; the
    setting is in Settings > Loom > 3D model. Update this packet's Status and the index row in
    MODEL-3D-FOLLOW-UPS.md if Kyle asks.

Commit messages use the slug: `feat(fork-model-follow-agent): offer the models a turn wrote`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A turn that writes `bracket.scad` shows "Open bracket.scad" on its changed files card; a turn
  that writes three STL files shows "Open 3 models"; a turn that edits only `gear.scad` shows
  "Open bracket.scad" when `bracket.scad` includes it.
- A turn that changed only code, or only Git-ignored files, shows no chip and makes no
  `turnModels` request.
- Dismissing a chip hides it for that turn after a reload; other turns keep theirs.
- With the panel open on a model, a turn's new models appear as background tabs without
  changing the active tab, and an open tab whose file or include changed shows a dot until
  viewed.
- "Open automatically" opens the panel on the first model when it is closed. "Do nothing" shows
  no chip, tab or dot.
- The palette entry and picker section open the last turn's models with the chip hidden.
- Tabs opened by `loom_model_preview_3d_editor` show the file name.
- Settings saved before L41 load with "Offer to open".
- `loom.sh check` passes and the merge check in SEAMS.md is clean.
