# L57 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/pcb-preview/printPdf.test.ts` (new)             | `defaultPrintLayers` for both sides. `validatePrintLayers` drops unknown names with a warning, keeps `Edge.Cuts`, fails when nothing remains. `rewritePaper` replaces an existing `(paper "A3")`, inserts one when missing, leaves the rest byte-identical, and is a no-op for `"board"`. `scaleSheet` contains the 50 mm rectangle, six ticks, the hint text and the outline size, and omits the size when bounds are null. `printFileName` uses the title block revision, else 8 hex characters, and sanitises the stem. `pageWarnings` warns when bounds cross the page margin. `printArgs`: KiCad 10 adds `--scale 1` and `--check-zones`; KiCad 9 does not; `--mirror` and `--black-and-white` follow the options; `--mode-single` and `--drawing-sheet` are always present. |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (update) | `print` with a fake `run`: second call is a cache hit with no run; `save` writes `fab/print/<name>.pdf` and returns `workspacePath`; a design without a board fails `unsupported-view`; a failed run removes the temporary directory and surfaces the log; a tscircuit design without KiCad fails `tool-missing`; `sourceSnapshot` for a tscircuit design ignores files under `fab/`.                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/fork/pcb-preview/http.test.ts` (update)              | Signed `print.pdf` returns `application/pdf`; `board.glb` still `model/gltf-binary`; another basename in the cache directory is 404; an oversized PDF is 404.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (update)               | `loom_pcb_print` passes `save: true` by default and the caller's thread id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/server/src/fork/pcb-preview/realTools.test.ts` (update, opt-in) | With `LOOM_TEST_PCB_FIXTURES` set and KiCad installed: a fixture board prints to a PDF whose first bytes are `%PDF-`, on both sides.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/contracts/src/fork/pcb-workspace.test.ts` (new or update)   | `PcbPrintInput` decodes `{ threadId, designId }` to side top, paper board, black and white, no save; rejects 17 layers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/src/fork/pcb-preview/printDialog.logic.test.ts` (new)       | `initialPrintOptions` checks the side's defaults present on the board and turns mirror on for bottom; `isPrintStale`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

The permission maps are covered by the existing `commandPermissions.test.ts` loop. No component
markup tests.

## Commands

```sh
vp test run apps/server/src/fork/pcb-preview/printPdf.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/http.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts \
  packages/contracts/src/fork/pcb-workspace.test.ts \
  apps/web/src/fork/pcb-preview/printDialog.logic.test.ts
LOOM_TEST_PCB_FIXTURES=1 vp test run apps/server/src/fork/pcb-preview/realTools.test.ts
vp lint packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/server/src/fork/pcb-preview apps/web/src/fork/pcb-preview
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

The opt-in real-tool run needs KiCad on the machine; skip it and say so when absent.

## Manual checks for Kyle

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, on a machine with KiCad 9 and, if possible, KiCad 10:

1. Open a KiCad board. **…** > "Print at 1:1…", Top, defaults, "Create PDF". Print at 100%.
   The bar measures 50 mm with a ruler and the board outline matches the printed size label.
   Lay a real part (a USB connector or header) on its footprint.
2. Bottom: the text on the bottom silkscreen reads correctly (mirrored view), and the outline
   matches the top printout when held up to a light.
3. Paper A4 on a board whose page is A3: the board is inside the page, or the warning appears.
4. Print the same PDF with "Fit to page": the bar is visibly short of 50 mm, so the check works.
5. "Save to workspace": the file appears under `fab/print/`, the design does not show as changed,
   and "Open" and "Show in folder" work on desktop. From a remote browser over Tailscale,
   only Download is offered and it works.
6. KiCad 9 only: the zone warning shows; the result otherwise matches.
7. A tscircuit board: disabled without trust; with trust, prints.
8. Ask an agent to "print the bottom of the board at 1:1"; it returns a `fab/print/` path.
9. Cancel while running: the dialog returns to the form and no file is written.

Upstream server: no PCB panel, nothing to check. Mobile: no PCB panel.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
