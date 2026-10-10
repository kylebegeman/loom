# L61 testing

Focused tests only, no repo-wide checks, no sleeps. If step 1 of IMPLEMENTATION.md built a 3D
packet's subset, also run that packet's tests for the files it created (listed in its
TESTING.md).

## Automated tests

| File                                                                      | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/pcb-preview/board3dParts.test.ts` (new)                | A synthetic KiCad-shaped tree (an assembly node with meshes using materials `board`, `soldermask`, `copper`, `pad`, `silkscreen`, and component nodes `R1`, `U1`, `U1_1`, `J1` below the board, plus one unnamed part) classifies into the six groups; `U1_1` matches reference `U1`; the unnamed part has `reference: null` but still lands in a component group; `J1` is `back`; `top` and `bottom` come from the `board` meshes. A tscircuit-shaped tree under `Loom_millimetres_to_metres` finds the body by largest XY area and reports copper and silkscreen unavailable. A tree with no body gives `top: null` and every component `front`. Material arrays on one mesh classify by their first matching name. |
| `apps/web/src/fork/pcb-preview/heights.test.ts` (new)                     | Board from z 0 to 1.6: a top part reaching 11.2 gives `aboveMm` 9.6; a top through-hole part with leads to z -3.0 gives `belowMm` 3.0 and wins `below`; a back part gives `belowMm` from its own box. `partHeights` caps `parts` at 100 with the full `partCount` and skips null references in `parts` but not in the extremes. A part rotated 45 degrees reads its true height (precise box), not the inflated one. `heightAt` above, below and inside the board. `heightOfPart` for an unknown reference is null. `boardFrame` recovers a known flip and offset from five matched parts for each of the four sign pairs, falls back to the kind's pair with two matches, and returns null with no body.             |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (extend) | `pick` ignores a nearer mesh whose parent is hidden and returns the farther visible one. `invalidate()` schedules exactly one frame. With caps (L37 present), hiding a source mesh hides its helper pair after `invalidate()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/fork/pcb-preview/Board3D.test.tsx` (extend)                 | The mock viewer gains `setProjection`, `setSection`, `setPickMode`, `setOverlays`, `invalidate` and `snapPoint`. After a refresh creates a new viewer, the current display (orthographic, a section, hidden soldermask) is applied to it and measurements are empty. `restore` with an orthographic camera reports the projection through `onDisplay`. Two picks in distance mode produce one measurement; the 21st replaces the oldest.                                                                                                                                                                                                                                                                              |
| `packages/contracts/src/fork/pcb-workspace.test.ts` (new)                 | An editor action from before L61 still decodes. `points` with zero or three entries fails. A `state` without the new keys decodes. A `PcbCompleteEditorInput` with `measurement3d` and the new state keys round-trips.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (extend)     | `completeEditorAction` with `measurement3d` returns it to the waiting `editor` call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

No markup tests for the menu, buttons or hint.

## Commands

From the repository root:

```sh
(cd apps/web && ../../node_modules/.bin/vp test run \
  src/fork/pcb-preview/board3dParts.test.ts \
  src/fork/pcb-preview/heights.test.ts \
  src/fork/pcb-preview/Board3D.test.tsx \
  src/fork/model-preview-3d/viewer/createViewer.test.ts)
(cd packages/contracts && ../../node_modules/.bin/vp test run src/fork/pcb-workspace.test.ts)
(cd apps/server && ../../node_modules/.bin/vp test run \
  src/fork/pcb-preview/PcbPreviewService.test.ts src/fork/pcb-preview/mcp.test.ts)
node_modules/.bin/vp lint apps/web/src/fork/pcb-preview apps/web/src/fork/model-preview-3d \
  apps/server/src/fork/pcb-preview packages/contracts/src/fork/pcb-workspace.ts \
  packages/contracts/src/fork/model-workspace.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, using one KiCad 10 board with through-hole and SMD parts on both
sides, and one tscircuit board:

1. Open 3D. Press `P`, then pick Top, Front and Right: ortho shows the outline as a rectangle
   and parts in true proportion. Press `P` again. In 2D, `P` does nothing.
2. Open the section, X axis, scrub across a connector: the board cut is filled and hatched;
   flip; toggle "Filled cut"; remove. Hide Top components with the section on: their cuts go.
3. Press `M`, hover a pad corner: the vertex marker shows. Click two opposite board corners:
   the label matches the board width from Inspect. `Alt` click: no snap. Clear. `Escape` leaves
   the tool, a second `Escape` closes the tool dock.
4. Height mode: click the top of the tallest part; compare with Heights. Look underneath and
   click a lead tip; "Below board" matches.
5. Heights: the tallest rows look right, clicking one selects the part in the panel and draws
   its height. On a board without part models, the empty state shows.
6. Toggle each Display item. Hide Solder mask and read copper. Hide Board and click where it
   was: nothing is picked. On the tscircuit board, Copper and Silkscreen are disabled.
7. Edit and save the board: it reloads with the same display, no old measurements, new
   heights.
8. Capture and "attach to draft" with ortho, a section and hidden layers: the image matches.
9. `?` in 3D lists only working keys.
10. Agent: `t3 pcb editor '{"action":"display","projection":"orthographic"}'`, then
    `section`, `display` with `layers3d`, `height` by reference and by board point,
    `measure` with two points, and `snapshot`; check the panel and the returned values.
11. Performance panel: no frames while idle, one per toggle; record the classify and heights
    time and the frame time with a section on, for the largest board at hand, in the PR.
12. Over a remote connection (Tailscale or T3 Connect), repeat steps 1, 3 and 10.

If L55 has landed, its "Tallest part" and L61's larger of "Above board" and "Below board" agree
on the same board to 0.05 mm.

Upstream T3 server: the PCB panel is unavailable.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge preview in [SEAMS.md](./SEAMS.md); expect no
conflicts. After merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
