# L56 implementation

Each step leaves the tree compiling. Commit at the end with
`feat(fork-pcb-layer-presets): add built-in layer presets`.

1. **Preset data.** Create `packages/contracts/src/fork/pcb-layer-presets.ts` with
   `PCB_LAYER_PRESETS`, `resolveLayerPreset` and `findLayerPreset` (TECHNICAL.md) and
   re-export it from `packages/contracts/src/fork/index.ts`. Add the optional `layerPreset` to
   `PcbEditorResult.state` in `pcb-workspace.ts`.
2. **Preferences.** In `apps/web/src/fork/pcb-preview/preferences.ts`, add decoding defaults to
   every field if neither L54 nor `6ddf84c1aa` (local `fix/preview-defects`) has, then `hiddenLayerPresets` and `setPresetHidden`.
3. **Active set.** Add `matchLayerSet(layers, boardLayers, savedSets)` to
   `apps/web/src/fork/pcb-preview/usePcbPreview.logic.ts`, returning
   `{ kind: "built-in", id, name } | { kind: "saved", id, name } | null`. Use it in
   `PcbPreviewPanel.tsx` for the shelf label (`:888-892`) and the status bar (`:1334-1342`),
   and move `sameVisibility` from `LayersTab.tsx:36` into the same file so both use one test.
4. **Saved set reconcile.** Add `reconcileSaved(saved, boardLayers)` beside it: keep saved
   states for layers still on the board, add missing board layers hidden, drop the rest. Use it
   where `LayersTab.tsx:236` applies a saved set and in the panel's `load-view` case
   (`PcbPreviewPanel.tsx:531`).
5. **Layers tab.** Add the "Presets" section before "Saved sets" in `LayersTab.tsx` with chips,
   hide, the "Preset options" menu (duplicate and show hidden) and the disabled states.
6. **Drawing menu.** Add the "Presets" group to the layer menu in `PcbPreviewPanel.tsx`
   (`:894-911`).
7. **Editor command.** Extend `case "layers"` (`PcbPreviewPanel.tsx:492-496`) and the snapshot
   (`:545-569`) as in TECHNICAL.md. Append the sentence to the `loom_pcb_editor` description in
   `apps/server/src/fork/pcb-preview/mcp.ts`.
8. **Tests.** Add the tests in TESTING.md.
9. **Docs.** In `docs/fork/user/pcb-preview.md`, "Optional editor tools" (line 44), extend the
   Layers sentence: built-in presets for assembly, copper, fab review and silkscreen, which can
   be hidden or duplicated into a saved set. Set this packet's Status to Done.

## Done when

- Each built-in shows exactly its layers on a two-layer and a four-layer KiCad board, and
  "Copper only" includes In1.Cu and In2.Cu on the four-layer board.
- Applying, then toggling one eye, shows "Custom"; re-applying presses the chip again.
- The shelf and status bar name the active preset or saved set, never "Front copper" while a
  saved set is visible.
- Hiding survives a reload; "Show" brings the chip back; hidden presets still apply from the
  editor command.
- "Duplicate as saved set" adds a saved set with the same visibility, disabled without the
  write grant and at 20 sets.
- `loom_pcb_editor` `layers` with `name: "fab-review"` applies it and the next snapshot reports
  `layerPreset: "fab-review"`; an unknown name fails with "Unknown layer preset."
- A tscircuit board shows no Presets section.
