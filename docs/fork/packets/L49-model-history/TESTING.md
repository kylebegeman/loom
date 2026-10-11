# L49 testing

Focused checks only. No repository-wide checks or browser/computer-use runs.

## Verification evidence (2026-10-10)

Core milestone: `33d2e8f33f`. Shared viewer and service wiring is in the final integration milestone.

27 focused tests across backend, contract and client helpers passed. Temporary real Git workspaces cover checkpoint filtering, include/dependency closure, CAS restore, durable undo after restart, file modes, symlink retargeting, LFS rejection and cancellation. Historical rendering keeps live customizer and dependency state separate. History controls cover folding, stepping and comparison. Accepting an annotation records the checkpoint link; reopening clears it.

The integrated MCP tests cover tool availability, disabled-agent gating, caller paths,
restore conflicts and undo, assembly operations, STEP output and Python execution grants.
RPC regressions verify that indirect Python execution cannot bypass terminal permission.
Targeted strict lint and affected package typechecks cover the shared integration.
Browser, desktop/GPU and remote-client interaction checks remain unverified.

## Focused commands

```sh
./node_modules/.bin/vp test run packages/contracts/src/fork/model-history.test.ts \
  apps/server/src/fork/model-preview-3d/history/history.test.ts \
  apps/server/src/fork/model-preview-3d/history/ModelHistory.test.ts \
  apps/web/src/fork/model-preview-3d/history.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/server/src/fork/model-preview-3d/rpc.test.ts
```

The affected package typechecks are `@t3tools/contracts`, `@t3tools/client-runtime`,
`@t3tools/web` and `t3`. Run lint only on changed files, with `--deny-warnings`.

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, in a Git workspace with OpenSCAD installed:

1. In a new thread, ask the agent to create `bracket.scad` including `gear.scad`, then over
   several turns to change the bracket, change only `gear.scad`, change unrelated code, and
   export `bracket.stl`.
2. Open `bracket.scad`, press `T`. The strip shows Start (if the file existed), the touching
   turns and Now; the code-only turn is absent. Hover a chip: time and changed files.
3. Press `[` and `]`. The label reads "Viewing turn N of M", the camera stays put, the gear
   matches that turn. Press `[` quickly several times: only the last version renders.
4. While viewing: measure, annotate, capture, section toggle and the customizer are disabled;
   orbit, `1`-`4`, `W`, `G` work.
5. Compare with an older turn: ghost visible, delta in the status bar, section plane clips the
   ghost; "Stop comparing" removes it.
6. Restore an older turn with "Also restore included files": the files change in the editor and
   in `git diff`; the panel shows Now; Undo restores them. Edit `bracket.scad` by hand, then try
   to restore from a strip opened before the edit: conflict message, nothing written.
7. Accept an annotation after a turn: "Accepted in turn N"; "View turn N" selects it; Reopen
   clears it.
8. Open `bracket.stl`'s history over Tailscale or T3 Connect from another browser: versions load.
9. Ask the agent: "list the bracket's history, render turn 2 and compare it to now", then
   "restore gear.scad from turn 2" and "undo that". Ask it to show turn 2 in the panel with the
   editor command.
10. Roll the thread back past a version while the strip is open; select it: "no longer
    available", then the strip refreshes.
11. A project folder that is not a Git repository: the strip shows the Git message.
12. Light and dark themes; narrow panel (strip scrolls, buttons collapse to icons with labels in
    tooltips); keyboard only (`T`, `[`, `]`, Tab through chips, Enter selects).
13. Settings > Loom > 3D model > Clear cache: open history again; versions re-materialize; Undo
    from before the clear still works.

Against an upstream server: no History button, no errors.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge preview in SEAMS.md. L49 touches no upstream
file, so expect no conflict; still typecheck the server and web packages on the merged tree
because L49 imports `ProjectionStoreV2`, `isTerminalRunStatus` and `useThreadProjection` by
name. After merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
