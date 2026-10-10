# L60 implementation

Read L24's packet and TECHNICAL.md first. Work in this order; each step leaves the build green.

1. **Pure diff and schemas.**
   - Add `PcbChangeField`, `PcbComponentChange`, `PcbNetChange`, `PcbChangeRegion` and
     `PcbChangeState` to `packages/contracts/src/fork/pcb-workspace.ts` beside
     `PcbComparison` (`:160-176`).
   - Create `packages/contracts/src/fork/pcb-changes.ts` with `MOVE_TOLERANCE_MM`,
     `pcbChangeSet`, `changeDetail` and `changeCounts`; export it from
     `packages/contracts/src/fork/index.ts`.
   - Write `pcb-changes.test.ts` alongside (TESTING.md) before wiring anything.
2. **Compare tab uses it.** Rewrite `compareInspections`
   (`apps/server/src/fork/pcb-preview/semantics.ts:443-459`) as in TECHNICAL.md. Add the moved
   part case to `workbench.test.ts`. In `RevisionCompare.tsx`, export `CHANGE` (`:37-41`) and
   add `moved: { title: "Moved", icon: MoveIcon, tone: "info" }` (`Tone` includes `"info"`,
   `InspectorKit.tsx:122`). The Compare tab itself still receives only `added`, `removed` and
   `changed` from the server.
3. **Editor contract.** Append `"changes"` to `PcbEditorAction.action`
   (`pcb-workspace.ts:300-329`) and `changes: Schema.optional(Schema.NullOr(PcbChangeState))`
   to `PcbEditorResult.state` (`:359-379`). Update the `loom_pcb_editor` description
   (`apps/server/src/fork/pcb-preview/mcp.ts:27`).
4. **Change memory.** Create `apps/web/src/fork/pcb-preview/changeMemory.ts` (8 designs,
   16 MiB of SVG, drawings evicted before entries) and its test.
5. **Layer SVGs.** Add the optional `onSvg` prop to `LayerSheet` (`LayerSheet.tsx:7-42`), called
   from the effect at `:35-42`. Pass a stable callback from both `LayerSheet` uses in
   `PcbPreviewPanel.tsx` (`:1003`, `:1463`).
6. **Hook.** Create `useChangeHighlights.ts`. Pair detection runs in render with a last seen
   hash state, as `usePcbPreview.ts:86-87` does. Call it once in `DesignWorkspace`, passing
   `suspended: three` (add L66's flag when L66 exists).
7. **Drawing diff.** Create `drawingDiff.ts` with the pure `diffRegions` and the browser
   `drawingRegions`. Test `diffRegions` with synthetic buffers. Memoize per pair and view in
   the hook; expose `drawingSettled()`.
8. **Overlay.** Create `ChangeHighlights.tsx`. Render it first inside both overlay fragments
   (`PcbPreviewPanel.tsx:983-997`, `:1447-1457`) when `changes.shown` and the pair's after hash
   equals `display.sourceHash`.
9. **Chip and list.** Create `ChangesChip.tsx` with existing `components/ui` variants only.
   Render it in the doc bar actions (`:1072`) before `SurfaceSwitch` when `changes.chip` and not
   in 3D. Part rows call `selectComponent` (`:205`); net rows call `setNet`.
10. **Key and shortcut list.** Add the `d` line to the key handler (`:1053-1064`) and the row to
    `SHORTCUTS` (`WorkspaceChrome.tsx:252-261`).
11. **Editor action and snapshot.** Add `case "changes"` to the editor switch (`:374-544`) and
    `changes: changes.state()` to the snapshot state (`:546-570`).
12. **User docs.** In `docs/fork/user/pcb-preview.md`, "Optional editor tools", add two
    sentences: after a reload, press `D` or the "Changed" chip to see what changed since the
    version shown before; agents can ask for the same list. No internal doc.

## Done when

- A reload of a seen design with a moved part shows the chip; `D` draws a blue ring and arrow
  at that part on the board; the list says "Moved"; the Compare tab reports the same
  move as "pcb" only.
- A rerouted trace with no part change shows the chip and one dashed box around the trace.
- A save that changes nothing visible shows no chip.
- Hiding the tab, letting the agent edit, and returning shows the change.
- `loom_pcb_editor { action: "snapshot" }` returns `state.changes` with the same parts, and
  `{ action: "changes", enabled: false }` hides them.
- No timers, intervals or animation frames were added; the tests in TESTING.md pass.
