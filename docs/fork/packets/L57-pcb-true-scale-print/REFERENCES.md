# L57 references

## Prior art

- KiCad's own Plot dialog and Print dialog both offer 1:1 output; Print also has "Fit to page",
  which is the usual cause of wrong-size printouts.
- Hobbyist practice ("print the footprint and lay the part on it") is common in KiCad and
  EEVblog forums. The Electronics app plan (`~/Developer/docs/apps/electronics/`) lists it as a
  signoff step. Research only.

## Verified facts

kicad-cli flags below are from the official reference. KiCad is not installed on the machine
where this packet was written, so none were executed locally.

- `kicad-cli pcb export pdf` in KiCad 10.0 (docs built from 10.0.7):
  `-o/--output`, `-l/--layers` (at least one), `--cl/--common-layers`, `--drawing-sheet`,
  `-D/--define-var`, `-m/--mirror`, `--erd`, `--ev`, `--ibt/--include-border-title`,
  `--subtract-soldermask`, `--sp`, `--hdnp`, `--sdnp`, `--cdnp`, `-n/--negative`,
  `--black-and-white`, `-t/--theme`, `--drill-shape-opt 0|1|2` (default 2), `--mode-single`,
  `--mode-separate`, `--mode-multipage`, `--scale` (0 is autoscale; "The border and title block
  are not scaled"), `--bg-color`, `--check-zones` (refills zones before plotting; the board is
  not saved), `--variant`.
  <https://docs.kicad.org/10.0/en/cli/cli.html>
- KiCad 9.0 (docs built from 9.0.9): `pcb export pdf` has the mode and mirror flags and
  `--drawing-sheet`, but no `--scale` and no `--check-zones`.
  <https://docs.kicad.org/9.0/en/cli/cli.html>
- kicad-cli has no command to print; output is a file. Top-level commands are `fp`, `jobset`,
  `pcb`, `sch`, `sym`, `version` (KiCad 10 reference).
- Drawing sheets (`.kicad_wks`) are edited with KiCad's Drawing Sheet Editor and support lines,
  rectangles and text anchored to page corners.
  <https://docs.kicad.org/10.0/en/pl_editor/pl_editor.html>
- tscircuit `tsci export -f kicad_pcb` exists (formats listed by `tsci export --help` docs).
  <https://docs.tscircuit.com/command-line/tsci-export>

## Unverified, check during implementation

- The exact `.kicad_wks` S-expression grammar for `rect`, `line` and `tbtext` with `lbcorner`.
  Save a sheet from the Drawing Sheet Editor and copy its form.
- Whether `pcb export pdf --mode-single --scale 1` keeps the board at its editor position on
  the page or centres it. `pageWarnings` assumes editor coordinates.
- KiCad 9's PDF scale when the project has never been plotted (expected 1:1 by default).
- Whether a `.kicad_pcb` produced by `tsci export -f kicad_pcb` carries courtyard layers and a
  valid page size. If courtyards are absent, the dialog shows them unchecked.
- Electron's main-window download behaviour for a Blob `<a download>`: expected to show the
  save dialog.

## Licences

No code or data is copied. KiCad (GPL-3.0) and tscircuit (MIT) run as separate host
processes, as in L24.
