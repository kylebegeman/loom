# L48 testing

Focused checks only. No repository-wide checks or browser/computer-use runs.

## Verification evidence (2026-10-10)

Core milestone: `aad16f087d`. Shared service and picker wiring is in the final integration milestone.

Repository assembly persistence and optimistic conflicts, operations, mesh transforms and worker checks, cancellation, scene isolation/material restoration/disposal, numeric editing and concurrent reload/undo behavior passed focused tests. The shared service regression creates and rediscovers an assembly and verifies persistence across service restart. External glTF buffer revisions are probed from metadata; cached geometry is reused without reading mesh bytes. Focused worker regressions cover clustering behavior.

The integrated MCP tests cover tool availability, disabled-agent gating, caller paths,
restore conflicts and undo, assembly operations, STEP output and Python execution grants.
RPC regressions verify that indirect Python execution cannot bypass terminal permission.
Targeted strict lint and affected package typechecks cover the shared integration.
Browser, desktop/GPU and remote-client interaction checks remain unverified.

The final server bundle passed host-worker smoke checks for translated bounds, a 1 mm
clearance and aligned volume overlap. Both workers terminated through the host finalizer.
Focused regressions preserve face, edge, vertex and cavity contact while detecting aligned
and coincident volume overlap. Bundled workers retain file URLs so shared chunks resolve.

## Focused commands

```sh
./node_modules/.bin/vp test run packages/contracts/src/fork/model-assembly.test.ts \
  apps/server/src/fork/model-preview-3d/assembly/operations.test.ts \
  apps/server/src/fork/model-preview-3d/assembly/service.test.ts \
  apps/server/src/fork/model-preview-3d/assembly/checker.test.ts \
  apps/server/src/fork/model-preview-3d/assembly/geometry.test.ts \
  apps/server/src/fork/model-preview-3d/check/assemblyChecks.test.ts \
  apps/server/src/fork/model-preview-3d/check/workerHost.test.ts \
  apps/web/src/fork/model-preview-3d/assemblyEditing.test.ts \
  apps/web/src/fork/model-preview-3d/useAssembly.test.tsx \
  apps/web/src/fork/model-preview-3d/viewer/assembly.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/server/src/fork/model-preview-3d/rpc.test.ts
```

The affected package typechecks are `@t3tools/contracts`, `@t3tools/client-runtime`,
`@t3tools/web` and `t3`. Run lint only on changed files, with `--deny-warnings`.

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3`, on web and desktop:

1. Export a board from the PCB view, then "New assembly" in the 3D picker, add a case SCAD and
   the board from `.loom/pcb-references/`. The board appears at real size.
2. Place the board with "Align to part" (on top of the case floor, offset 3 mm), give it a
   colour, isolate it, hide the case, show all. Check the file diff in the editor.
3. Change the case's wall parameter in Parts; only the case re-renders. Open the case file on its
   own and confirm its parameters did not change.
4. Edit the lid STL on disk (or ask an agent to); only the lid reloads.
5. Press `E`, drag the slider, capture a view exploded; press `E` again; markup returns.
6. Add a 0.3 mm clearance between board and case, "Check fit", click the result and confirm the
   camera frames the closest points; move the board 1 mm toward the wall and see the result go
   "Out of date", then "Intersects" after checking again.
7. Ask an agent to build a similar assembly with the update tool, check it and capture it
   exploded. Turn off "Let agents render models and propose variants" and confirm both tools
   refuse.
8. Two browser tabs on the same assembly: move a part in each; the second shows the conflict
   message.
9. From a remote browser over the tailnet: the assembly loads part by part; the check report
   arrives without downloading anything extra.
10. Light and dark themes, the narrow inspector sheet, and keyboard use of the Parts tab.
11. Open a single STL and a SCAD file: nothing changed.

Upstream server: the 3D panel is unavailable, nothing to check. Single-file executable build:
assemblies open and edit; "Check fit" and "Align to part" show "not available in this build".

## Merge safety

Run the merge check in SEAMS.md against the newest nightly; expect no conflicts. Run
`scripts/fork/loom.sh check`. After merge to `main`, Kyle runs
`scripts/fork/loom.sh integrate nightly --dry-run`.
