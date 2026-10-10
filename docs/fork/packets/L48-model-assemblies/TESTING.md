# L48 testing

Focused tests, no repo-wide checks, no sleeps. Geometry is built in code so each case states its
shape; the server tests use the existing in-memory file system and fake OpenSCAD runner from
`ModelPreviewService.test.ts`.

## Automated tests

| File                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/model-assembly.test.ts` (new)                   | A minimal file (`format`, `version`, `name`) decodes with empty parts and clearances; a part with only `id`, `name` and `path` gets the defaults; a rotation of 400 and a colour `#FFF` fail. `validateAssembly` reports duplicate ids, a clearance naming a missing part, a pair listed twice in either order, parameters on an STL part and a path escaping the workspace, each with its JSON path. `resolvePartPath("a/b.loom-assembly.json", "../parts/c.stl")` is `parts/c.stl`; `"../../x.stl"` from `a/` is null; `relativePartPath` inverts it. `partMatrix` with rotation `[90, 0, 0]` maps (0, 1, 0) to (0, 0, 1) and matches three.js `Euler("XYZ")`. `composeRotation([0, 0, 90], [90, 0, 0])` equals rotating by Z then by world X. `alignPosition` for each mode on each axis, with offsets, and the origin target. `slugId` collisions.                                             |
| `apps/server/src/fork/model-preview-3d/assemblyOps.test.ts` (new)            | Every operation on a small document; `remove-part` removes its clearances; `set-clearance` upserts by unordered pair; a failing third operation leaves the input unchanged and names `operations[2]`; the 33rd part fails; `align` with a fake `bounds` returns the expected position after an earlier `move-part` in the same call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/server/src/fork/model-preview-3d/assembly.test.ts` (new)               | Read: revision is a content hash (same size and mtime, different bytes, different revision); an invalid file reports the first issue's path; a missing part has an error and the read still succeeds; STEP and nested assembly parts get their messages; version 2 is read-only. Write: creates a missing file from `set-name`; `expectedRevision` mismatch is `conflict`; two concurrent updates both apply in order (the second sees the first's revision); output is two-space JSON with a trailing newline and stable key order (snapshot of one small file); unknown fields are dropped; no temp file remains after success or failure. Listing includes assemblies and `.loom/pcb-references/*.glb`, deduplicated. Bounds: a cube rotated 45 degrees about Z has the exact rotated extent (not the box of the box); SCAD bounds without rotation use the render summary and skip the worker. |
| `apps/server/src/fork/model-preview-3d/check/interfere.test.ts` (new)        | Two cubes apart: `clear`. Overlapping by 1 mm: `intersects`, one region at the overlap. Face to face: `touching`. Edge on face: `touching`. A small cube inside a closed box: `inside`; inside an open box: `clear` with `complete: false`. A lid sunk 0.2 mm into a rim: `intersects` with regions along the rim, at most ten. A triangle crossing many grid cells is tested once per A triangle (test hook count). The test cap stops a pair with `complete: false`.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/fork/model-preview-3d/check/distance.test.ts` (new)         | Triangle distance for parallel offset triangles, edge to edge (skew), vertex to face and intersecting (zero), against hand-computed values within 1e-9. Clearance search: two cubes 0.25 mm apart with 0.3 required give 0.25 and `tight`, closest points on the facing faces; 5 mm apart give `atLeastMm` without a narrow phase (test hook count is zero); a box gap of exactly the requirement is `ok`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/fork/model-preview-3d/check/workerHost.test.ts` (update)    | The real worker from source answers a `bounds` request and an `assembly` request on in-code meshes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (update) | `checkAssembly` renders a SCAD part with `asmchk-...` variant ids, which neither interrupt a concurrent panel render of the same file nor save last-used parameters; the second identical call is `cached: true`; moving a part changes the key; `cancelPrintCheck` with the request id returns `{ status: "cancelled" }`; the triangle cap fails before the worker starts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/model-preview-3d/mcp.test.ts` (update)                 | Both tools call their service methods with the caller's thread, and refuse when `agentToolEnabled` is false. `assembly_update` decodes `{ "op": "move-part", ... }` from plain JSON.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/src/fork/model-preview-3d/viewer/assembly.test.ts` (new)           | `explodeOffset`: factor 0 is zero; a part right of centre moves right by `v + 0.15 d` at factor 1; a part's own `explode` vector is used as is; a part at the centre moves up. `createAssemblyScene` without a renderer: `setPart` applies the matrix, `setIsolated` hides other parts and restores them, a colour override and "File colour" restore the original materials, `partAt` finds the id from a nested mesh, `assembledBox` ignores explode.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/src/fork/model-preview-3d/useAssembly.test.ts` (new)               | Pure helpers only: `diffAssembly(previous, next)` classifies changes into in-place, reload, add and remove; `fitRequestKey` changes with revisions, transforms, pairs and clearances, and not with colour or explode; the load queue respects concurrency 4 and the triangle budget.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/src/fork/model-preview-3d/ModelInspector.test.ts` (update)         | `inspectorTabs("assembly")` is parts, fit, markup, views; `"mesh"` and `"scad"` are unchanged from today; `resolveInspectorTab("part", "assembly")` is `parts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

No component markup tests.

## Commands

```sh
vp test run packages/contracts/src/fork/model-assembly.test.ts \
  apps/server/src/fork/model-preview-3d/assemblyOps.test.ts \
  apps/server/src/fork/model-preview-3d/assembly.test.ts \
  apps/server/src/fork/model-preview-3d/check \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/web/src/fork/model-preview-3d/viewer/assembly.test.ts \
  apps/web/src/fork/model-preview-3d/useAssembly.test.ts \
  apps/web/src/fork/model-preview-3d/ModelInspector.test.ts \
  apps/web/src/fork/model-preview-3d/viewer/ViewerCanvas.test.tsx
vp lint packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/server/src/fork apps/web/src/fork/model-preview-3d apps/web/src/fork/commandPalette
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
scripts/fork/loom.sh check
```

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
