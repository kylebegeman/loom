# L60 testing

The diff logic is pure and carries most of the risk, so it gets the tests. No sleeps, no
markup tests for the chip or overlay.

## Automated tests

| File                                                                                | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/pcb-changes.test.ts` (new)                             | Added, removed and value edits match today's `compareInspections` output. A part moved 5 mm on the board is `moved` with `fields: ["pcb"]` and `from`/`to`, not "pcb, pins". A move under `MOVE_TOLERANCE_MM` is no change. A 90 degree rotation in place is `changed` with `orientation`, not `pins`. A flip to the back side gives `pcb` and `orientation`. A pin whose net changed gives `nets`; the net lists show it as `joined` and `left`. A renamed net is one removed and one added. A schematic move to another sheet is `moved` with `schematic`. Order: added, removed, moved, changed, with `R2` before `R10`. `joined` caps at 50. `changeDetail` strings; `changeCounts`. |
| `apps/server/src/fork/pcb-preview/workbench.test.ts` (update)                       | The existing value case still gives `detail: "value"` (`:21-25`); a moved part gives `kind: "changed"`, `detail: "pcb"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/src/fork/pcb-preview/drawingDiff.test.ts` (new)                           | `diffRegions` on synthetic RGBA buffers: identical buffers give none; one changed pixel under `minPixels` gives none; a diagonal line of changed pixels gives one region (dilation joins cells); two distant blobs give two; 60 blobs give 50 largest with `truncated`; an alpha-only change counts; size mismatch throws.                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/src/fork/pcb-preview/changeMemory.test.ts` (new)                          | Keeps 8 designs, evicting the least recently used; drops drawings before entries past 16 MiB; `setDrawing` ignores a stale `sourceHash`; `get` refreshes recency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (update, if it asserts tool schemas) | `loom_pcb_editor` accepts `{ action: "changes", enabled: false }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

`drawingRegions` and the hook need a real canvas and SVG decoding, which the web test
environment does not provide faithfully; the manual check covers them.

## Commands

```sh
vp test run packages/contracts/src/fork/pcb-changes.test.ts \
  apps/server/src/fork/pcb-preview/workbench.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts \
  apps/web/src/fork/pcb-preview/drawingDiff.test.ts \
  apps/web/src/fork/pcb-preview/changeMemory.test.ts \
  apps/web/src/fork/pcb-preview/workspace.interactions.test.tsx
vp lint packages/contracts/src/fork apps/server/src/fork/pcb-preview \
  apps/web/src/fork/pcb-preview
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

`workspace.interactions.test.tsx` is the existing panel interaction suite; it must still pass
with the new key line and overlays.

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, with a KiCad project and a tscircuit design open in the PCB panel:

1. Move a part in KiCad and save. The chip appears; its tooltip says "1 moved". `D` shows a blue
   ring and arrow on the board; switch to the schematic: no ring (it did not move there).
2. Ask the agent to change a resistor value. Amber ring; list row "Changed: value".
3. Reroute one trace in KiCad. Chip shows; the list says "Drawing changed (1 area)"; one dashed
   box around the trace.
4. Save without changes (touch the file). No chip.
5. Hide the PCB tab, have the agent rotate a part, return. The chip shows "1 changed",
   orientation.
6. Two quick edits: the highlight shows only the second.
7. Turn on a custom layer set on a layered board, reload with a trace change: boxes appear only
   for the same layer set; change layers and the list says "unavailable".
8. Press `D` in 3D: nothing. Press `D` while the measure tool is active: toggles.
9. Linked view: rings show in both drawings.
10. Capture (`loom_pcb_editor` `capture`) while shown: the image has the highlights.
11. `t3 pcb editor '{"action":"snapshot"}'` lists the changes; `'{"action":"changes",
"enabled":false}'` hides them; on a fresh design, `changes` errors with "This design has
    not changed since it was opened."
12. Over a remote connection: the same, with no new network requests on reload beyond today's.

Watch a performance trace while highlights are shown and the board is idle: no repaint.

## Merge safety

Run `scripts/fork/loom.sh check` and the check in SEAMS.md. No upstream files change.
