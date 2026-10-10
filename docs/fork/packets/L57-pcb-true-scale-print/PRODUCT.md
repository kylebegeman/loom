# L57 product

## Problem

A footprint that looks right on screen can still be wrong: a mirrored connector, a pitch of
2.0 mm instead of 2.54 mm, a module whose pins miss its pads. The cheap check is a 1:1
printout with the real part laid on top. Doing that today means opening KiCad, finding the plot
dialog and remembering to turn off fit-to-page. Printers also scale silently, so a printout
without a reference can look right and be 3% small.

## What the user can do

- Choose **…** > "Print at 1:1…" in the PCB panel, pick Top or Bottom, and get a PDF.
- Adjust which layers print (defaults: copper, silkscreen, courtyard, outline), the paper size,
  whether the bottom is mirrored, and black and white or colour.
- Download the PDF, or save it to the workspace and open it on the host.
- Check the printout with a ruler: the scale bar must measure 50 mm, and the outline must match
  the printed board size.
- Ask an agent to make the same PDF ("print the bottom of the board at 1:1") and get its path.

## Entry points, with reverse states

| Entry point                        | Way in                                          | Way out                                                                 |
| ---------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| **…** menu, "Print at 1:1…"        | Opens the print dialog                          | Cancel or Escape closes it; a running export is cancelled               |
| Dialog, "Create PDF"               | Runs the export                                 | "Cancel" during the run; after it, "Change options" returns to the form |
| Dialog result, "Save to workspace" | Writes `fab/print/...pdf`                       | The file is an ordinary workspace file; delete it from the file tree    |
| Dialog result, "Download PDF"      | Saves through the browser                       | Nothing is kept by Loom beyond the cache                                |
| `loom_pcb_print`, `t3 pcb print`   | Same export; `save` defaults to true for agents | Same as above                                                           |

No keyboard shortcut. Printing is occasional and the menu is two clicks away.

## States

- Loading: "Creating PDF" with the existing `OperationStatus` row and Cancel. KiCad runs one job
  at a time, so the detail line says "KiCad processes one task at a time. A preview may finish
  first." (the Checks wording).
- Empty: a design without a board disables the menu item with the tooltip "This design has no
  board".
- Error: KiCad missing or too old, tscircuit not trusted, or the export failed. The dialog shows
  the message and the last lines of the tool log, with "Try again".
- Disabled: no terminal permission on this connection ("This connection needs permission to run
  terminal commands."), or a tscircuit design without trust or without KiCad.
- Stale: the result records the source hash. If the design changes while the dialog is open,
  the result shows "The design changed after this PDF was made" and "Create PDF" again.
- Warnings shown with a result: the board lies partly outside the chosen page; zones are
  printed as saved on KiCad 9.

## Surfaces and connection modes

Web and desktop, local and remote. Bytes always come from the signed route. Mobile has no PCB
panel and gets nothing. An upstream T3 server has no PCB panel, so nothing changes there.

## Decisions

- One side per PDF: a mirrored and an unmirrored side cannot share one KiCad run.
- Mirror the bottom by default: parts on the bottom are placed while looking at the bottom.
- Black and white by default: KiCad's default silkscreen colour is near invisible on paper.
- Scale bar on a generated drawing sheet, not in the board: no board layer is touched, so
  nothing the user drew on `User.Drawings` collides with it, and nothing can be saved by
  accident.
- Text on the sheet includes the outline size, so the ruler checks the board itself too.
- `fab/print/` for saved PDFs: next to the fab packages, visible in Finder (unlike `.loom/`),
  and excluded from the PCB source scan so saving does not change the design's hash.
- tscircuit goes through KiCad: KiCad is the only tool here with a scale-exact PDF plot. A
  browser-printed SVG depends on the browser's print scaling, which is the problem being solved.

## Decisions needed from Kyle

None. Gitignore advice for `fab/` is in L65 PRODUCT.md; L57 follows it.
