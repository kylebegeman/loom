# L59 testing

Focused tests on the mapping rules and the shared module. No sleeps: stream tests await the
emitted element, and server tests use temp Git repositories.

## Automated tests

| File                                                                           | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/turnFiles.test.ts` (new)                                 | `repoPrefix` returns `""` at the top, `sub/` in a subfolder, `null` outside Git, and runs `git` once per root (cached). `workspaceFiles` strips the prefix and drops paths outside it. `turnCheckpoints` skips baselines (`runId` null), non-ready and empty checkpoints, picks a given run, and orders by `appRunOrdinal`. `turnCheckpointEvents` emits only `checkpoint.captured` for its thread.                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/pcb-preview/turnDesigns.test.ts` (new)                   | `designsForFiles` with a stub `snapshotFiles`: three files of one KiCad project give one written design with the `.kicad_pro` id; a standalone `.kicad_pcb` is its own design; a sub-sheet change gives the root project as a dependency with `via`; a `.kicad_sym` change hits only designs whose snapshot lists it; `amp.circuit.tsx` is written; a `tscircuit.config.json` `mainEntrypoint` design is written when its entry changes; an imported `lib/divider.ts` makes a dependency; Markdown-only changes return nothing without calling `discover`; written before dependencies; cap at 20 with `truncated`; more than 50 candidates stop walking and set `truncated`; a `source-limit` snapshot skips that design. |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (update)          | `sourceSnapshot` `files` equals the hashed set; `turnDesigns` on a temp repo whose workspace is a subfolder maps a real checkpoint through the prefix; an unknown thread fails like `listDesigns`; `runId: null` walks back to the newest turn with designs.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/server/src/fork/rpcAuthorization.test.ts` (update)                       | Both methods need the orchestration read scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/src/fork/pcb-preview/agentDesigns.test.ts` (new)                     | `pcbDesignName` for `.kicad_pro`, `.kicad_sch`, `.circuit.tsx` and a config entry `src/main.tsx`; `mayAffectDesigns` true for KiCad and tscircuit candidates, false for `README.md` and `.png`; `openDesigns` focus activates the first and adds the rest, caps at 8; background adds without activating and does nothing while the panel is closed; the dismissal list caps at 200 and keeps newest.                                                                                                                                                                                                                                                                                                                      |
| `apps/web/src/fork/pcb-preview/preferences.test.ts` (new)                      | A stored record without `agentDesigns` decodes with `"offer"` and keeps `selections` and `trusted`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/fork/changedFiles/registry.test.ts` (new)                        | Action ids are unique.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/src/components/chat/ChangedFilesTree.test.tsx` (existing, unchanged) | Still passes with the seam, rendering without a router.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

No markup tests for the chip.

## Commands

```sh
vp test run apps/server/src/fork/turnFiles.test.ts \
  apps/server/src/fork/pcb-preview/turnDesigns.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/helpers.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/web/src/fork/pcb-preview/agentDesigns.test.ts \
  apps/web/src/fork/pcb-preview/preferences.test.ts \
  apps/web/src/fork/changedFiles/registry.test.ts \
  apps/web/src/components/chat/ChangedFilesTree.test.tsx
vp lint apps/server/src/fork/turnFiles.ts apps/server/src/fork/pcb-preview \
  apps/server/src/fork/rpcAuthorization.ts apps/web/src/fork/pcb-preview \
  apps/web/src/fork/changedFiles apps/web/src/components/chat/ChangedFilesTree.tsx \
  packages/contracts/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

If L41 had landed, add its tests (`apps/server/src/fork/model-preview-3d/*.test.ts` that cover
turn models) to the first command after moving its helpers.

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, in a project with a KiCad project and a tscircuit package:

1. Ask the agent to change a resistor value in the schematic and move it on the board. The
   card shows "Open board". Click: the PCB panel opens on that design, tab titled "board".
2. Ask for a change to a hierarchical sub-sheet only. The chip offers the root project; the
   tooltip names the sub-sheet.
3. Ask for an edit to a helper module the tscircuit design imports. The chip offers it.
4. Ask for a README edit. No chip.
5. With a PCB tab open on design A, ask for a change to design B. B appears as a background
   tab; A stays active.
6. Set "Open automatically", close the panel, repeat step 1: the panel opens on the design.
7. Set "Do nothing": no chip, no tabs. Back to "Offer to open": chips return.
8. "Hide for this turn", reload the page: still hidden on that card only.
9. Palette: "Open designs from the last turn". In a thread without design changes: the toast.
10. Ask the agent to open a design with `t3 pcb editor`: the tab is titled.
11. Over a remote connection: the chip and background tabs behave the same.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md. The only upstream file is
`ChangedFilesTree.tsx`, through the extension point's two marked lines.
