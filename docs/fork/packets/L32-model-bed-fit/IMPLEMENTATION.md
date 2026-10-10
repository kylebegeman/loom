# L32 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, MODEL-3D-FOLLOW-UPS.md and this
folder. Start the branch from `main` once `feat/model-bed-picker` has merged, otherwise from
that branch (`8676e099e5`). Check whether `packages/contracts/src/fork/model-beds.ts` exists:
if L33 or L34 landed first it does, and step 1 is already done. No seeded data is needed; any
STL in a worktree works.

## Steps

1. **Bed module (skip if `model-beds.ts` exists).** Create
   `packages/contracts/src/fork/model-beds.ts` and move into it, unchanged, the
   `BuildPlatePreset` type, `BUILD_PLATE_PRESETS`, `BuildPlatePresetId`, `BuildPlatePattern`,
   `BuildPlateSetting` and their type exports from `model-preview-3d.ts:141-238` and `:292-294`.
   Import `BuildPlateSetting` back into `model-preview-3d.ts`. Add
   `export * from "./model-beds.ts";` to `packages/contracts/src/fork/index.ts`. Typecheck
   contracts, web and server. Commit on its own:
   `refactor(fork-model-bed-fit): keep bed data in one contracts module`.
2. **Bed list.** In `model-beds.ts` add `BedVolume`, `Bed`, `listBeds`, `activeBed` and
   `selectBed` (TECHNICAL.md, "Bed list in contracts"). Rewrite `buildPlate.ts` so
   `resolveBuildVolume`, `buildPlateLabel` and `bedGroups` call them; change `bedGroups` to take
   the whole `BuildPlateSetting` and update its three callers (`BedPicker.tsx:149`,
   `ModelInspector.tsx:306`, `SettingsSection.tsx:198`). Replace the two direct preset note reads
   (`BedPicker.tsx:125`, `SettingsSection.tsx:238-240`) with `activeBed(...).note`. Update
   `buildPlate.test.ts` for the new `bedGroups` signature.
3. **Fit helper.** Add `BedFit` and `fitOnBed` to `model-beds.ts`. Reimplement
   `fitsBuildVolume` in `buildPlate.ts` on top of it. Move `OVER` from `ModelInspector.tsx:180`
   to `buildPlate.ts` and add `describeFit`. Switch `PartSection`'s `rotated` flag
   (`ModelInspector.tsx:368-369`) and advice text to `fitOnBed`/`describeFit`. Add
   `model-beds.test.ts`.
4. **Summary schema.** Add `BedFitSummary` and `bedFitSummary` to `model-beds.ts`, plus
   `fit: Schema.optional(BedFitSummary)` on `ModelEditorState` in `model-editor.ts`.
5. **Server.** In `ModelPreviewService.renderImages` compute `fit` from
   `summary.boundingBox` and `settings.buildPlate` and return it. In `mcp.ts`, add
   `fit: Schema.NullOr(W.BedFitSummary)` to the render tool's success schema and append the
   sentence from TECHNICAL.md to its description. Extend `mcp.test.ts` (the fake
   `renderImages` at `mcp.test.ts:62` returns a `fit`) and add a service test for the box to
   summary step.
6. **Part list.** Add `BedFitList.tsx` and render it in `PartSection` after the fit card. Add
   `model-bed-fit-*` styles to `workspace.module.css`. Check light and dark themes and a narrow
   inspector (sheet mode).
7. **Editor snapshot.** In `ModelPanel.tsx`'s `snapshot` branch (`:386-410`) add `fit` to
   `state` when `stats` exists.
8. **Docs.** In `docs/fork/user/model-preview-3d.md`, extend the Part paragraph (line 60) with
   one sentence: Part lists every bed with whether the part fits, and clicking a bed selects it.
   Mention that the render tool reports fit across beds in the agent section. Update this
   packet's Status and the index row.

Commit messages: `feat(fork-model-bed-fit): see which beds fit a part, and tell agents`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Part lists every bed (printers, surfaces, custom) with "Fits", "Fits rotated" or the overage,
  and a "Fits N of M" count; the active bed is marked.
- Clicking a row changes the viewport plate, the fit card, the Bed menu label and the status bar
  warning, and a failed save reverts with the "Bed not changed" toast.
- A 340 x 200 x 100 mm box shows "Fits" on the H2D and "10.0 mm too wide" on the H2C. A
  300 x 340 x 100 mm box shows "Fits rotated" on the H2D. A 200 x 200 x 330 mm box shows
  "5.0 mm too tall" on the H2D and "Fits" on the 1 m square.
- `loom_model_preview_3d_render` on an STL returns `fit` with the same statuses the panel shows,
  and `null` when the OpenSCAD build has no summary support.
- `snapshot` returns `state.fit` for a GLB.
- No code outside `model-beds.ts` and `buildPlate.ts` reads `BUILD_PLATE_PRESETS`
  (`rg BUILD_PLATE_PRESETS apps` finds only tests).
