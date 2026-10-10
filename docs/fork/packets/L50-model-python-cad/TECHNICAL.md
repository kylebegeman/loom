# L50 technical design

Cited lines are from `docs/model-preview-follow-ups` at `8676e099e5`. build123d APIs are in
REFERENCES.md with their sources.

## Overview

A small Python program, the runner, is embedded in the server as a string and written to the
state folder. The server runs it with the configured interpreter for four jobs: read a model's
parameters (static, no user code), render a model, tessellate a STEP file, and export STEP.
Rendering goes through the same cache, slots, job interruption, dependency watching, logs and
signed URLs as OpenSCAD, so the web and agents get the same `ScadRenderResult` they already
handle. The only new client concepts are a format, a second render command, settings and
"Export STEP".

```
.b3d.py ─ parameters ─ runner inspect (ast only) ──────────────┐
        ─ renderPython ─ runner render (imports and runs model) ┼─ renders/<hash>.{stl,3mf}
.step   ─ renderScad ─── runner tessellate (import_step) ───────┘        │
.b3d.py ─ exportStep ─── runner export-step ─ renders/<hash>.step        ├─ signed route
                                                                          └─ watch, deps
```

## Today

- Formats are known from the extension
  (`apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:71-80` on the server, `apps/web/src/fork/model-preview-3d/ModelPanel.tsx:102-104` on the web). STEP
  is listed but refused by `fileUrl` (`ModelPreviewService.ts:1011-1019`) and shown as a
  placeholder linking to the Fabrication app (`ModelPanel.tsx:666-692`,
  `ModelPicker.tsx:113-138`). The error reason comment says STEP "stays with the Fabrication
  app" (`packages/contracts/src/fork/model-preview-3d.ts:271`).
- `runRender` (`ModelPreviewService.ts:403-586`) is the pattern to follow: cache key from source,
  sidecar, overrides, tool version, format and dependency metadata; a `pending-<uuid>` stem
  published under the final hash; `protectStem`; inputs re-read after the run so an edit during
  the job never labels output with the wrong inputs; dependencies read from a make-style file by
  `readDeps` (`:386-402`) and remembered by `restoreDependencies` (`:365-375`) so `watch`
  re-renders when an included file changes.
- `renderScad` (`:587-622`) serialises per file and variant and interrupts the previous job.
- Parameters are `ScadParameter` values with OpenSCAD literals (`model-preview-3d.ts:86-107`);
  the server validates overrides by kind (`validateOverrides`, `ModelPreviewService.ts:323-333`)
  and literals with `validateLiteral`. Sets live in a sidecar next to the source, found by
  `sidecarPath` (`:203`), which only knows `.scad`.
- `renderImages` wraps a non-SCAD mesh in a one-line OpenSCAD import to make PNGs
  (`:1153-1160`) and refuses other formats at `:1121-1132`.
- Precedent for running workspace code: the PCB render (tscircuit) requires terminal operate
  (`apps/server/src/fork/rpcAuthorization.ts:42`). Precedent for a pinned host tool:
  `TESTED_GRAPHIFY_VERSION` and its install commands
  (`packages/contracts/src/fork/code-graph.ts:26-39`).

## Contracts

All in `packages/contracts/src/fork/model-preview-3d.ts`.

### Format

```ts
export const ModelFormat = Schema.Literals([
  "stl",
  "3mf",
  "obj",
  "glb",
  "gltf",
  "scad",
  "step",
  "build123d",
]);
/** The one place a path becomes a format. Server, web, MCP and L41 call this. */
export const modelFormatOf = (path: string): ModelFormat | null => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".b3d.py")) return "build123d";
  const ext = lower.slice(lower.lastIndexOf("."));
  return MODEL_EXTENSIONS[ext] ?? null;
};
export const MODEL_EXTENSIONS = {
  ".stl": "stl",
  ".3mf": "3mf",
  ".obj": "obj",
  ".gltf": "gltf",
  ".glb": "glb",
  ".scad": "scad",
  ".step": "step",
  ".stp": "step",
} as const;
/** Formats with parameters, a customizer and a render step. */
export const isSourceFormat = (format: ModelFormat) => format === "scad" || format === "build123d";
```

If L41 has landed, its `MODEL_FORMATS` map moves here as `MODEL_EXTENSIONS` (or stays and is
re-exported); its call sites switch to `modelFormatOf`, and `PREVIEWABLE_FORMATS` gains `"step"`
and `"build123d"`.

**Older clients.** Adding a literal would make an older client fail to decode a `listModels`
response that contains a `.b3d.py` entry. The request gains
`include: Schema.optionalKey(Schema.Array(Schema.Literal("build123d")))`; the server lists
`.b3d.py` files only when it is present. New clients send it. Nothing else returns a
`ModelFormat`.

### Settings and status

```ts
// ModelPreviewSettings (model-preview-3d.ts:240-262)
/** Null: Loom's managed environment. Otherwise an interpreter with build123d installed. */
pythonPath: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),

export const TESTED_BUILD123D_VERSION = "0.13.0";
export const MANAGED_PYTHON_VERSION = "3.13";
export const pythonInstallCommands = (venv: string) => [
  `uv venv --no-config --python ${MANAGED_PYTHON_VERSION} "${venv}"`,
  `uv pip install --no-config --python "${venv}" --only-binary :all: build123d==${TESTED_BUILD123D_VERSION}`,
];

export const PythonCadInfo = Schema.Struct({
  state: Schema.Literals(["ready", "not-set-up", "missing-build123d", "broken", "setting-up"]),
  managed: Schema.Boolean,
  path: Schema.NullOr(Schema.String),
  pythonVersion: Schema.NullOr(Schema.String),
  build123dVersion: Schema.NullOr(Schema.String),
  /** Path to uv, when found; the UI offers "Set up" only with it. */
  uv: Schema.NullOr(Schema.String),
  /** The commands for a manual install, with this host's managed folder filled in. */
  installCommands: Schema.Array(Schema.String),
  detail: Schema.NullOr(Schema.String), // the last error line for "broken"
});
```

`ModelPreviewStatus` (`:64-67`) gains `python: Schema.optionalKey(PythonCadInfo)`. A client
that sees no `python` key is talking to an older server and shows the "Update Loom" state.
`DEFAULT_MODEL_PREVIEW_SETTINGS` gains `pythonPath: null`. The error reasons (`:264-280`) gain
`"python-missing"`; the STEP comment on `"unsupported-format"` is removed.

### RPC methods

| Tag                                  | Payload                             | Success            | Scope            |
| ------------------------------------ | ----------------------------------- | ------------------ | ---------------- |
| `loom.model-preview-3d.renderPython` | `ScadRenderInput`                   | `ScadRenderResult` | Terminal operate |
| `loom.model-preview-3d.exportStep`   | `ScadRenderInput`                   | `SignedFile`       | Terminal operate |
| `loom.model-preview-3d.pythonSetup`  | `{ action: "install" \| "remove" }` | `PythonCadInfo`    | Terminal operate |

Changed methods:

- `renderScad` also accepts STEP files (overrides must be `{}` and `parameterSet` null). It
  keeps orchestration operate: tessellating STEP runs only Loom's runner on a data file.
- `parameters` also accepts `.b3d.py` files and keeps orchestration read: it runs only the
  runner's static reader.
- `listModels` gains the `include` field above.

Entries go in `apps/server/src/fork/rpcAuthorization.ts` and the operate ones in
`packages/contracts/src/fork/clientRpcPermissions.ts`. Cancelling is interrupting the request,
as for renders.

## Server

New folder `apps/server/src/fork/model-preview-3d/python/`, created by `makePythonCad(deps)`
inside `make`, with the closures it needs (`resolveFile`, `cacheDir`, `protectStem`, `sign`,
`prune`, `readDeps`, `restoreDependencies`, `dependencyMetadata`, `readSidecar`, `renderSlots`,
`store`, `runner`, `settings`). Its methods are spread into the service object, and
`renderScad` dispatches STEP to it.

| File              | Contents                                                            |
| ----------------- | ------------------------------------------------------------------- |
| `runnerSource.ts` | The runner as a string constant and `RUNNER_VERSION` (its SHA-256). |
| `environment.ts`  | Interpreter resolution, probe, managed setup and removal.           |
| `inspect.ts`      | Runs `inspect` and maps its output to `ScadParameter[]`.            |
| `render.ts`       | `renderPython`, `tessellateStep`, `exportStep`.                     |
| `protocol.ts`     | Schemas for the runner's request and result JSON.                   |

### The runner

`runnerSource.ts` holds a Python 3.11+ script (about 250 lines) written to
`<stateDir>/fork/model-preview-3d/python/runner-<RUNNER_VERSION>.py` on first use. It is run as
`<python> -I -X utf8 <runner> <command>` with the request JSON on stdin (`ProcessRunInput.stdin`,
`apps/server/src/processRunner.ts:29`) and writes its result to the `resultPath` in the request,
so anything user code prints cannot corrupt the protocol. `-I` ignores `PYTHONPATH` and the user
site folder, so the managed environment is not affected by the host's Python setup.

Commands:

- **`probe`**: `{ python: platform.python_version(), build123d: importlib.metadata.version(...) }`
  or an error naming the missing package. Does not import build123d (fast).
- **`inspect`** `{ source }`: `ast.parse` the file, find the module-level `def model`, and for
  each keyword parameter emit `{ name, kind, defaultValue, range, options, group, description }`:
  - `float` or `int` annotation: `number`; `int` gets step 1 unless given.
  - `bool`: `boolean`. `str`: `string`.
  - `Literal[...]` of numbers or strings: options with the value as label, kind from the values.
  - `tuple[float, ...]`, `tuple[float, float, float]`, `list[float]`: `vector`.
  - `Annotated[T, {...}]`: `T` as above, with `min`, `max`, `step`, `group`, `description` and
    `labels` (a dict from option value to label) read from the dict with `ast.literal_eval`.
  - The default is `ast.literal_eval`'d and written as an OpenSCAD literal with `json.dumps`
    (`True` becomes `true`, tuples become arrays). A missing or non-literal default, `*args`,
    `**kwargs` or an unknown annotation skips the parameter with a warning.
  - No `model` function: `{ error: "no-model" }`.
    No user code runs: nothing is imported and nothing is evaluated beyond literals.
- **`render`** `{ source, root, values, format, linear, angular, output, depsPath }`:
  - Put the source's folder first on `sys.path`, load the file with
    `importlib.util.spec_from_file_location` under a unique module name, and call
    `model(**values)` with values decoded by `json.loads` (OpenSCAD literals are JSON for every
    kind the customizer produces). Arguments not in the signature are dropped with a warning.
  - Accept a `Shape`, a `Builder` (its `.part`), or a list of shapes (made a `Compound`).
  - `format: "3mf"`: `Mesher().add_shape(shape, linear_deflection, angular_deflection)` then
    `write(output)`, which keeps `shape.color` and `label`. `"stl"`: `export_stl(shape, output,
tolerance, angular_tolerance)`.
  - Summary: `is_valid`, `is_manifold`, `bounding_box()` min and max, `volume`, and facet and
    vertex counts (`Mesher.triangle_counts` and `vertex_counts`, or the STL header count).
  - Dependencies: every module in `sys.modules` whose `__file__` is under `root` (the workspace),
    plus files the model opened under `root` through a small `builtins.open` audit hook
    (`sys.addaudithook`, event `open`), written as `output: dep1 dep2` with spaces escaped, the
    format `readDeps` already parses.
  - User `print` output goes to stderr as `echo` lines; Python warnings as `warning`; an
    exception as `error` with the traceback's last frame inside the user's file first
    (`bracket.b3d.py:14: ValueError: ...`), then the full traceback as `trace` lines.
- **`tessellate`** `{ source, format, linear, angular, output }`: `import_step(source)`, then the
  same export and summary. No user code.
- **`export-step`** `{ ...render fields, output }`: run the model as in `render`, then
  `export_step(shape, output)`.

Tolerances are constants: linear 0.01 mm, angular 0.1 rad, in `render.ts` and part of the
cache key.

### Interpreter and setup (`environment.ts`)

- **Resolution.** `settings.pythonPath` when set, otherwise the managed interpreter
  `<stateDir>/fork/model-preview-3d/python/venv/bin/python` (`Scripts\python.exe` on Windows).
- **Probe.** Run `probe` with a 10 second timeout, cache the result for 60 seconds like
  OpenSCAD's status, and reset it on `updateSettings` and after setup. `uv` is found on `PATH`
  and in `~/.local/bin` and `/opt/homebrew/bin`. Probing runs only for the `status` RPC and
  before Python jobs, never inside SCAD renders.
- **Install.** `pythonSetup({ action: "install" })` runs the two `pythonInstallCommands` with
  `runner.run` (timeout 15 minutes, output truncated to 256 KiB, `UV_NO_PROGRESS=1`) into a
  `venv-pending-<uuid>` folder, probes it, and renames it to `venv` only when the probe reports
  build123d. Interrupting the request stops `uv` and removes the pending folder. One setup at a
  time (a `Semaphore(1)`); state `setting-up` while it runs. `uv` downloads a managed Python
  3.13 when the host has none (uv's default; see REFERENCES.md).
- **Remove.** Deletes `venv` and the runner files; the cache stays (pruned as usual).
- Loom never runs `pip` against the user's interpreter.

### Rendering (`render.ts`)

`renderPython(input)` mirrors `renderScad`: refuse anything but `build123d`, serialise per
file and variant with the same `jobs` map and `jobLock`, run under `renderSlots` (so OpenSCAD
and Python renders share the host's slots), and map interruption to `status: "cancelled"`.

The job body follows `runRender` (`ModelPreviewService.ts:403-586`) step by step:

1. Resolve the interpreter or fail with `python-missing`.
2. Read the source and sidecar, run `inspect` (cached in memory by source hash), validate
   overrides with `validateOverrides` and the set with the sidecar.
3. Key: `cacheKey(absolute + "\0" + source, overrides, parameterSet, json(sidecar),
"build123d " + build123dVersion + " " + interpreterPath + " " + RUNNER_VERSION,
"linear 0.01 angular 0.1", format, dependencies)`.
4. Same pending stem, `protectStem`, run (`cwd` the model folder, render timeout,
   `outputMode: "truncate"`, 512 KiB), the same "inputs changed during rendering" check, rename
   to the final hash, `${stem}.log`.
5. The summary goes into `${stem}.summary.json` in the shape `parseSummary` reads, so the
   cached path is unchanged. `is_valid === false` adds the warning "The shape is not a valid
   solid".
6. `store.saveParams` for last-used values, `sign`, `prune`, return.

`tessellateStep(input)` is the same with no parameters, no sidecar, no dependencies, and the
STEP file's content revision (size, mtime and inode from `metadata`) in the key.

`exportStep(input)` renders the key for `format: "step"` into the same cache folder (pruned with
renders) and returns `sign(cacheDir, output, true)` with the download name `<model>.step`.

`sidecarPath` (`:203`) becomes `absolute.replace(/(\.b3d\.py|\.scad)$/i, ".json")`, so a
`bracket.b3d.py` keeps its sets in `bracket.json`, in the customizer format it already uses.
`saveParameterSet` works unchanged.

### Watching

`watch` already re-renders on source and dependency changes for any file; `restoreDependencies`
and `readDeps` are reused, so editing a helper module next to the model re-renders it.

### Agent PNGs

`renderImages` (`ModelPreviewService.ts:1104-1254`) accepts `build123d` and `step`: it renders
the mesh through `renderPython` or `tessellateStep` first (honouring overrides for `build123d`),
then wraps the cached mesh in the existing OpenSCAD import (`:1153-1160`). OpenSCAD is still
needed for PNGs; the error says so.

## Storage

Files only, under `<stateDir>/fork/model-preview-3d/`:

| Path                                                  | Content                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `python/venv/`                                        | The managed environment, when set up (several hundred MB; see REFERENCES.md) |
| `python/runner-<version>.py`                          | The runner                                                                   |
| `renders/<hash>.{stl,3mf,step,summary.json,deps,log}` | Same cache as SCAD, same pruning                                             |

Settings gain `pythonPath` with a decoding default. No table or migration.

## Clients

### Shared atoms

`packages/client-runtime/src/fork/model-preview-3d.ts` adds `renderPython` (with its
`resultAtom` as `renderPythonResult`, label `loom:model-render-python`), `exportStep` and
`pythonSetup`, next to `render` (`:14-22`).

### Web

- **Format.** `ModelPanel.tsx:102-104` uses `modelFormatOf(path)`. Every
  `format === "scad"` that means "has parameters and renders" uses `isSourceFormat(format)`:
  `ModelPanel.tsx:126`, `:129`, `:178`, `:246`, `:249`, `:502`, `:772`, `:782`, `:926`, `:1030`,
  `:1036`, `:1057`; `ModelInspector.tsx:438`, `:452`; `ModelPicker.tsx:32-33`, `:113`, `:129`.
  STEP joins the mesh path for loading: instead of `fileUrl`, a STEP tab uses the render result
  atom with empty overrides.
- **Render command.** `ScadCustomizer.tsx:304` and `VariantsInspector.tsx:129`, `:690` choose
  `models.render`/`renderResult` or `models.renderPython`/`renderPythonResult` with a helper
  `renderCommandFor(models, format)` in a new `formats.ts`. The permission tip at
  `ScadCustomizer.tsx:56` reads the chosen command's `permissionAtom`, so a client without the
  terminal permission sees the "needs terminal access" state.
- **STEP tab.** The placeholder at `ModelPanel.tsx:666-692` shows only when Python CAD is not
  ready (or the server is older), with "Set up Python CAD" and the existing Fabrication link;
  otherwise STEP renders like a mesh.
- **Labels.** Document bar and Part: "build123d source" and "STEP file". Picker: the "OpenSCAD"
  filter (`ModelPicker.tsx:56-63`) becomes "Sources" and includes build123d files, shown with
  `FileCode2Icon`; STEP moves under "Meshes" and shows its size instead of "Open in
  Fabrication"; the empty state (`:88`) mentions STEP and build123d.
- **Export STEP.** A button in `PartSection` (`ModelInspector.tsx:336`) for `build123d` files,
  with `OperationStatus` while running and an anchor download of the signed URL, the way
  `downloadMedia` works upstream (`apps/web/src/components/media/mediaContent.ts:29-39`).
- **Settings.** `PythonSettings.tsx` (new), rendered by `SettingsSection.tsx` after the OpenSCAD
  rows: the detection line, "Set up" (when `uv` is found and the managed environment is missing),
  "Update" (when the managed build123d differs from the tested version), "Remove", the
  "Python interpreter" path `Input` (blank means managed), and, when `uv` is missing, the
  install commands in a code block with a copy button.

### Mobile

None. Mobile has no 3D panel.

## Agent-facing tools

- `loom_model_preview_3d_render_mesh` and `loom_model_preview_3d_parameters` accept `.b3d.py`
  and STEP (STEP without parameters). `mcp.ts:372` calls a service `renderModel(input)` that
  dispatches by format, so the tool needs no format logic.
- `loom_model_preview_3d_render` (PNGs) accepts both, as above.
- New `loom_model_preview_3d_export_step` `{ path, overrides?, parameterSet?, outputPath? }`:
  exports and copies the STEP file into the workspace at `outputPath` (default: next to the
  source, `<name>.step`), refusing paths outside the workspace. Gated by `agentToolEnabled`;
  `actsAsCaller` (`apps/server/src/mcp/McpToolAccess.ts:148`).
- `loom_model_preview_3d_status` reports `python`.
- No setup tool. Installing software on the host stays a user action in settings.
- The render tool's description gains the file convention in two sentences ("Python models are
  files named `*.b3d.py` with `def model(...)` returning a build123d shape; keyword arguments
  with defaults become parameters, using `Annotated[float, {"min", "max", "step", "group"}]`,
  `bool`, `str`, `Literal[...]` and `tuple[float, ...]`.") so agents write files the panel can
  read.

Agents run in the same thread workspace and act as the caller, like every model tool; MCP calls
are not checked against client scopes, matching how the PCB render tool behaves.

## Performance

- Nothing new runs until a `.b3d.py` or STEP tab is open. Listing models costs nothing extra:
  the format comes from the name.
- Each render is a fresh Python process. Importing build123d and OpenCascade takes about a
  second or two on Apple silicon (unverified; measure in step 4 of IMPLEMENTATION.md). The
  cache makes repeats free, and parameter scrubbing already debounces renders. If cold starts
  are a problem, a warm worker is a follow-up, not v1.
- Renders share `renderSlots` with OpenSCAD, so Python cannot starve the host.
- WebSocket traffic is unchanged: results are the same small JSON; meshes and STEP files use the
  signed route.
- `inspect` is cached by source hash, so the customizer does not start Python on every
  keystroke.

## Alternatives considered

- **CadQuery.** Same kernel, different API; CadQuery has more examples online, but
  build123d has the typed, current API the Fabrication research chose.
  Supporting both doubles the runner and agent guidance.
- **A first-line marker instead of `.b3d.py`.** Needs a file read per `.py` file to list
  models, and the web would need the format from the server. See PRODUCT.md, decision 2.
- **Run `model` to read parameters.** Simpler parsing, but reading parameters would run user
  code under a read scope, and a slow model would make the customizer slow.
- **A long-lived Python worker.** Faster renders after the first, but state leaks between
  renders, cancellation must kill and restart it anyway, and memory stays allocated. Measure
  first.
- **OpenCascade in the browser (opencascade.js).** Tens of megabytes of WASM per client, no
  access to the user's Python libraries, and remote clients on phones would pay it.
- **Convert STEP with OpenSCAD.** OpenSCAD does not read STEP.
- **Ship build123d with Loom.** Hundreds of megabytes in every install for a feature some users
  never touch; the managed install keeps it opt-in.
