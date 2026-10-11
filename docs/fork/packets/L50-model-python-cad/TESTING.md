# L50 testing

Focused checks only. No repository-wide checks or browser/computer-use runs.

## Verification evidence (2026-10-10)

Focused service and runner tests cover opt-in format listings and turn events, static signature inspection without executing source, dependency-aware caching, parameters and sets, STEP export, setup failure/cancellation, snapshot isolation and correct permission boundaries. Regressions confirm that cache-only lookups and PNG previews preserve last-used customizer values. The embedded Python helper exactly matches runner.py and passed an isolated Python 3.14.7 probe. build123d is absent on this host, so real CAD rendering, STEP tessellation/export, colors and managed install were not exercised. No host CAD dependency was installed.

The final shared service, MCP, RPC and Python renderer integration run passed all 57 tests.
The integrated MCP tests cover tool availability, disabled-agent gating, caller paths,
restore conflicts and undo, assembly operations, STEP output and Python execution grants.
RPC regressions verify that indirect Python execution cannot bypass terminal permission.
The MCP regression allows trusted STEP previews in plan mode while refusing Python source execution.
Targeted strict lint and affected package typechecks cover the shared integration.
Browser, desktop/GPU and remote-client interaction checks remain unverified.

The server bundle build passed. Its embedded Python helper matched `runner.py`; an isolated
probe through Python 3.14.7 succeeded and reported build123d absent. No managed install or
real build123d render/STEP roundtrip was performed.

## Focused commands

```sh
./node_modules/.bin/vp test run packages/contracts/src/fork/model-preview-3d.test.ts \
  apps/server/src/fork/model-preview-3d/pythonCad/runner.test.ts \
  apps/server/src/fork/model-preview-3d/pythonCad/environment.test.ts \
  apps/server/src/fork/model-preview-3d/pythonCad/render.test.ts \
  apps/server/src/fork/model-preview-3d/turnModels.test.ts \
  apps/web/src/fork/model-preview-3d/agentModels.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/server/src/fork/model-preview-3d/rpc.test.ts
```

The affected package typechecks are `@t3tools/contracts`, `@t3tools/client-runtime`,
`@t3tools/web` and `t3`. Run lint only on changed files, with `--deny-warnings`.

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
