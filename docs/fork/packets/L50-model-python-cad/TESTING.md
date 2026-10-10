# L50 testing

Focused tests only. No repo-wide checks, no sleeps. Unit and service tests use a fake process
runner with fixture runner output, so CI needs no Python. The real-runner test runs only where
an interpreter with build123d exists, like `realOpenScad.test.ts`.

## Automated tests

- `packages/contracts/src/fork/model-formats.test.ts`
  - `modelFormatOf`: `a.b3d.py` is `build123d`; `a.py` and `a.b3d` are null; `A.STP` is `step`;
    every existing extension maps as before.
  - Settings saved before L50 decode with `pythonPath: null`.
  - `pythonInstallCommands` quotes a path with spaces.
- `apps/server/src/fork/model-preview-3d/python/inspect.test.ts` (fixture runner output)
  - Maps number, integer, boolean, string, `Literal` with labels, and vector parameters onto
    `ScadParameter` with ranges, steps, groups and descriptions.
  - Skipped parameters become warnings; `no-model` becomes the "needs a `def model(...)`"
    error.
  - Results are cached by source hash: a second call does not run the runner.
- `apps/server/src/fork/model-preview-3d/python/environment.test.ts` (fake runner)
  - A configured path wins; otherwise the managed path; probe results are cached and reset by
    `updateSettings`.
  - Install runs the two commands into a pending folder and renames it only after a good probe;
    a failing probe leaves `broken` with the last line and no `venv` folder.
  - Interrupting install removes the pending folder (await the fiber exit; no sleeps).
  - A second install while one runs waits on the semaphore.
- `apps/server/src/fork/model-preview-3d/python/render.test.ts` (fake runner)
  - Same inputs twice: one run, the second `cached`. Changing an override, the sidecar, a
    dependency's revision, the build123d version or the interpreter path changes the key.
  - The runner's deps file feeds `readDeps`, and `watch` then emits for a dependency change.
  - A source edited during the run returns the "inputs changed" error.
  - Interruption gives `status: "cancelled"`; a new request for the same file interrupts the
    first.
  - An error result keeps the user-file line first in the log.
  - `renderScad` with a STEP file tessellates; with overrides it fails `invalid-parameter`.
  - No interpreter: `python-missing`.
  - `sidecarPath("x/bracket.b3d.py")` is `x/bracket.json`.
- `apps/server/src/fork/model-preview-3d/python/realPython.test.ts` (skipped without
  build123d)
  - The runner's `inspect` on the PRODUCT.md example returns its five parameters.
  - `render` produces a non-empty STL with a bounding box of 60 × 30 × 12 mm and
    `manifold: true`; with colours on, a 3MF.
  - `export-step` then `tessellate` gives the same bounding box within 0.05 mm.
  - A model that imports a sibling module records it as a dependency.
  - A model that raises reports `fixture.b3d.py:<line>`.
- `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (extend): `listModels`
  includes `.b3d.py` only with `include`; plain `.py` files never appear.
- `apps/server/src/fork/model-preview-3d/mcp.test.ts` (extend): `render_mesh` dispatches by
  format; `export_step` refuses an `outputPath` outside the workspace and when
  `agentToolEnabled` is false.
- `apps/web/src/fork/model-preview-3d/formats.test.ts`: `renderCommandFor` returns the Python
  command for `build123d` and the SCAD command for `scad` and `step`.

## Commands

```sh
vp test run packages/contracts/src/fork/model-formats.test.ts \
  apps/server/src/fork/model-preview-3d/python/inspect.test.ts \
  apps/server/src/fork/model-preview-3d/python/environment.test.ts \
  apps/server/src/fork/model-preview-3d/python/render.test.ts \
  apps/server/src/fork/model-preview-3d/python/realPython.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/web/src/fork/model-preview-3d/formats.test.ts
vp lint packages/contracts/src/fork apps/server/src/fork/model-preview-3d \
  apps/web/src/fork/model-preview-3d packages/client-runtime/src/fork/model-preview-3d.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

## Manual check

With Kyle's permission, on the worktree dev server seeded from real data:

1. Settings, 3D models, Python CAD: "Not set up". Click "Set up": elapsed time, then
   "build123d 0.13.0 on Python 3.13, managed by Loom".
2. Save the PRODUCT.md example as `bracket.b3d.py`. It is listed under "Sources"; open it. The
   customizer shows Size (width, height), the fillet, holes and finish.
3. Scrub `width`: renders follow; repeat a value: cached.
4. Move the hole code into `holes.py` and import it; edit `holes.py`: the tab re-renders.
5. Introduce an error: the Render log shows `bracket.b3d.py:<line>`; the last mesh stays.
6. Save a parameter set; `bracket.json` appears. Build three variants and compare them.
7. "Export STEP": a file downloads. Put it in the workspace and open it: it previews.
8. Open a STEP file from another CAD tool: colours show.
9. In a browser over Tailscale or T3 Connect with a standard pairing: STEP previews and
   `.b3d.py` shows the terminal-permission message unless the pairing has terminal access.
10. Ask an agent to write a build123d hinge, render it, capture views and export STEP.
11. Set the interpreter path to the system `python3` without build123d: "This Python does not
    have build123d." Clear it.
12. "Remove": the managed folder is gone and tabs show "Not set up".
13. Against an upstream T3 server: no 3D panel, nothing breaks.

## Merge safety

No upstream file changes, so the merge preview in [SEAMS.md](./SEAMS.md) must exit 0. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
