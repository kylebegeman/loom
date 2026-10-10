# L52 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Commits use
`feat(fork-pcb-check-markers): ...`; the ERC fix in step 2 is its own
`fix(fork-pcb-check-markers): place ERC findings at their real position`. Commit `6ddf84c1aa`
on the local `fix/preview-defects` branch already adds `unitScale` and `ercScaleFactor` with
that fix; if it is on your base, step 2 adds only the rest and there is no separate fix
commit.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, PCB-FOLLOW-UPS.md and this
folder. Check whether L54 or L58 landed first: if `kicadReports.ts` already converts units or
exports a finding id, read it and reuse it rather than adding a second copy. For manual checks,
use a KiCad project with a hierarchy (KiCad's `demos/complex_hierarchy` is what the fixtures
came from) on a host with KiCad 9 or 10.

## Steps

1. **Contracts.** In `packages/contracts/src/fork/pcb-preview.ts` add the optional `uuid`,
   `id`, `sheetId` and `pointsInMm` fields. In `pcb-workspace.ts` add `PcbFindingSource`,
   `PcbFindingSeverity`, `PcbFinding`, the `"finding"` and `"markers"` action literals and the
   optional `findings` snapshot state (TECHNICAL.md, "Contracts"). The panel's action switch
   (`PcbPreviewPanel.tsx:386`) has no exhaustive check, so the tree compiles with the new
   literals unhandled until step 9. Run the contracts typecheck.
2. **Report normalization.** In `apps/server/src/fork/pcb-preview/kicadReports.ts` add
   `unitScale`, `ercScaleFactor`, `ercSheetId`, `findingId` and `normalizeCheckResult`, keep
   `uuid` in `Item`, and give `parseKicadReport` the `rootSheet` option. Create
   `kicadReports.test.ts` (TESTING.md). Update `realReports.test.ts` only if its counts change
   (they should not).
3. **Service call sites.** Pass `rootSheet` from `check` (`PcbPreviewService.ts:1126-1129`) and
   map `latestChecks` results through `normalizeCheckResult` (`:1165`). Extend the existing
   check test (`PcbPreviewService.test.ts:280-298`) to assert `pointsInMm` and ids on a fresh
   run and the upgrade of a result written without `pointsInMm`.
4. **Pure web helpers.** Create `apps/web/src/fork/pcb-preview/findings.ts` and
   `findings.test.ts`.
5. **Viewport scale.** In `SvgViewport.tsx` add `OverlayScaleContext`, `useOverlayScale` and
   `unitsPerPixel` on `PcbViewportHandle`; provide the context around `{overlays}`. Nothing
   consumes it yet.
6. **Markers.** Create `CheckMarkers.tsx`. In `PcbPreviewPanel.tsx` add `activeFinding`, the
   lifted `showExcluded`, the derived finding lists and render `<CheckMarkers>` in the overlays
   slot. Add `checkMarkers` to `preferences.ts` with its decoding default and a setter.
7. **Checks wiring.** Change `ChecksView.tsx` to the new props: shared "Show excluded", active
   row, "Finding 3 of 12", "Show on drawing" switch, Locate without the mm gate. Pass `sheetId`
   to `onLocate`. Run a Locate on an ERC finding in a sub-sheet: it now switches sheet.
8. **Stepping and keys.** Add `goToFinding`, `stepFindings`, the four key lines, the pick hit
   test and the two `SHORTCUTS` rows in `WorkspaceChrome.tsx`.
9. **Agent actions.** Add `case "finding"` and `case "markers"` to `handleEditorRequest` and the
   `findings` snapshot field. Update the three tool descriptions in `mcp.ts`. Add an MCP decode
   case to `mcp.test.ts` for a `finding` command.
10. **Docs.** In `docs/fork/user/pcb-preview.md`, in the Checks paragraph, add: findings appear
    on the drawing; `.` and `,` step through them; `C` hides them; "Show excluded" applies to
    both. Mention that ERC positions are corrected for KiCad 9 and early 10.0 releases.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- An ERC run on a hierarchical KiCad design places each pin on the symbol it names, on the
  right sheet, for KiCad 9.x and 10.0.6 reports; Locate on a sub-sheet finding switches sheet.
- A DRC run places pins on the board; a two-item clearance finding shows one pin and, when
  active, a ring on the second item.
- `.` and `,` step in severity then position order across sheets and wrap; Checks opens on the
  finding; `Escape` clears it.
- `C` and "Show on drawing" toggle pins and survive a reload; "Show excluded" changes the list
  and the pins together.
- After a saved change, pins are dimmed and the active finding shows "Stale".
- `loom_pcb_editor` `finding` with `next` moves the visible panel, and `snapshot` lists the
  same ids the user sees.
- Pins keep their on-screen size from fit to maximum zoom, and captures include them.
