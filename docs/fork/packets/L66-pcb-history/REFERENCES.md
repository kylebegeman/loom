# L66 references

## Prior art in this repository

- [L49 model history](../L49-model-history/): the history service, Git plumbing, candidates,
  restore with undo, the strip and its keys. L66 reuses the service and mirrors the UI.
- [L24 PCB workspace](../L24-pcb-preview/) and the
  [user guide](../../user/pcb-preview.md): render, `readSheet`, signed GLBs, compare,
  revisions, editor bridge, MCP and CLI parity.
- [PCB-FOLLOW-UPS.md](../PCB-FOLLOW-UPS.md): key allocation (`T`, `[`, `]`), shared
  definitions ("File versions from turn checkpoints, and restoring one file: L49, used by L66").
- Checkpoint refs and rows: `apps/server/src/orchestration-v2/CheckpointService.ts:26`,
  `:161-172`; `packages/contracts/src/orchestrationV2.ts:715-727` (scopes), `:1209-1222`
  (checkpoints); subject `t3 checkpoint ref=...` at `apps/server/src/vcs/GitVcsDriver.ts:1051`.
- PCB service: `apps/server/src/fork/pcb-preview/PcbPreviewService.ts` (`workspace` `:276-301`,
  `resolveDesign` `:500-516`, `sourceSnapshot` `:518-608`, `runRender` `:704`, `render`
  `:977-996`, `readSheet` `:997`, `runAsset` `:1560`, `asset` `:1775-1787`, `git` `:1860-1881`,
  `revisions` `:1907-1932`, `compare` `:1933`, `applyParameters` `:2217`).
- Panel: `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx` (key handler `:1041-1064`, status
  bar `:1320`), `RevisionCompare.tsx`, `usePcbPreview.ts`, `Board3D.tsx`,
  `WorkspaceChrome.tsx:252-261` (shortcut list).

## External facts

Verified against official documentation on 2026-10-10.

- **KiCad lock files.** KiCad creates a lock file named `~<file name>.lck` beside an open
  schematic, board or project (for example `~main.kicad_pcb.lck`), created exclusively and
  containing the user and host. A stale one can remain after a crash. Source:
  [KiCad `lockfile.h`](https://docs.kicad.org/doxygen/lockfile_8h_source.html). Used for the
  restore warning; a stale lock only produces a warning, never a refusal.
- **`${KIPRJMOD}`.** Always expands to the current project directory and cannot be redefined;
  project library tables (`sym-lib-table`, `fp-lib-table` in the project folder) use it to
  reference project-local libraries. Source:
  [KiCad 9.0 manual](https://docs.kicad.org/9.0/en/kicad/kicad.html) and
  [Getting Started in KiCad 8.0](https://docs.kicad.org/8.0/en/getting_started_in_kicad/getting_started_in_kicad.html).
- **Hierarchical sheets.** A sheet carries mandatory sheet name and file name properties.
  Source: [KiCad schematic file format](https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/index.html).
  The property name `Sheetfile` is what L24's parser already matches
  (`PcbPreviewService.ts:583`); the format page does not spell it out.
- **Git plumbing.** `update-index --index-info` with `GIT_INDEX_FILE`, `checkout-index
--prefix`, `ls-tree -r -z -l --full-name`, `hash-object`, `rev-parse --show-prefix`,
  `GIT_LITERAL_PATHSPECS`, shared refs across worktrees and `GIT_LFS_SKIP_SMUDGE`: see
  [L49 REFERENCES.md](../L49-model-history/REFERENCES.md), which links the official pages.
  The only new flag here is `ls-tree -r`, which recurses into subtrees:
  [git-ls-tree](https://git-scm.com/docs/git-ls-tree).

Unverified: whether KiCad 9 reloads a board when its file is replaced while open. The packet
does not depend on it; it warns instead.

## Licences

Git (GPL-2.0) and KiCad (GPL-3.0) are invoked as separate programs on the environment host, as
L24 already does. No code is copied and no dependency is added.
