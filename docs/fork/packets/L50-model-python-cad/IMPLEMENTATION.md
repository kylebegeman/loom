# L50 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md,
MODEL-3D-FOLLOW-UPS.md and this folder. Check what has landed:

```sh
test -f apps/server/src/fork/model-preview-3d/formats.ts && echo "L41 formats exist"
rg -n "PREVIEWABLE_FORMATS|MODEL_FORMATS" apps packages --type ts
command -v uv && uv --version
```

Kyle's answers in PRODUCT.md ("Decisions needed from Kyle") must be in. The steps assume the
recommended answers. If Kyle chooses "Loom never installs it", drop the install half of
step 3 and keep the commands and the path field.

Installing build123d on the host for the real-runner tests (step 4) writes only into this
worktree's `.t3` state folder; ask Kyle before the first install, since it downloads about
60 MB or more.

## Steps

1. **Contracts.** In `model-preview-3d.ts`: the `"build123d"` literal, `MODEL_EXTENSIONS`,
   `modelFormatOf`, `isSourceFormat`, `TESTED_BUILD123D_VERSION`, `MANAGED_PYTHON_VERSION`,
   `pythonInstallCommands`, `PythonCadInfo`, `pythonPath` with its decoding default, `python`
   on status, `"python-missing"`, the three RPC tags and group entries, and `include` on
   `listModels`. Remove the STEP comment on `"unsupported-format"`. Scopes in
   `rpcAuthorization.ts` and `clientRpcPermissions.ts`. Add tests to
   `model-preview-3d.test.ts` (or a new `model-formats.test.ts`). Typecheck contracts and
   server.
2. **Formats in one place.** Server: replace the local `formats` map
   (`ModelPreviewService.ts:71-80`) with `modelFormatOf`, or point L41's `formats.ts` at it.
   `listModels` lists `.b3d.py` only with `include`. Web: `ModelPanel.tsx:102-104` uses
   `modelFormatOf`. No behaviour change yet.
3. **Runner and environment.** `python/runnerSource.ts` (the runner, with `probe`, `inspect`,
   `render`, `tessellate`, `export-step`), `python/protocol.ts` and `python/environment.ts`
   (resolution, probe cache, install, remove). Keep the runner readable: it is reviewed as
   Python, so also keep a copy at `python/runner.py` that a test asserts equal to the string,
   or generate the string from that file at build time if the server build already copies
   assets (check before choosing).
4. **Real-runner tests.** With build123d set up in the worktree state folder, add
   `realPython.test.ts`, skipped when no interpreter with build123d is found (the pattern of
   `realOpenScad.test.ts`). Measure the cold render time of the fixture and note it in
   TECHNICAL.md ("Performance").
5. **Parameters.** `python/inspect.ts`; `parameters` dispatches `.b3d.py`; `sidecarPath`
   handles `.b3d.py`. Unit tests feed fixture runner output; the real-runner test checks the
   static reader on the fixture model.
6. **Rendering.** `python/render.ts` with `renderPython` and `tessellateStep`, following
   `runRender`; `renderScad` dispatches STEP; wire into `make` and `rpc.ts`. Service tests with a
   fake runner (writes a small STL and summary), covering the cache, cancellation, the
   "inputs changed" path and dependency recording.
7. **STEP export.** `exportStep` and the RPC; the MCP tool with workspace containment.
8. **MCP.** `render_mesh`, `parameters` and `render` accept the new formats; the tool
   descriptions gain the file convention; status reports `python`. Extend `mcp.test.ts`.
9. **Client atoms.** `renderPython`, `renderPythonResult`, `exportStep`, `pythonSetup`.
10. **Web.** `formats.ts` with `renderCommandFor`; replace the `format === "scad"` checks listed
    in TECHNICAL.md with `isSourceFormat`; the STEP and not-ready states; labels and picker
    filters; "Export STEP" in Part.
11. **Settings.** `PythonSettings.tsx` with detection, "Set up", "Update", "Remove", the
    interpreter path and the manual commands.
12. **Docs.** In `docs/fork/user/model-preview-3d.md`, replace "STEP files belong in the
    optional Fabrication app." with STEP preview guidance, and add a short "Python CAD
    (build123d)" section: how to set it up, the `*.b3d.py` and `def model(...)` convention with
    the parameter types, that models run as normal Python on the host, and "Export STEP". Set
    this packet's Status and the index row in `docs/fork/packets/README.md`.

Commit after each step with `feat(fork-model-python-cad): ...`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- On Kyle's Mac, "Set up" installs build123d 0.13.0 into the state folder, and "Remove"
  deletes it.
- The PRODUCT.md example renders, its five parameters appear in the customizer with the right
  ranges, group and choices, and changing `width` re-renders; a second identical render is
  cached.
- Editing a helper module the model imports re-renders the open tab.
- A model with a Python error shows the user's file and line in the Render log and keeps the
  last good mesh.
- Variants and parameter sets work for the example, with sets saved in `bracket.json`.
- "Export STEP" downloads a STEP file that re-opens in Loom as a STEP preview with the same
  bounding box.
- A STEP file from another CAD tool previews with its colours.
- A client paired without the terminal permission previews STEP but not `.b3d.py`, with the
  stated message.
- An agent writes a `.b3d.py`, renders it, captures PNG views and exports STEP into the
  workspace using only MCP tools.
- An older web client still lists models against the new server (no `.b3d.py` entries without
  `include`).
