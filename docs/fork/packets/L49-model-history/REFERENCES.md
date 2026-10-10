# L49 references

## Old Loom

No old Loom equivalent. L23 shows only the live file. The PCB preview lists Git commits and
`refs/t3/` refs for comparisons (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1907-1932`),
which is the closest precedent; L49 differs by scoping to the thread and materializing a closure.

## Loom and upstream source this packet builds on

- `apps/server/src/orchestration-v2/CheckpointService.ts:26`, `:161-172`: checkpoint ref names.
- `apps/server/src/orchestration-v2/CheckpointService.ts:333-345`: baseline checkpoints carry no
  run and no turn number.
- `apps/server/src/orchestration-v2/CheckpointService.ts:443-486`: each checkpoint's `files`
  are the paths the turn's own work touched (Git imports filtered out); `kind` is always
  "modified".
- `apps/server/src/orchestration-v2/CheckpointCaptureService.ts:107-135`: the thread start
  baseline at ordinal 0 and turn checkpoints at `appRunOrdinal: run.ordinal`.
- `apps/server/src/orchestration-v2/CheckpointRollbackService.ts:262-278`: rollback deletes the
  refs of later checkpoints, so content is cached by tree id, not ref name.
- `apps/server/src/checkpointing/Diffs.ts:9-37`: numstat parsing; renames use the destination.
- `apps/server/src/vcs/GitVcsDriver.ts:964-980`, `:1214`: snapshots stage with `git add -A`;
  checkpoint paths are repository-relative.
- `packages/contracts/src/orchestrationV2.ts:715-727`, `:1200-1221`, `:1791-1816`: checkpoint
  scope, checkpoint and thread projection schemas.
- `apps/server/src/orchestration-v2/ProjectionStore.ts:295-312`, `:364`: `getThreadRecords`.
- `apps/server/src/orchestration-v2/ThreadManagementService.ts:399`: `isTerminalRunStatus`.
- `packages/client-runtime/src/state/threadCheckpoints.ts:29-55`: how the diff UI turns
  checkpoints into turn rows (same filter: `appRunOrdinal` and `runId` set).
- `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts`: `resolveWorkspace` `:142-167`,
  `sign` `:179-201`, `readSidecar` `:204-216`, `prune` `:334-356`, `runRender` `:403-586`,
  `renderScad` `:587-622`, `updateWorkspaceMany` `:805-839`, `clearCache` `:1082-1103`,
  `renderImages` `:1104-1254`.
- `apps/server/src/fork/model-preview-3d/signedFiles.ts:15-53`: token claims and containment.
- `apps/server/src/fork/model-preview-3d/renderCache.ts:27-58`: `pruneList`,
  `createStemProtection`.
- `apps/server/src/processRunner.ts:19-40`: runner options (`stdin`, `env`, `timeoutBehavior`).
- `apps/server/src/fork/model-preview-3d/mcp.ts:14-229`, `cli.ts:5-15`: tools and the CLI.
- `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`: state `:90-140`, mesh effects
  `:470-536`, `editDisabled` `:539`, actions `:651-657`, key handler `:718-772`, canvas
  `:845-864`, status bar `:1135-1162`.
- `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:356`, `:452`, `:513-532`;
  `viewer/load.ts:46-60`, `:163`; `viewer/ViewerCanvas.tsx:105-154`.
- `apps/web/src/fork/model-preview-3d/MarkupSection.tsx:385-408`: Accept and Reopen.
- `apps/web/src/state/entities.ts:126`: `useThreadProjection`.

## External facts

All verified on 2026-10-10 unless labelled.

- **Temp-index export.** `git update-index --index-info` reads `mode SP type SP sha1 TAB path`
  (ls-tree format) or `mode SP sha1 TAB path`; with `-z` paths are NUL-separated.
  https://git-scm.com/docs/git-update-index
- **Checkout to a prefix.** `git checkout-index --prefix=<dir>/ -a` "will 'export' the index
  into the specified directory"; `-f` overwrites existing files.
  https://git-scm.com/docs/git-checkout-index. The page does not mention attributes; that
  `checkout-index` applies eol and smudge filters was checked locally with Git 2.54 before this
  packet was written (a `text eol=crlf` file came out with CRLF).
- **Alternate index.** `GIT_INDEX_FILE` "specifies an alternate index file".
  https://git-scm.com/docs/git
- **Literal pathspecs.** `GIT_LITERAL_PATHSPECS=1` makes Git "treat all pathspecs literally,
  rather than as glob patterns", recommended for paths taken from `git ls-tree`.
  https://git-scm.com/docs/git
- **`git ls-tree`.** Path arguments are patterns relative to the current directory;
  `--full-name` prints full paths; `-l` adds the blob size; `-z` gives unquoted, NUL-terminated
  records. https://git-scm.com/docs/git-ls-tree. Listing a nested file path without `-r` was
  checked locally with Git 2.54.
- **`git hash-object`.** For file arguments, input filters chosen by attributes (including eol
  conversion) are applied unless `--no-filters`, so the id matches what `git add` stores.
  https://git-scm.com/docs/git-hash-object
- **Shared refs across worktrees.** "all refs starting with `refs/` are shared", except
  `refs/bisect`, `refs/worktree` and `refs/rewritten`, so `refs/t3/...` checkpoints are visible
  from every worktree. https://git-scm.com/docs/git-worktree
- **Repository prefix.** `git rev-parse --show-prefix` prints the current directory relative to
  the top. https://git-scm.com/docs/git-rev-parse
- **Git LFS pointers.** The first key is always `version`, the v1 value is
  `https://git-lfs.github.com/spec/v1`, and "Pointer files must be less than 1024 bytes".
  https://raw.githubusercontent.com/git-lfs/git-lfs/main/docs/spec.md
- **Skipping LFS smudge.** `GIT_LFS_SKIP_SMUDGE` makes Git LFS skip converting pointers to
  objects on checkout, in both `git lfs smudge` and `git lfs filter-process`.
  https://www.mankier.com/1/git-lfs-smudge and the git-lfs-config description quoted there.
- **OpenSCAD include and import resolution.** Relative to the including file's directory first,
  then `OPENSCADPATH` and library folders; `import()` reads STL, OFF, OBJ, AMF, 3MF, DXF, SVG
  and PDF. See [L41's REFERENCES.md](../L41-model-follow-agent/REFERENCES.md) for links.

Not verified: whether a custom filter driver in a user's Git config could be slow or prompt
during `checkout-index`. The 30 second timeout bounds it.

## Prior art

- Onshape and Fusion keep a version history per document with "restore" and compare views;
  this packet's strip follows the same idea at turn granularity (product pages, not checked in
  detail).
- VS Code's Timeline view lists local file history and Git commits for one file, with "Compare
  with file" and "Restore contents" (behavior known from use, not re-checked for this packet).
- T3 Code's own diff panel already shows per-turn file diffs; L49 is the 3D counterpart.

## Licences

Nothing external is reused. Git is invoked as a separate program (GPL-2.0, no linking). The
SCAD reference parser is shared with L41 and written from the OpenSCAD manual, not copied from
OpenSCAD source (GPL-2.0).
