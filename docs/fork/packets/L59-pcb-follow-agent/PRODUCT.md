# L59 product

## Problem

Agents write and edit electronics designs: a new tscircuit board, a KiCad schematic fix, a
footprint swap. Today the only trace in the chat is the changed files card, which lists
`board.kicad_sch`, `board.kicad_pcb` and `board.kicad_pro` as three unrelated files. To look
at the result, the user opens the PCB panel (`Z` or the palette) and picks the design from the
design menu. When the agent edited a sub-sheet or a module the circuit imports, nothing on the
card even hints that a design changed.

## What the user can do

- See a chip on a turn's changed files card when the turn wrote or changed a PCB design:
  "Open board" for one design, "Open 3 designs" for several. The tooltip lists the designs and,
  for indirect changes, the file that caused it ("Changed power.kicad_sch").
- Click the chip to open the design in the PCB panel as the active tab. Several designs open as
  tabs, the first one active, at most 8.
- Dismiss the chip for that turn ("Hide for this turn").
- When PCB tabs are already open and a turn changes another design, get it as a background tab
  without losing the tab they are looking at.
- Choose in Settings what happens: "Offer to open" (default), "Open automatically", or "Do
  nothing".
- Run "PCB preview: Open designs from the last turn" from the command palette.
- See the design name on every PCB tab, including tabs an agent opened.

### How files map to designs

The panel already groups files into designs (`apps/server/src/fork/pcb-preview/discovery.ts`).
The offer uses the same grouping, so the user sees one entry per design, never per file.

| The turn changed                                              | Offer                          |
| ------------------------------------------------------------- | ------------------------------ |
| `board.kicad_pro`, `board.kicad_sch` or `board.kicad_pcb`     | The `board` project, written   |
| A standalone `.kicad_sch` or `.kicad_pcb` (no project file)   | That file, written             |
| A sub-sheet, `.kicad_sym`, `.kicad_mod`, `.kicad_dru`, tables | Each design that reads it      |
| `amp.circuit.tsx`, or the `mainEntrypoint` of a config        | That tscircuit design, written |
| A module, JSON or asset a tscircuit design reaches            | Each design that reads it      |
| Only code or docs unrelated to any design                     | No chip                        |

"Reads it" means the file is one of the design's sources: exactly the files whose change makes
the open panel reload (`sourceSnapshot`, `PcbPreviewService.ts:518-608`). A deleted design gets
no offer.

## Entry points

| Way in                                    | Way out                                  | Way to see it                |
| ----------------------------------------- | ---------------------------------------- | ---------------------------- |
| Chip on the changed files card            | Close the tab; "Hide for this turn" (X)  | Tab title is the design name |
| Background tab after a turn (panel open)  | Close the tab                            | Tab appears in the tab strip |
| "Open automatically" setting              | Setting back to "Offer to open" or "off" | Settings row shows the mode  |
| Palette "Open designs from the last turn" | Close the tab                            | Palette toast when none      |
| Agent `loom_pcb_editor` `open`            | Agent `close`, or close the tab          | Tab title is the design name |

Dismissal is per turn and per device, kept in local storage. There is no "undismiss": the
palette action and the design menu still reach the design.

## States

- Loading: the chip renders nothing until the lookup returns (cards render instantly; the chip
  appears a moment later). No spinner on the card.
- Empty: no designs changed, or the environment lacks the `pcb-preview` feature: no chip.
- Error: the lookup failed (not a Git workspace, thread deleted): no chip, one console
  warning. The card itself never shows an error for this.
- Disabled: mode "off" hides the chip and stops background tabs. A connection without the
  orchestration read scope cannot query; no chip.
- Stale: a design deleted after the turn has no offer. A design renamed since appears under its
  old id only if that file still exists. Older turns' chips stay correct because they read that
  turn's checkpoint, not the current tree.

## Surfaces and connection modes

Web and desktop. Mobile has no PCB panel. Local, remote and tunnel connections behave the same:
the lookup is one small RPC, and the stream sends one event per finished turn.

## Decisions

- One offer per design, using the panel's own grouping. A KiCad project is one design whose id
  is the `.kicad_pro` path. Users think in designs, and the panel opens designs.
- "Changed" means "one of the design's watched sources changed". One definition for the reload
  and the offer, and it catches sub-sheets and tscircuit imports.
- Written designs list before dependencies; at most 20 per turn, 8 opened at once.
- Default mode "Offer to open". Opening panels unasked is surprising; the chip costs nothing.
- No new agent tool. Agents already open designs with `loom_pcb_editor` `open`.
- The mode is a device preference beside the existing PCB preferences
  (`apps/web/src/fork/pcb-preview/preferences.ts:12-16`), because opening tabs is client
  behavior and PCB has no server settings record.
- Tabs a turn opens in the background do not render until shown: hidden PCB panels unmount
  (`PcbPreviewPanel.tsx:1597-1604`).

## Decisions needed from Kyle

1. **Create the `ext-changed-files` extension point.** L41 and L59 both add a chip to the same
   line of upstream's `ChangedFilesTree.tsx`; as two packet seams they would conflict on every
   merge. Recommendation: yes, a registry like `ext-diff-header`, created by whichever of L41
   and L59 lands first after approval. If L41 already landed its packet seam before approval,
   L59 converts that seam and registers both chips.
2. **A shared `apps/server/src/fork/turnFiles.ts`.** L41 specifies its checkpoint and prefix
   helpers as private to `ModelPreviewService`; `PCB-FOLLOW-UPS.md` says L59 must reuse them,
   and L49 and L66 need the same prefix helper. Recommendation: one shared fork module, owned by
   whichever packet lands first, and a line in both follow-up indexes naming it.
3. **Where the mode lives.** Recommendation: the device-local PCB preferences, as above. The
   alternative is L58's per-project server settings, which would make L59 depend on L58.
