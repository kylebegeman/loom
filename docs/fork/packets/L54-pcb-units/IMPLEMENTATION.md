# L54 implementation

Each step leaves the tree compiling. Commit at the end with
`feat(fork-pcb-units): show PCB lengths in mm, mils or inches`.

1. **Tolerant preferences.** In `apps/web/src/fork/pcb-preview/preferences.ts`, give
   `selections`, `trusted` and `electronicsUrl` decoding defaults (TECHNICAL.md, Storage). If
   L56 or commit `6ddf84c1aa` (local `fix/preview-defects`) landed first this is done; skip to
   adding the field. Add a test that a stored value
   missing a field keeps the fields it has (step 7).
2. **`length.ts`.** Create `apps/web/src/fork/pcb-preview/length.ts` with the API in
   TECHNICAL.md. If L52 created it, add the missing functions without changing existing
   signatures. Add `lengthUnit` and `setLengthUnit` to `usePcbPreferences`.
3. **Server normalization.** If `6ddf84c1aa` is on your base, `kicadReports.ts` already
   scales ERC positions and converts units (as `ercScaleFactor` and `unitScale`); check that
   it writes `coordinateUnits: "mm"` and go to step 4. Otherwise, in
   `apps/server/src/fork/pcb-preview/kicadReports.ts`, add
   `ercScale` and the unit table, scale `pos` in the `add` helper (`:44-45`), and always write
   `coordinateUnits: "mm"` when the unit was recognized (`:80`). Drop item coordinates for an
   unparsable ERC version. Extend `realReports.test.ts` (fixture `erc.json` is KiCad 10.0.6, so
   its first item becomes `x: 41.91`).
4. **Mark text.** Give `measurementParts` and `measurementLabel` (`geometry.ts:13-37`) a `unit`
   parameter. Pass `useLengthUnit()` from `MarksTab.tsx:51` and a new `unit` prop into
   `Overlays` from `PcbPreviewPanel.tsx`.
5. **Remaining sites.** Convert every row of the inventory in TECHNICAL.md: `InspectTab.tsx`,
   `ChecksView.tsx` (convert, format, enable Locate for any known unit, keep raw text for
   unknown units), `summary.ts` (mm), `HardwareLibrary.tsx` (text and inputs). Run
   `rg -n '" mm"|mm`|toFixed\(' apps/web/src/fork/pcb-preview` and confirm every remaining hit
   is in the "Not lengths" list.
6. **Controls.** Add the status bar menu in `PcbPreviewPanel.tsx` (before `:1378`) and the
   "Length units" row in `settings.tsx`. Add the description sentences in `mcp.ts`.
7. **Tests.** Add the tests in TESTING.md.
8. **Docs.** In `docs/fork/user/pcb-preview.md`, "Optional editor tools", add one sentence:
   lengths show in millimetres, mils or inches from the status bar or Settings, PCB; agents and
   saved files always use millimetres. Set this packet's Status to Done.

## Done when

- With no saved preference, every site reads exactly as on `main` except ERC coordinates, which
  are now 100 times larger and correct.
- Switching to mils or inches changes every inventory site at once, including mark labels on
  the drawing and in a capture, and survives a reload.
- Hardware width typed as "2 in" stores 50.8 (read it back with `loom_pcb_library`).
- "Locate" on an ERC finding lands on the flagged pin; "Locate" works on a DRC report run with
  `--units in` written by hand into the checks store, or by a test.
- An older stored preference without `lengthUnit` keeps its trusted designs.
- `loom_pcb_inspect`, `loom_pcb_check` and the editor descriptions say millimetres; no tool
  output changed shape.
