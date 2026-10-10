# L59 references

## Prior art in this repository

- [L41 `model-follow-agent`](../L41-model-follow-agent/): the same feature for 3D models.
  Turn checkpoint rules, background tabs, dismissal storage and the chip's look come from it.
- `ext-diff-header` (EXTENSION-POINTS.md entry 17,
  `apps/web/src/fork/diffHeader/registry.ts`): the registry shape `ext-changed-files` copies.
- PCB design grouping: `apps/server/src/fork/pcb-preview/discovery.ts:22-90`.
- PCB source set: `sourceSnapshot`, `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:518-608`.
- Turn checkpoints: `OrchestrationV2Checkpoint`, `packages/contracts/src/orchestrationV2.ts:1208`.

## File format facts

- **KiCad project files.** "KiCad expects the project file, schematic root sheet file, and
  board file to all have the same name", and a project holds a single board. Verified: KiCad 9
  manual, <https://docs.kicad.org/9.0/en/kicad/kicad.html#using_the_kicad_project_manager>.
  Hierarchical sheets are further `.kicad_sch` files referenced from a parent sheet's
  `Sheetfile` property; the repository relies on that already (`discovery.ts:19-21`), not
  re-verified here.
- **Project libraries.** The project-specific library table "is located in the project
  directory"; `sym-lib-table` and `fp-lib-table` list symbol and footprint libraries; and
  `${KIPRJMOD}` is the "absolute path to the current project directory". Verified: same
  manual, `#libraries-configuration`, `#schematic_editor_files`,
  `#board_editor_files_and_folders` and `#path-variables`. `sourceSnapshot` expands
  `${KIPRJMOD}` (`PcbPreviewService.ts:587`).
- **tscircuit entry points.** A `tscircuit.config.json` may name a `mainEntrypoint`; files
  ending `.circuit.tsx` are standalone circuits. This is the rule the repository's discovery
  code applies (`discovery.ts:63-87`). Not verified against the tscircuit docs
  (<https://docs.tscircuit.com/>); the packet only reuses the existing grouping.
- **Git prefix.** `git rev-parse --show-prefix`: "When the command is invoked from a
  subdirectory, show the path of the current directory relative to the top-level directory",
  with a trailing `/`, and an empty line at the top. Verified:
  <https://git-scm.com/docs/git-rev-parse#Documentation/git-rev-parse.txt---show-prefix>.

## Libraries

None new. Licences unchanged.
