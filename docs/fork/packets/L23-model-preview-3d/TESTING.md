# L23 testing

Focused tests only; no repo-wide checks; no sleeps. Watch and render tests wait on the emitted
event or the render result, with `TestClock` for debounce windows.

## Automated tests

Server (`apps/server/src/fork/model-preview-3d/`):

| Test file                     | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `signedFiles.test.ts`         | Round trip; tampered payload or signature rejected; expired rejected; `..`, absolute and encoded traversal paths rejected; a subfolder of `base` allowed; a symlink pointing outside `root` rejected (temp directory); `large` flag required for files over the limit.                                                                                                                                                                                                                                                                     |
| `customizer.test.ts`          | Numbers, strings, booleans, vectors; `// [min:max]`, `// [min:step:max]`, `// [a, b, c]`, `// [10:Small, 20:Large]`; description from the previous line; `/* [Group] */` and `/* [Hidden] */`; assignments after the first `module` ignored; expression values skipped; `validateLiteral` refuses `1; cube(9)` and unbalanced quotes, accepts escaped quotes.                                                                                                                                                                              |
| `openscad.test.ts`            | Version parsing (snapshot dates, `2021.01`); capability table; render argv (binstl always, backend per setting and version, `-P` before `-D`, summary flags only when supported, `-d` deps file); PNG argv per view; log parsing into levels; `ERROR:` with exit 0 counts as error; summary parsing with missing fields.                                                                                                                                                                                                                   |
| `renderCache.test.ts`         | Key changes with source, overrides, set, sidecar, version, backend, format and dependency mtimes; prune by count and by size, oldest first.                                                                                                                                                                                                                                                                                                                                                                                                |
| `ModelPreviewService.test.ts` | With a fake spawner and temp workspace: `listModels` filters and caps; `fileUrl` for a missing file fails `not-found`; a second `renderScad` for the same file cancels the first (`cancelled`) and returns the second; a cache hit returns `cached: true` without spawning; a timeout returns `error`; `saveParameterSet` merges into an existing sidecar and preserves other sets; `watch` emits on a write to the file (wait for the event) and on a change to a recorded dependency, and stops watching when the stream is interrupted. |
| `http.test.ts`                | The route serves bytes with the right `Content-Type` for a valid token, 404 for an invalid one, and 404 for traversal; uses the route layer with a test `ForkRuntime` context.                                                                                                                                                                                                                                                                                                                                                             |
| `store.test.ts`               | Params upsert and read; settings defaults; orphan sweep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `mcp.test.ts`                 | Tool name prefix; disabled tool error; missing OpenSCAD error; PNG argv per view (fake spawner).                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Web (`apps/web/src/fork/model-preview-3d/`):

| Test file              | Covers                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewer/load.test.ts`  | Loading the STL, OBJ and 3MF fixtures into geometry (triangle counts, bounding boxes in mm, 3MF unit scaling) in the test environment; if the web test environment lacks `DOMParser` for 3MF, run that case where it exists or mark it skipped with a reason. No WebGL needed: the loaders and bounding box math run without a renderer. |
| `viewer/views.test.ts` | Camera positions for iso, front, top, right; fit distance for a known box.                                                                                                                                                                                                                                                               |
| `params.test.ts`       | Form state to overrides (only changed values), reset, set selection.                                                                                                                                                                                                                                                                     |

No markup snapshot tests.

## Commands

```sh
vp test run apps/server/src/fork/model-preview-3d packages/contracts/src/fork apps/web/src/fork/model-preview-3d
vp test run apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts apps/web/src/fork/panels/registry.test.ts apps/web/src/fork/settings/registry.test.ts packages/contracts/src/fork/keybindings.test.ts
vp lint apps/server/src/fork/model-preview-3d apps/web/src/fork/model-preview-3d packages/contracts/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

## Manual check

With Kyle's permission (dev server, browser, OpenSCAD install):

1. Seed the worktree `.t3`, start `vp run dev` in the background.
2. In a thread whose workspace has `part.stl`, `part.3mf`, `model.glb` and `bracket.scad`: open
   the panel, pick each file. Orbit, views, wireframe, grid, dimensions look right; the STL is Z
   up on the grid.
3. Leave the browser idle for a minute on the panel: the browser's performance monitor shows no
   repaint activity.
4. Ask the agent to change `bracket.scad`: the view re-renders by itself; the log shows ECHO
   lines; a syntax error shows the error and keeps the last mesh marked stale.
5. Change a parameter slider: a render within a second or two; save a parameter set; the
   `bracket.json` sidecar contains it (and other sets are intact).
6. Capture four views: one image in the composer; send it; the agent describes the part.
7. Ask the agent to "render bracket.scad with the Loom 3D tool": it calls
   `loom_model_preview_3d_render` and reads the PNGs.
8. Remote: open over `vp run dev --share` from another machine; meshes load through the signed
   route; a copied URL stops working after it expires.
9. Upstream server: launcher disabled with its hint.
10. Close all 3D tabs: no fork file watchers remain (server log or a debug counter).

## Merge safety

Record the merge preview (SEAMS.md) and, after merge,
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`. With no packet
seams, conflicts can only be on extension point seams and the dependency lines.
