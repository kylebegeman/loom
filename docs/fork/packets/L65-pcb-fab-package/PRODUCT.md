# L65 product

## Problem

Ordering a board means producing a dozen files in the right formats: Gerbers for each layer,
drill files, a BOM and a placement file in the fab's column layout, plus an assembly drawing for
whoever solders it. In KiCad that is three dialogs with settings that are easy to get wrong
(Protel extensions, drill units, separate plated holes, zone refill). JLCPCB's assembly service
wants its own column names and has parts whose library orientation differs from KiCad's, so
rotations come out wrong unless corrected. Mistakes are found after the fab's review, or after
the boards arrive. When an agent designed the board, Kyle also wants the agent to be able to
produce and check the package itself.

## What the user can do

- Choose **…** > "Create fab package…" or open the **Fabrication** tab and choose "Create
  package". Pick a profile (Generic or JLCPCB), optionally a fab to check against (with L64),
  and whether to include assembly files.
- Watch it run, then read the checklist: outline closed, layer count, drill files, DRC, ERC,
  zones refilled, BOM matches placement, LCSC numbers present (JLCPCB), fab check, and the manual
  items (polarity and pin 1, rotations in the fab's preview).
- Download the Gerber zip from any browser, or open the folder on the host.
- "Preview outputs": the canvas shows the produced Gerbers as the fab sees them, top and bottom,
  and layer by layer. "Back to design" returns.
- Revisit earlier packages in the Fabrication tab, with their verdicts.
- Ask an agent to "make a JLCPCB package and fix anything the checklist flags".
- Correct a JLCPCB rotation by adding a `JLCPCB Rotation Offset` field to the part in KiCad, or a
  line to `fab/rotations.csv`, then creating the package again.

## Entry points, with reverse states

| Entry point                                     | Way in                                         | Way out                                                  |
| ----------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| **…** menu, "Create fab package…"               | Opens the Fabrication tab with the create form | Close the tab or choose another                          |
| Fabrication tab, "Create package"               | Runs the build                                 | "Cancel" while running; nothing is left behind           |
| Package row, "Preview outputs"                  | Canvas shows the Gerbers                       | "Back to design" or Escape                               |
| Package row, "Download zip"                     | Saves the Gerber zip                           | Nothing kept by the client                               |
| Package row, "Show in folder"                   | Opens the host's file manager                  | Nothing to undo                                          |
| Package row, "Delete"                           | Asks, then removes the package folder          | The folder is gone; create it again from the same design |
| `loom_pcb_fab_package`, `loom_pcb_fab_packages` | Same for agents                                | Agents delete through the file system like any file      |

No keyboard shortcut. Packaging is occasional.

## States

- Loading: "Loading packages" while the list loads; "Creating fabrication package" with Cancel
  and the detail "Gerbers, drill, BOM, placement, drawings and checks. This can take a minute."
- Empty: "No fabrication packages yet", the create form, and one line: "Packages are written to
  fab/ in this project. Add /fab/*/ to .gitignore to keep them out of commits."
- Error: KiCad or tscircuit missing or too old, a step failed or timed out (the message names the
  step and shows its log), or the workspace is not writable.
- Disabled: no board ("A fab package needs a board"); no terminal permission ("This connection
  needs permission to run terminal commands."); tscircuit until the design is trusted.
- Stale: a package whose source hash differs from the current design shows "Made from an earlier
  version" and keeps its actions.
- Verdict: "Ready" (all automated items pass; manual items listed), "Needs review" (warnings),
  "Not ready" (a failing item, such as DRC errors or a missing outline).
- Preview: loading spinner per layer set; "Preview unavailable" with the reason when a file
  cannot be parsed; the fallback label "Board plot of the packaged layers" when the Gerber
  renderer is not installed.

## Surfaces and connection modes

Web and desktop, local and remote. Mobile has no PCB panel. Upstream servers have no PCB panel.

## Decisions

- One folder per package, never overwritten: earlier packages stay comparable, and a package
  sent to a fab is a record. A same-day rebuild gets a `-2` suffix; an identical source and
  profile returns the existing package.
- Outputs in the workspace `fab/` folder: the files are the user's, visible in Finder and the
  file tree, and agents can read them. They are not committed by Loom.
- The zip holds Gerbers and drill files only: that is what fab uploaders take. BOM and CPL are
  uploaded separately at the assembly step.
- Protel extensions, X2 attributes, millimetre Excellon with separate plated and non-plated
  files: matches JLCPCB's KiCad guide and is accepted by PCBWay and OSH Park.
- BOM from the schematic through kicad-cli when there is one: it carries every symbol field. A
  board-only design gets a BOM from footprint properties.
- Rotation corrections from per-part fields and a project file only: corrections depend on the
  JLCPCB part chosen, so they belong to the design.
- In-house zip writer: about 120 lines on Node's built-in `zlib`, instead of a dependency.
- Preview renders the produced files, not the design: catching output mistakes is the point.
- Preview in a web worker: Gerber parsing is CPU heavy and the T3 server must stay responsive.
- Never uploads or orders: PCB-FOLLOW-UPS.md rules out network calls to fabs.

## Decisions needed from Kyle

1. **Gerber renderer for the preview.** Recommendation: approve `pcb-stackup` 4.2.8 (MIT,
   tracespace; about 24,000 downloads a month) as an `apps/web` dependency, loaded only inside
   the preview worker. It is unmaintained since 2022 but the Gerber and Excellon formats it reads
   are stable. Alternatives: `@sctg/pcb-stackup` 5.1.6, a maintained MIT fork with one
   maintainer and about 480 downloads a month; or no renderer, and the preview shows KiCad's board
   plot of the packaged layers (works today, but is not the output files).
2. **Rotation table.** Recommendation: ship no built-in table. Use per-part fields and a
   project `fab/rotations.csv` the user or agent maintains, and keep the manual "check rotations
   in JLCPCB's preview" item. Alternative: bundle Fabrication Toolkit's `rotations.cf`
   (Apache-2.0, needs attribution), which fixes common parts but can rotate a correct part.
3. **`fab/` and `.gitignore`.** Recommendation: Loom never edits `.gitignore`; the empty state
   and docs suggest `/fab/*/`, which ignores package folders and `fab/print/` but keeps
   `fab/rotations.csv`.
