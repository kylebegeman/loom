# L55 implementation

Each step leaves the tree compiling. Commit at the end with
`feat(fork-pcb-board-stats): show board stats in Inspect`.

1. **Contracts.** Add `PcbBoardStats` and the optional `stats` field to
   `packages/contracts/src/fork/pcb-workspace.ts` (TECHNICAL.md).
2. **Geometry helpers.** In `apps/server/src/fork/pcb-preview/boardStats.ts`, write
   `outlineArea(loops)` (shoelace shared loops and subtract inner loops) and
   `annularRing(pad)` as exported pure functions. Export `parseSexp`, `children`, `child`,
   `atom`, `number` and `localPosition` from `semantics.ts` if they are not already.
3. **KiCad stats.** Create or reuse `outline.ts` with the shared `kicadOutline` and
   `circuitOutline` signatures in L67 TECHNICAL.md. Implement the KiCad branch of
   `boardStats` per the table, including
   `.kicad_pro` rules parsing (JSON, tolerate missing keys, zero means unset).
4. **Circuit JSON stats.** Implement the tscircuit branch. Before relying on a field, check it
   against a real `tsci export -f circuit-json` output in a scratch directory outside the
   worktree, and note any difference from REFERENCES.md in a code comment. Keep the function
   free of I/O and accept Circuit JSON without an inspection (derive it with
   `inspectCircuitJson`), so L70 can call it on unsaved variant builds.
5. **GLB bounds.** Create or reuse `readGlbBounds` in `glb.ts`, including `nodes` and
   `materials` as shared with L67, and add the height logic in `boardStats.ts`.
   Validate it against the KiCad 10 `complex_hierarchy` demo GLB used by `realTools.test.ts`
   (heights within 0.5 mm of KiCad's 3D viewer); confirm that node names carry references,
   as the KiCad 10 source indicates (REFERENCES.md).
6. **Service.** Extract `cachedModel` from `runAsset` (`PcbPreviewService.ts:1569-1600`). In
   `inspect` (`:1818-1859`) read the board, project and cached GLB header, call `boardStats`
   under `Effect.try`, and add the 16-entry inspection cache. Update the `loom_pcb_inspect`
   description in `mcp.ts`.
7. **Card.** Create `apps/web/src/fork/pcb-preview/BoardStatsCard.tsx`; replace the "Board"
   section in `InspectTab.tsx:236-269`; thread `onMeasure`, `onOpenChecks`, `onDraft` and
   `canMeasure` through `Inspector.tsx` `ToolPanel` from `PcbPreviewPanel.tsx`. Add
   `boardStatsText` to `summary.ts`.
8. **Tests.** Add the tests in TESTING.md.
9. **Docs.** In `docs/fork/user/pcb-preview.md`, "Optional editor tools", add two sentences:
   Inspect shows board stats with no selection; clearance is the design rule, so run DRC to
   measure, and heights need a 3D board. Set this packet's Status to Done.

## Done when

- A two-layer KiCad board with a rounded rectangle outline and one cutout reports area within
  0.5 percent of KiCad's Board Statistics, `areaSource: "outline"`.
- Plated and non-plated holes, through and blind or micro vias, components per side, smallest
  drill, track, via diameter and annular ring match KiCad's Board Statistics and a manual check
  on the same board.
- Clearance shows the `.kicad_pro` rule labelled "rule"; with the rule at 0 it shows "Not
  available" and "Run DRC to measure".
- With no cached GLB, "Tallest part" offers "Measure heights"; after it runs, the row shows a
  height and the inspect result for that revision includes `tallest`.
- A tscircuit board shows its layer count, holes, vias, drill and track width, and heights from
  `cad_component` when present.
- A board that makes `boardStats` throw still inspects, with the warning and no `stats`.
- A second `loom_pcb_inspect` call for the same revision does not run `kicad-cli`.
- `loom_pcb_inspect` returns `stats`; an old client still decodes the result.
