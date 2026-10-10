# L41 references

## Old Loom

No old Loom equivalent. L23 opens models only from the picker, the palette and the editor tool.

## Loom and upstream source this packet builds on

- `apps/server/src/orchestration-v2/CheckpointService.ts:443-486`: the checkpoint file summary,
  numstat with Git imports filtered out; `kind` is always "modified".
- `apps/server/src/orchestration-v2/CheckpointCaptureService.ts:63-135`: only root runs capture,
  with `appRunOrdinal: run.ordinal`; baselines carry no run.
- `apps/server/src/checkpointing/Diffs.ts:9-37`: numstat parsing; binary files (STL, 3MF, GLB)
  appear with zero counts, renames use the destination path.
- `apps/server/src/vcs/GitVcsDriver.ts:964-980`: the snapshot stages with `git add -A`, so
  ignored files never reach a checkpoint.
- `packages/contracts/src/orchestrationV2.ts:1200-1221`: `OrchestrationV2Checkpoint`.
- `apps/server/src/orchestration-v2/ProjectionStore.ts:364`: `getThreadRecords`.
- `apps/server/src/orchestration-v2/Orchestrator.ts:11195-11198`: `streamDomainEvents` starts at
  the latest stored event.
- `apps/server/src/fork/code-graph/reactor.ts:13-26` and
  `apps/server/src/fork/project-lifecycle/ProjectLifecycleService.ts:1282`: fork consumers of
  `checkpoint.captured` and other domain events.
- `apps/web/src/components/chat/ChangedFilesTree.tsx:24-115`: the changed files card.
- `apps/web/src/components/ChatView.tsx:5797-5835`, `ChatView.logic.ts:183-205`: proactive diff.
- `apps/web/src/rightPanelStore.ts:113-120`, `:306-317`, `:396-398`, `:624-648`: panel state,
  `upsertSurface`, the automatic-update rule, `openSurface` and `openProactive`.
- `apps/web/src/fork/model-preview-3d/Shortcuts.tsx:15-83`: agent panel requests.
- `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:126`, `:386-402`: the in-memory
  SCAD dependency map filled from OpenSCAD's `-d` output.
- `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1860-1905`: how fork code runs Git.

## External facts

- **Ignored files never reach a checkpoint.** "The `git add` command will not add ignored files by
  default." `-A` updates the index to match the working tree for the pathspec. Verified:
  https://git-scm.com/docs/git-add
- **Repository prefix.** `git rev-parse --show-prefix` prints the path of the current directory
  relative to the top of the repository, empty at the top. Verified:
  https://git-scm.com/docs/git-rev-parse. Also checked locally with Git 2.54 (prints `sub/`
  from a subdirectory).
- **OpenSCAD library search order.** `include` and `use` look in the including file's directory
  first, then in `OPENSCADPATH` and the library folders. The Libraries page lists
  `OPENSCADPATH` before the built-in and installation folders; the Include Statement page lists
  the installation folder first. Only the first step matters here, because only it is inside the
  workspace. `use` is allowed only at the top level; `include` may appear inside an expression.
  Verified:
  https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Libraries and
  https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Include_Statement
- **OpenSCAD `import()` formats.** STL, OFF, OBJ, AMF, 3MF, DXF, SVG and PDF (newer builds); JSON
  as data in development snapshots; relative paths resolve against the importing script; PNG
  heightmaps load with `surface()`. CSV is not supported (issue #6358 asks for raw text import).
  Verified: https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Importing_Geometry and
  https://github.com/openscad/openscad/issues/6358
- **OpenSCAD dependency output.** `-d file` writes Makefile-style dependencies; L23 already uses
  it. Verified: https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment

## Prior art

- T3 Code's own "Open diff" on the changed files card is the closest model and the pattern this
  chip follows. Other agent apps show per-turn changed files too (not verified in detail).
- VS Code's STL Viewer and similar preview extensions reopen on file change but do not know which
  edit came from an agent. Background only, nothing reused.

## Licences

Nothing external is reused. The SCAD reference parser is written from the OpenSCAD manual's
syntax description, not copied from OpenSCAD source (GPL-2.0).
