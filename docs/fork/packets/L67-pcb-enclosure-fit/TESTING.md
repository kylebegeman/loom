# L67 testing

## Focused tests

Phase A, server (pure unless noted):

| File                                                                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/fork/pcb-preview/outline.test.ts`                    | A rectangle of four `gr_line`s gives one loop of four points; a rounded rectangle (lines and `gr_arc`s) closes; a footprint `fp_line` cut-out becomes an inner loop and the larger loop is `outer`; an open chain returns null, including an open outer boundary with a closed cutout; tscircuit `outline` points are Y-negated; no outline falls back to the `center`/`width`/`height` rectangle.                                                                                                                                                                                                     |
| `apps/server/src/fork/pcb-preview/glb.test.ts` (extend)               | `readGlbJson` reads the JSON chunk of the existing `encode` helper's GLB and rejects a bad magic; `readGlbBounds` composes TRS and matrix transforms, reports ancestor `nodes` root first and `materials`.                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/fork/pcb-preview/workbench.test.ts` (extend)         | A KiCad board with `MountingHole_3.2mm_M3_Pad` (plated `thru_hole`) reports one hole with `plated: true`; `np_thru_hole` holes still report `plated: false`; a connector's `np_thru_hole` pegs carry the connector's footprint.                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/pcb-preview/enclosure/features.test.ts`         | glTF to board part frame `(x, y, z) -> (1000x, -1000z, 1000y)`; KiCad fixture fits `(1, -1)`, tscircuit `(-1, 1)`; a mirrored fixture sets `mirrored` and warns; fewer than three matches falls back to the kind's pair; `_<digits>` suffixes match references; holes inside a component box are dropped unless the footprint is a mounting hole; assumed parts skip `H`, `TP` and `FID` references; a USB connector 0.3 mm inside the outline is an edge connector facing the nearest side, one 5 mm inside is not; `include` and `exclude` win; a version 1 metadata file uses the bounds rectangle. |
| `apps/server/src/fork/pcb-preview/enclosure/plan.test.ts`             | Null standoff height resolves to `max(3, partsBelow + 1)`; pilot never below 1 mm; cut-out boxes grow by the margin; proxies cap at 300, tallest first; `outerMm` equals inner plus twice wall and gap.                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/fork/pcb-preview/enclosure/scad.test.ts`             | Output is deterministic; the header hash covers the body and `isUnedited` detects a one-character edit; `parseCustomizer` (`model-preview-3d/customizer.ts`) on the output returns exactly the Show, Case and Fit parameters with their ranges and the `part` options, and none of the Hidden data.                                                                                                                                                                                                                                                                                                    |
| `apps/server/src/fork/pcb-preview/enclosure/build123d.test.ts`        | Deterministic; the header hash works; every `model` keyword argument has a default and an `Annotated` or `Literal` type L50's inspector accepts (use L50's AST-only parameter reader when present).                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (extend) | Service level, with the existing fake tools: `enclosure` with `preview` writes nothing (no reference, no folder); without `preview` writes the case folder and a version 2 reference with `relativePath`; regenerate replaces an unedited file and fails `conflict` on an edited one unless `overwrite`; `outputDir` outside the workspace fails; `build123d: true` fails without `model-python-cad`; a `.loom-assembly.json` beside a tscircuit design does not change its `sourceHash`.                                                                                                              |

Phase B, server:

| File                                                                        | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/model-assembly.test.ts` (L48's, extend)        | Version 1 files decode with `enclosure: null`; the writer emits version 1 without an enclosure and 2 with one; `validateAssembly` rejects an enclosure board that is missing or in `parts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/server/src/fork/model-preview-3d/assemblyOps.test.ts` (L48's, extend) | `set-enclosure` merges a requirements patch; `remove-part` of the board clears the enclosure; `place-board` centres the rotated outline on the case bounds (fake `ctx.bounds`); `swap-board` with a frame offset change keeps the drawing centre in place, and a sign pair change adds 180 degrees.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/fork/model-preview-3d/check/enclosure.test.ts`             | Built from synthetic meshes: a 60 by 40 mm box tray with 2 mm walls and four cylinders. Walls: a 0.5 mm gap reads 0.5 on each side; moving the board 0.8 mm in +X makes +X `tight` and -X wider; a board edge inside the wall is `interferes`. Lid: a 12 mm part under a lid 12.5 mm above is `tight` against 1 mm. Connector: an open slot is `ok`, a slot 0.3 mm narrower than the margin is `tight`, a solid wall is `interferes`, and `setbackMm` equals the wall distance. Holes: seated, gap, inside (depth measured), missing, off-centre with `offsetMm` within 0.25 mm of the true offset, and `suggestedMove` undoing it. A part from an open mesh yields `unchecked`, never `interferes`. Ray caps hold on a 2,000 mm perimeter. |

Phase A and B, web (pure helpers only):

| File                                                   | Covers                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/pcb-preview/enclosureState.test.ts` | The tab's state function: reference stale from `referenceHashPrefix` against the design hash; which sections show for each capability set (`pcb-enclosure-fit` only, plus `model-assemblies`, plus `model-python-cad`). |

No markup snapshots.

## Opt-in real tool tests

- `apps/server/src/fork/pcb-preview/realTools.test.ts` (extend, gated by
  `LOOM_TEST_PCB_FIXTURES` as today): export a reference for the KiCad fixture board, check the
  version 2 metadata, run `boardFeatures` on the real GLB and assert the frame matches at least
  three parts with a residual under 0.5 mm.
- `apps/server/src/fork/model-preview-3d/realOpenScad.test.ts` (extend, gated by
  `LOOM_TEST_OPENSCAD`): render the generated `case.scad` for the plan fixture with `part` set
  to `fit`, `base` and `lid`; each renders without warnings and the base bounding box equals
  `outerMm` within 0.01 mm.
- With L50, its real Python test gate: run the generated `case.b3d.py` through L50's runner for
  `base` and compare its bounding box with the SCAD base within 0.05 mm.

## Commands

```sh
vp test run apps/server/src/fork/pcb-preview/outline.test.ts \
  apps/server/src/fork/pcb-preview/glb.test.ts \
  apps/server/src/fork/pcb-preview/workbench.test.ts \
  apps/server/src/fork/pcb-preview/enclosure \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/web/src/fork/pcb-preview/enclosureState.test.ts
# phase B
vp test run packages/contracts/src/fork/model-assembly.test.ts \
  apps/server/src/fork/model-preview-3d/assemblyOps.test.ts \
  apps/server/src/fork/model-preview-3d/check/enclosure.test.ts
# opt-in
LOOM_TEST_OPENSCAD=$(command -v openscad) vp test run \
  apps/server/src/fork/model-preview-3d/realOpenScad.test.ts
vp lint apps/server/src/fork/pcb-preview apps/server/src/fork/model-preview-3d \
  apps/web/src/fork/pcb-preview apps/web/src/fork/model-preview-3d \
  packages/contracts/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
```

No repo-wide checks.

## Manual checks for Kyle

1. KiCad 10 board with M3 mounting holes and a USB-C on an edge: Enclosure tab, Generate case.
   The model panel opens the assembly; the tray follows the outline, standoffs sit under the
   holes, the USB-C has a cut-out.
2. Fit tab, Check fit: "Fits". Change `standoff_height` up by 5 in the case part's parameters,
   check again: lid findings appear with pins over the tallest parts.
3. Drag the board 1 mm in X in Parts, check: off-centre holes and a wall finding; "Apply
   suggested move" puts it back; "Undo" in the toast moves it away again.
4. Edit `case.scad` by hand, Regenerate: the "Overwrite it?" question appears; "Cancel" keeps
   the edit.
5. Change the board in KiCad: the tab says "The board changed since this reference."; "Update
   board" swaps it and a check still finds the holes seated.
6. "Use an existing case" with a downloaded case STL: the board is centred over it; check and
   apply the suggested move.
7. A tscircuit board with `pcb_hole`s: generate and check.
8. KiCad 9: the tab explains that KiCad 10 is needed. A server without L48 shows only Generate
   case. A server with L50 shows the build123d checkbox.
9. Remote browser over the tailnet: generate, open and check work; no request goes to
   localhost.
10. Leave the tab open and idle: no CPU or GPU activity from it.

## Merge safety

Before the PR, run `scripts/fork/loom.sh check` and, for the next upstream tag,
`git merge-tree --write-tree --name-only --no-messages HEAD "$tag"` (CONVENTIONS.md). L67 edits
no upstream file, so a conflict there means another change, not this packet. Phase B touches
L48's files; rebase on L48's final merge before opening it.
