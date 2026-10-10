# L66 testing

Focused tests, no repo-wide checks, no sleeps. Git tests use a temporary repository created in
the test (`git init`, commits, and `git update-ref refs/t3/orchestration-v2/checkpoints/...` to
stand in for checkpoints), never the developer's repositories. KiCad and tscircuit are not
needed: the service tests use the existing fake `ProcessRunner` for the tools and hand
`command === "git"` to a real Git process, as L49's tests do.

## Automated tests

| File                                                                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/model-preview-3d/historyRestore.test.ts` (new)          | Temp workspace and tree: several files written together with their modes; a symlink inside the root followed, one pointing outside refused before anything changes; a staging failure leaves the workspace untouched and no undo record; a failure on the second rename puts the first file back and removes the record; removals backed up and undone; undo restores bytes and recreates removed files; undo refuses when one file changed or a removed file reappeared; unknown id is `not-found`; prune keeps 20 and drops records older than seven days.                                                                                                                                                                                                                                                                           |
| `apps/server/src/fork/model-preview-3d/history.test.ts`, `historyGit.test.ts` | L49's tests (created by L49, or by L66 if it lands first), plus `UndoManifest` decoding a null `restoredOid` and `lsTree` with `recursive` listing files under a directory pathspec.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/server/src/fork/pcb-preview/designFiles.test.ts` (new)                  | Rules match today's regexes (one case per extension and table name). `designSet` over an in-memory `io`: KiCad seeds the stem group and tables, follows `Sheetfile` to nested sheets, expands `${KIPRJMOD}`, lists a `.pretty` directory from `fp-lib-table`, skips `${OTHER}` and paths outside the root or under `node_modules`; classifies design and supporting files; another design's files in the same folder are not included. tscircuit follows relative imports with extension and `index` resolution and asset strings; package files are supporting. Depth and the 2,000-file limit.                                                                                                                                                                                                                                       |
| `apps/server/src/fork/pcb-preview/history.test.ts` (new)                      | With a fake `ProjectionStoreV2` and a temp repository whose workspace is in `sub/`: `history` lists only turns touching the design's set, newest first with the start on the last page, `views` per version, `present: false` before the design existed, `latestTurn` from all turns, `threadRunning` from runs, equal `contentKey` for unchanged turns, `unavailable: "not-git"` outside Git, and a deleted ref dropped. `scopedRevisions` returns "Turn N" labels and never another thread's ref. `versionDesign`: the tree holds the version's sheets and project library, a neighbouring design's files are absent from the restore plan, the start version works, a rolled-back ref and another thread's checkpoint are `version-not-found`, LFS pointer and size limits fail with their messages, and a complete tree is reused. |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (update)         | `render` with `checkpointId` runs the tool with the source path inside the tree and returns sheets that `readSheet` serves; a live save during a version render does not fail it (frozen); a view absent at the version is `unsupported-view`; tscircuit Circuit JSON for a version is built from the tree (assert the fake runner's cwd); `asset` with `checkpointId` signs a GLB. `historyRestore`: dry run writes nothing and returns the plan with `editorLocks` when `~main.kicad_pcb.lck` exists; restore writes design files only by default, supporting files and removals only when asked; `conflict` on a changed key; agent path without the check. Live `render`, `asset` and `revisions` callers keep their results (existing tests).                                                                                     |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (update)                       | The two tools are listed; `restore_version` without `checkpointId` for plan or restore and without `undoId` for undo fails `invalid-parameters`; render and asset forward `checkpointId`; restore without `expectedContentKey` skips the check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/rpcAuthorization.test.ts` (existing)                    | Exhaustive scope check passes with the three rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/contracts/src/fork/pcb-workspace.test.ts` (new or update)           | `PcbHistory` and `PcbHistoryRestoreResult` decode; `limit` outside 1 to 50 fails; render and asset inputs without `checkpointId` still decode; editor state without `turnHistory` decodes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/src/fork/pcb-preview/history.test.ts` (new)                         | `historyChips` order, page merging and folding by `contentKey`; Now `matches`; `stepChip` from Now and at both ends; `viewingLabel` and `chipLabel` including "(not created yet)".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

No component markup tests. The strip, dialog and status label are thin over the tested helpers
and service.

## Commands

```sh
vp test run apps/server/src/fork/model-preview-3d/historyRestore.test.ts \
  apps/server/src/fork/model-preview-3d/history.test.ts \
  apps/server/src/fork/model-preview-3d/historyGit.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/designFiles.test.ts \
  apps/server/src/fork/pcb-preview/history.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  packages/contracts/src/fork/pcb-workspace.test.ts \
  apps/web/src/fork/pcb-preview/history.test.ts
vp lint packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/server/src/fork/pcb-preview apps/server/src/fork/model-preview-3d \
  apps/server/src/fork/rpcAuthorization.ts apps/web/src/fork/pcb-preview
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

`ModelPreviewService.test.ts` is listed because step 1 moves L49's restore code; drop it when L49
has not landed. The opt-in real-tool suite (`realTools.test.ts`, `LOOM_TEST_PCB_FIXTURES`) can
be run with a KiCad fixture to render a version with the real CLI.

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, in a Git workspace with KiCad installed:

1. In a new thread, ask the agent to create a KiCad project with a root sheet, then over several
   turns to add a `power.kicad_sch` sub-sheet, change the board, add a project symbol library,
   and change an unrelated file. Put a second KiCad design in the same folder and change it in
   one turn.
2. Open the design, press `T`. Start, the touching turns and Now appear; the unrelated turn and
   the other design's turn are absent. Hover a chip: time and changed files.
3. Press `[` and `]` on the schematic, switch sheets, switch to the board and 3D. Each shows the
   version, the label reads "Viewing turn N of M", and fast presses only render the last one.
   Before `power.kicad_sch` existed, its sheet is absent.
4. While viewing: notes, measure, capture, export, checks and parameters are disabled with the
   notice; pan, zoom, fit and layers work.
5. "Compare": the Compare tab opens with "Turn N" against the working tree and shows the
   changes. Compare's lists show turns and commits, no foreign refs.
6. Restore the version before the sub-sheet with "Also remove 1 file added since" checked. The
   project opens cleanly in KiCad and the design menu shows no stray `power` design. Undo puts
   everything back.
7. Open the board in KiCad, start a restore: the lock warning appears. Edit a file by hand
   after opening history: restore shows the conflict message.
8. Ask the agent to list history, render turn 3's board, plan and restore it, then undo. Run
   `t3 pcb history '{"designId":"..."}'` from the thread's terminal.
9. A tscircuit design: steps 2, 3 and 6 with an imported module changed in one turn.
10. A non-Git workspace shows "History needs a Git workspace." Roll the thread back one turn
    with the strip open: the removed chip disappears.
11. Repeat 2 and 3 from a second browser over the LAN or T3 Connect.

## Merge safety

Before the PR:

```sh
scripts/fork/loom.sh check
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

After merging, `scripts/fork/loom.sh integrate nightly --dry-run`.
