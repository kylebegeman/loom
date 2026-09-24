# L23 technical design

Upstream citations are to this fork at `a931bd85f3` (upstream v0.0.42). Library facts: three.js
0.186.0 and occt-import-js 0.0.23 from npm on 2026-09-24; OpenSCAD facts from the Fabrication
packet's verified references (`~/Developer/docs/apps/fabrication/REFERENCES.md`, 2026-09-24) and
OpenSCAD's docs. OpenSCAD itself is not installed on Kyle's Mac, so its flags must be rechecked
against the installed snapshot during implementation (`openscad --help`, `--help-export`).

## Overview

```
 web / desktop                                        environment server (ForkLayer)
+------------------------------------------+   RPC   +-----------------------------------------+
| 3D model panel (fork panel, per file)    | ------> | ModelPreviewService                     |
|  picker | viewer (three.js, lazy chunk)  |         |  listModels (WorkspaceEntries.list)     |
|  params form (.scad) | render log        | <------ |  fileUrl -> signed token                |
|  capture -> composer (addImage)          |  watch  |  watch (FileSystem.watch, debounced)    |
+------------------------------------------+         |  renderScad (openscad CLI, cache, LRU)  |
        | GET /api/loom/model-preview-3d/f/<token>/<path>  (fork HTTP route, signed, CORS)  |
        v                                          |  parameters (customizer parser)         |
   bytes of the mesh / render output               |  saveParameterSet (sidecar JSON)        |
                                                   +-----------------------------------------+
  agents: loom_model_preview_3d_render (openscad PNG views + summary)
```

## Contracts

`packages/contracts/src/fork/model-preview-3d.ts`:

```ts
export const MODEL_PREVIEW_3D_WS_METHODS = {
  status: "loom.model-preview-3d.status",
  listModels: "loom.model-preview-3d.listModels",
  fileUrl: "loom.model-preview-3d.fileUrl",
  watch: "loom.model-preview-3d.watch",
  parameters: "loom.model-preview-3d.parameters",
  renderScad: "loom.model-preview-3d.renderScad",
  saveParameterSet: "loom.model-preview-3d.saveParameterSet",
  getSettings: "loom.model-preview-3d.getSettings",
  updateSettings: "loom.model-preview-3d.updateSettings",
  clearCache: "loom.model-preview-3d.clearCache",
} as const;

export const ModelFormat = Schema.Literals(["stl", "3mf", "obj", "glb", "gltf", "scad", "step"]);

export const ModelFileRef = Schema.Struct({
  threadId: ThreadId,
  /** Workspace-relative path. */
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)),
});

export const ModelEntry = Schema.Struct({
  path: Schema.String,
  format: ModelFormat,
  sizeBytes: Schema.Number,
  modifiedAt: Schema.String,
});

export const OpenScadInfo = Schema.Struct({
  path: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String), // "2026.09.22" or "2021.01"
  isSnapshot: Schema.Boolean,
  supportsManifold: Schema.Boolean, // snapshot >= 2024.09.28
  supportsSummary: Schema.Boolean, // --summary / --summary-file
});

export const ModelPreviewStatus = Schema.Struct({
  openscad: OpenScadInfo,
  maxFileBytes: Schema.Number,
});

export const SignedFile = Schema.Struct({
  /** Relative to the environment's HTTP base URL; resolve with resolveAssetUrl. */
  relativeUrl: Schema.String,
  expiresAt: Schema.Number,
  sizeBytes: Schema.Number,
  modifiedAt: Schema.String,
  /** Changes whenever the bytes change; used as the viewer's cache key. */
  revision: Schema.String,
});

export const ModelWatchEvent = Schema.Struct({
  path: Schema.String,
  revision: Schema.NullOr(Schema.String), // null when the file disappeared
  /** For .scad: true when an included file changed, not the file itself. */
  dependencyChanged: Schema.Boolean,
});

export const ScadParameter = Schema.Struct({
  name: Schema.String,
  group: Schema.String, // the /* [Tab] */ group, "" for none
  description: Schema.NullOr(Schema.String),
  kind: Schema.Literals(["number", "string", "boolean", "vector"]),
  defaultValue: Schema.String, // OpenSCAD literal as written
  range: Schema.NullOr(
    Schema.Struct({ min: Schema.Number, max: Schema.Number, step: Schema.NullOr(Schema.Number) }),
  ),
  options: Schema.NullOr(
    Schema.Array(Schema.Struct({ value: Schema.String, label: Schema.String })),
  ),
});

export const ScadParameters = Schema.Struct({
  parameters: Schema.Array(ScadParameter),
  sets: Schema.Array(Schema.String), // names in the customizer JSON sidecar
  lastUsed: Schema.Record(Schema.String, Schema.String), // name -> OpenSCAD literal
  lastUsedSet: Schema.NullOr(Schema.String),
});

export const ScadRenderInput = Schema.Struct({
  file: ModelFileRef,
  /** name -> OpenSCAD literal; validated server-side. */
  overrides: Schema.Record(Schema.String, Schema.String),
  parameterSet: Schema.NullOr(Schema.String),
});

export const ScadRenderResult = Schema.Struct({
  status: Schema.Literals(["ok", "error", "cancelled"]),
  mesh: Schema.NullOr(SignedFile), // binary STL or 3MF
  meshFormat: Schema.NullOr(Schema.Literals(["stl", "3mf"])),
  cached: Schema.Boolean,
  durationMs: Schema.Number,
  log: Schema.Array(
    Schema.Struct({
      level: Schema.Literals(["echo", "warning", "error", "trace", "info"]),
      text: Schema.String,
    }),
  ),
  summary: Schema.NullOr(
    Schema.Struct({
      manifold: Schema.NullOr(Schema.Boolean),
      facets: Schema.NullOr(Schema.Int),
      vertices: Schema.NullOr(Schema.Int),
      boundingBox: Schema.NullOr(
        Schema.Struct({ min: Schema.Array(Schema.Number), max: Schema.Array(Schema.Number) }),
      ),
    }),
  ),
});

export const ModelPreviewSettings = Schema.Struct({
  openscadPath: Schema.NullOr(Schema.String),
  backend: Schema.Literals(["auto", "manifold", "cgal"]),
  renderTimeoutSeconds: Schema.Int, // default 120
  renderColors: Schema.Boolean, // 3MF output with colors; default false (binary STL)
  maxFileMegabytes: Schema.Int, // default 150
  buildPlateMm: Schema.Tuple([Schema.Number, Schema.Number]), // default [256, 256]
  fabricationUrl: Schema.NullOr(Schema.String),
  agentToolEnabled: Schema.Boolean, // default true
});

export class ModelPreviewError extends Schema.TaggedError<ModelPreviewError>()(
  "ModelPreviewError",
  {
    reason: Schema.Literals([
      "workspace-not-found",
      "not-found",
      "invalid-path",
      "unsupported-format",
      "too-large",
      "openscad-missing",
      "invalid-parameter",
      "timeout",
      "command-failed",
    ]),
    message: Schema.String,
  },
) {}
```

| Tag                              | Payload                                    | Success                                               | Stream       | Scope                                          |
| -------------------------------- | ------------------------------------------ | ----------------------------------------------------- | ------------ | ---------------------------------------------- |
| `status`                         | `{}`                                       | `ModelPreviewStatus`                                  | no           | `orchestration:read`                           |
| `listModels`                     | `{ threadId }`                             | `{ models: ModelEntry[], truncated }` (at most 2,000) | no           | `orchestration:read`                           |
| `fileUrl`                        | `ModelFileRef` plus `allowLarge?: boolean` | `SignedFile`                                          | no           | `orchestration:read`                           |
| `watch`                          | `ModelFileRef`                             | `ModelWatchEvent`                                     | subscription | `orchestration:read`                           |
| `parameters`                     | `ModelFileRef`                             | `ScadParameters`                                      | no           | `orchestration:read`                           |
| `renderScad`                     | `ScadRenderInput`                          | `ScadRenderResult`                                    | no           | `orchestration:operate`                        |
| `saveParameterSet`               | `{ file, name, values }`                   | `ScadParameters`                                      | no           | `orchestration:operate`                        |
| `getSettings` / `updateSettings` | `{}` / partial                             | `ModelPreviewSettings`                                | no           | `orchestration:read` / `orchestration:operate` |
| `clearCache`                     | `{}`                                       | void                                                  | no           | `orchestration:operate`                        |

`renderScad` needs `orchestration:operate` because it spends CPU on the host and records the
last-used values; it writes nothing into the workspace. `watch` joins `ForkSubscriptionRpcTag`.

## Server

Directory `apps/server/src/fork/model-preview-3d/`:

| File                                            | Contents                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `ModelPreviewService.ts`                        | `loom/ModelPreviewService`.                                                  |
| `signedFiles.ts`                                | Token mint and verify (HMAC-SHA256), path containment.                       |
| `http.ts`                                       | `ModelPreviewHttpRoutes`: `GET /api/loom/model-preview-3d/f/<token>/<path>`. |
| `openscad.ts`                                   | Locate, version, argv, log parsing, summary parsing. Pure parts tested.      |
| `customizer.ts`                                 | Parameter parser and literal validation. Pure, tested.                       |
| `renderCache.ts`                                | Keys, file layout, LRU prune.                                                |
| `store.ts`, `migrations.ts`, `rpc.ts`, `mcp.ts` | Storage and transport.                                                       |

Upstream services from `ForkLayer`: `WorkspaceEntries.list` (the indexed recursive listing,
`apps/server/src/workspace/WorkspaceEntries.ts:90-104`, merged in the runtime through
`WorkspaceLayerLive`, `apps/server/src/server.ts:418-421,527`), `WorkspacePaths`
(`resolveRelativePathWithinRoot`), `ProjectionSnapshotQuery` + `resolveThreadWorkspaceCwd` for
the workspace root, `ServerSecretStore.getOrCreateRandom`
(`apps/server/src/auth/ServerSecretStore.ts:144-147`) for the URL signing key, `FileSystem`
(`watch`, `stat`), `ChildProcessSpawner`, `ServerConfig.stateDir`, `SqlClient`.

### Listing

`WorkspaceEntries.list({ cwd })` gives the indexed file list (respecting the index's ignore
rules); filter by extension (case-insensitive), stat each match for size and mtime (bounded
concurrency 16), sort by path. Stop at 2,000 matches with `truncated: true`.

### Signed file route

Why not upstream assets: `assets.createUrl` only serves preview types (images, HTML, PDF and a
few web assets) for workspace files (`isWorkspacePreviewEntryPath`,
`apps/server/src/assets/AssetAccess.ts:71-81,341`) and "images, videos, HTML, and PDF" for
`media-file` (`packages/contracts/src/assets.ts:19-25`).
Model files are neither, and widening upstream's list would be an upstream seam in a security
check. A fork route with its own token keeps upstream untouched.

- Key: `ServerSecretStore.getOrCreateRandom("loom-model-preview-3d-url-key", 32)`.
- Token: base64url(JSON `{ v: 1, root, base, exp, large }`) + "." + base64url(HMAC-SHA256(key,
  payload)). `root` is the canonical workspace root (or the render cache directory), `base` the
  directory the URL may read below (the model's directory, so a `.gltf` can load its `.bin` and
  textures by relative URL), `exp` 60 minutes ahead (upstream's asset tokens use the same lifetime,
  `ASSET_TOKEN_TTL_MS`, `apps/server/src/assets/AssetAccess.ts:58`); the client requests a fresh URL
  on every revision anyway.
- URL: `/api/loom/model-preview-3d/f/<token>/<fileName>`; the client resolves it with
  `resolveAssetUrl(httpBaseUrl, relativeUrl)` (`packages/client-runtime/src/state/assets.ts:57`).
  Relative references inside a glTF resolve to `/f/<token>/<relative>`.
- Handler: verify the HMAC with a constant-time compare and `exp`; join `base` and the decoded
  path; `realpath` it and require it to stay under `root` and `base` (symlinks out are refused);
  refuse directories, and files over `maxFileMegabytes` unless the token carries
  `large: true` (minted only when the client asked with `fileUrl({ ..., allowLarge: true })`
  after the user chose "Load anyway"). Respond with the file, `Content-Type`
  from the extension (`model/stl`, `model/3mf`, `model/obj`, `model/gltf-binary`,
  `model/gltf+json`, `application/octet-stream` otherwise), `Cache-Control: private,
max-age=3600`, `ETag` from size and mtime. Use `HttpServerResponse.file` if the installed
  effect platform offers it, otherwise copy the stream approach of upstream's asset route
  (`apps/server/src/http.ts:196-215`).
- Registered in `ForkRoutesLayer` (`apps/server/src/fork/ForkLayer.ts`, EXTENSION-POINTS.md
  section 3). `/api` is already proxied by Vite in dev (`packages/shared/src/devProxy.ts:11`).
  Global CORS middleware applies (`browserApiCorsLayer`, `server.ts:590`), so app.t3.codes can
  fetch it.
- No environment auth header is needed; the token is the credential, like upstream's asset URLs.

### Watching

`watch({ threadId, path })` resolves the file, then `FileSystem.watch(dirname(file))` debounced
by 150 ms (the pattern in `apps/server/src/keybindings.ts:566-582`), filtered to the file's
basename, and emits the new `revision` (sha256 of size + mtime + inode, short). For `.scad`, it
also watches the directories of the dependencies recorded by the last render's `-d` file and
emits `dependencyChanged: true` when one of them changes. The watch lives only as long as the
client subscription, so a closed tab costs nothing.

### OpenSCAD

- Locate: the `openscadPath` setting, then `PATH` (`openscad`), then
  `/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD` and
  `/Applications/OpenSCAD-Nightly.app/Contents/MacOS/OpenSCAD` on macOS. Version:
  `openscad --version` (prints to stderr). A version string that parses as a date `YYYY.MM.DD`
  is a snapshot; `2021.01` is the last stable release.
- Capabilities from the version: Manifold via `--backend=manifold` from snapshot 2024.09.28
  (the older `--enable=manifold` stopped working then) and the default from 2025-08-17;
  `--summary` / `--summary-file` in recent snapshots (check `--help`); 3MF colors through
  `-O export-3mf/color-mode=model` (check `--help-export`).
- Render argv, run with cwd = the `.scad` file's directory:

  ```
  openscad
    -o <cache>/<key>.stl --export-format binstl        (or -o <cache>/<key>.3mf with renderColors)
    [--backend=manifold | --backend=cgal]               (backend setting; "auto" passes nothing
                                                          on snapshots that default to Manifold,
                                                          and --backend=manifold on older snapshots)
    [-p <sidecar.json> -P <set>]                        (parameter set)
    [-D <name>=<literal> ...]                           (overrides, after -P so they win)
    [--summary all --summary-file <cache>/<key>.summary.json]   (when supported)
    -d <cache>/<key>.deps
    <file.scad>
  ```

  ASCII STL is OpenSCAD's default, so `--export-format binstl` is always passed for STL.

- Timeout: `renderTimeoutSeconds`; on timeout the child's scope closes (terminating it) and the
  result is `error` with "Render timed out after N s".
- One render in flight per file: a new `renderScad` for the same file interrupts the running one
  (its result is `cancelled`). At most `max(1, cores / 2)` renders run at once across files (the
  Fabrication packet's figure), queued with a semaphore.
- Log: stderr lines starting `ECHO:`, `WARNING:`, `ERROR:`, `TRACE:`; everything else `info`;
  at most 500 lines. Exit code 0 with an output file is `ok`; OpenSCAD may exit 0 with errors in
  some cases, so an `ERROR:` line or a missing output file also means `error`.
- Summary: parse the summary JSON's geometry block (`simple` means manifold, `facets`,
  `vertices`, `bounding_box.min/max`) defensively; any missing field is null.
- Cache key: sha256 of the `.scad` bytes, the sorted overrides, the set name and the sidecar's
  bytes, the OpenSCAD version, the backend and format, and the size and mtime of every
  dependency from the previous `.deps` file. A hit returns immediately with `cached: true`.
- Cache: `<stateDir>/fork/model-preview-3d/renders/`; after each render, delete the oldest
  entries beyond 300 files or 1 GiB. `clearCache` empties it.
- Security: OpenSCAD source can read files (`import`, `include`, `surface`) but cannot run
  commands. Renders run with the server's user rights, like any tool the agent runs. `-D`
  literals are validated (numbers, `true`/`false`, quoted strings with escaped quotes and
  backslashes, vectors of those) so a value cannot inject extra statements.

### Customizer parameters

`customizer.ts` implements the OpenSCAD Customizer rules (see REFERENCES.md): top-level
assignments of literal values that appear before the first module or function definition;
`/* [Group] */` comments start groups and `/* [Hidden] */` hides the rest; a comment on the line
above is the description; a trailing comment sets the widget: `// [min:max]`,
`// [min:step:max]`, `// [a, b, c]`, `// [10:Small, 20:Large]`. Values that are expressions
(not literals) are skipped, as the Customizer does. If the installed OpenSCAD can export
parameters itself (a `param` export format appears in newer builds; not verified), prefer it and
keep the parser as the fallback.

Parameter sets live in the sidecar `<name>.json` next to `<name>.scad`, format
`{ "parameterSets": { "<set>": { "<param>": "<value as string>" } }, "fileFormatVersion": "1" }`.
`saveParameterSet` reads, merges and writes it atomically (`writeFileStringAtomically`,
`apps/server/src/atomicWrite.ts:5`), after the client's confirmation ("Save parameter set
'wide' to bracket.json?").

Last-used overrides and set per file are stored in `fork_model_preview_3d_params` so reopening
the tab restores them.

### Fabrication app

The Fabrication packet (`~/Developer/docs/apps/fabrication/ARCHITECTURE.md`, "Loom preview
contract") plans `GET /api/previews`, `/files/<sha256>`, `/events?topic=preview:<hash>` and
`/embed/model/<ref>` for this panel. The app does not exist yet. v1 only stores
`fabricationUrl` and shows "Open in Fabrication" (opens the URL in the system browser on
desktop, a new tab on web). A later packet may use the preview contract when the app ships; the
panel must keep working without it.

### Blender MCP

Not integrated; documented in `docs/fork/user/model-preview-3d.md`:

- Kyle's `~/.codex/config.toml` has `[mcp_servers.blender]` with
  `command = "/Users/kyle/.local/bin/blender-mcp"`, env `BLENDER_HOST=127.0.0.1`,
  `BLENDER_PORT=9876`, `DISABLE_TELEMETRY=true`, and `approval_mode = "approve"` for
  `execute_blender_code`. On 2026-09-24 that command does not exist (`~/.local/bin` has no
  `blender-mcp`; `uv` and `uvx` are installed at `/opt/homebrew/bin`, Blender at
  `/opt/homebrew/bin/blender` and `/Applications/Blender.app`), so Codex cannot start the server.
- Fix options (from the Fabrication packet's references; Kyle chooses):
  1. Reinstall the community server as a tool: `uv tool install mcp-for-blender` (the project was
     renamed from `blender-mcp`), then check the installed executable with
     `uv tool list --show-paths` and point `command` at it.
  2. Keep nothing installed: `command = "uvx"`, `args = ["blender-mcp"]` (the old name still
     resolves, per the project).
  3. Switch to the official Blender Lab MCP server (projects.blender.org/lab/blender_mcp, v1.0.3,
     Blender 5.1+, add-on GPL-3.0-or-later), which also offers background `*_for_cli` tools.
     In every case the Blender add-on must be running in Blender and listening (community server:
     TCP 9876). Keep the approval gate on arbitrary code execution. Codex sessions started by Loom
     read the same `~/.codex/config.toml`, so the fix applies inside Loom too; Claude needs its own
     `claude mcp add` entry.
- Blender 5.2 exports STL, OBJ, PLY and glTF natively; 3MF needs an extension. Export to the
  workspace and the panel shows it.

## Clients

- `packages/client-runtime/src/fork/model-preview-3d.ts`: atoms (queries, the `watch`
  subscription family keyed by thread and path, commands).
- `apps/web/src/fork/model-preview-3d/`:
  - `panel.tsx`: `{ id: "model-preview-3d", title: "3D model", icon: BoxIcon, shortcut: "O",
unavailableHint: "Needs a Loom server with 3D preview", isAvailable: threadRef !== null &&
loomFeatures.includes("model-preview-3d") }`. A surface without `resourceId` shows the
    picker; picking opens `openSurface(threadRef, { ...forkPanelSurface("model-preview-3d",
path), title: basename(path) })` so each file gets its own tab.
  - `ModelPanel.tsx`: picker, toolbar, viewer, side sheet (parameters and log for `.scad`),
    status bar (dimensions, triangles, manifold, revision time).
  - `viewer/` (all `three` imports live here and load through `React.lazy`, like upstream's
    `DevicePanel`, `apps/web/src/components/ChatView.tsx:600-606`):
    - `createViewer(canvas, options)`: `WebGLRenderer({ antialias: true, alpha: true })`,
      `PerspectiveCamera`, `OrbitControls` without damping, hemisphere plus directional light,
      `GridHelper` sized to the build plate, optional `AxesHelper`. `requestRender()` coalesces
      renders into one `requestAnimationFrame`; controls `change`, resize (`ResizeObserver`),
      model load and toggles call it. **No render loop.**
    - `loadModel(format, url)`: `STLLoader`, `ThreeMFLoader`, `OBJLoader`, `GLTFLoader` from
      `three/addons/loaders/...` (three maps `./addons/*` to `examples/jsm/*`). STL gets a
      `MeshStandardMaterial` in the theme's accent color and `computeVertexNormals` when normals
      are missing; 3MF keeps its materials (the loader reads the `unit` attribute, default
      millimetre; scale to mm); OBJ without MTL gets the default material; glTF as loaded.
      Draco-compressed glTF is detected (the `KHR_draco_mesh_compression` extension) and
      reported as unsupported.
    - Z-up formats (STL, 3MF, OBJ from CAD) are rotated to three's Y-up once; glTF is already
      Y-up.
    - `fitCamera`, `setView("iso" | "front" | "top" | "right")`, `setWireframe`, `setGrid`,
      `setAxes`, `boundingBox()`, `triangleCount()`.
    - `capture(views?)`: renders the requested views into an offscreen canvas at 1024 px (a 2x2
      sheet for four views, labeled), `toBlob("image/png")`, restores the camera, renders once.
      No `preserveDrawingBuffer`: the capture renders and reads in the same task.
    - `dispose()`: geometries, materials, textures, `renderer.dispose()`,
      `renderer.forceContextLoss()`; called on unmount and when the panel is hidden for more than
      60 s (then rebuilt on show), so a background tab holds no WebGL context.
  - Reload: on a `watch` event with a new revision (or `dependencyChanged`), meshes re-fetch a
    fresh `fileUrl`; `.scad` files call `renderScad` (debounced 400 ms). The camera is kept
    unless the bounding box changed by more than 50%.
  - Parameters form: number inputs with sliders for ranges, selects for options, checkboxes,
    text fields; changes debounce 400 ms into `renderScad`; "Reset", set picker, "Save as set".
  - Capture to composer: `File` from the PNG blob, `compressImageToByteLimit`
    (`apps/web/src/lib/imageCompression.ts:450`), then
    `useComposerDraftStore.getState().addImage(threadRef, ...)` and
    `syncPersistedAttachments`, following `deliverSnapShot`
    (`apps/web/src/components/desktop/SnapShotCoordinator.tsx:139-184`).
  - `palette.tsx` (the "Open file..." submenu uses `listModels`), `shortcuts.tsx`,
    `settings.tsx` (OpenSCAD status with "Refresh detection", options, limits, Fabrication URL,
    "Clear render cache").
- Theme: read the panel's computed CSS variables for background, grid and mesh colors when the
  theme changes (listen to the theme store the app uses; do not poll).

## Agent-facing tools

```ts
const RenderTool = Tool.make("loom_model_preview_3d_render", {
  description:
    "Render a .scad, .stl, .3mf or .obj file in this thread's workspace to PNG views with " +
    "OpenSCAD and return the image paths plus size and manifold status.",
  parameters: Schema.Struct({
    path: Schema.String,
    views: Schema.optional(
      Schema.Array(Schema.Literals(["iso", "front", "top", "right", "bottom"])),
    ),
    parameters: Schema.optional(Schema.Record(Schema.String, Schema.String)), // .scad overrides
  }),
  success: RenderToolResult, // { images: [{ view, path }], boundingBoxMm, facets, manifold, log }
  failure: ModelPreviewToolError,
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "Render 3D model")
  .annotate(Tool.Readonly, true);
```

- PNGs: `openscad -o <cache>/<key>-<view>.png --render --imgsize=1024,768 --autocenter
--viewall --projection=p --camera=<view preset> [--colorscheme=Tomorrow] <file>`; meshes are
  rendered through a two-line wrapper `.scad` in the cache (`import("<absolute path>");`).
  Headless PNG export works on macOS; on Linux it needs an EGL build or `xvfb-run` (Fabrication
  references: unverified for the official AppImage).
- Returns paths, not image bytes (fork toolkits cannot use upstream's private image tool
  helper, `apps/server/src/mcp/McpHttpServer.ts:499-577`); agents on the host read the PNGs.
- Gated by `agentToolEnabled`; errors when OpenSCAD is missing.

## Provider decisions

The tool is served on the shared `t3-code` MCP server to every provider; no adapter change.
Blender MCP is a per-provider configuration (Codex `config.toml`, Claude `claude mcp add`), not
something Loom wires.

## Storage

Tracking table `fork_migrations_model_preview_3d`.

```sql
-- 1_Params
CREATE TABLE IF NOT EXISTS fork_model_preview_3d_params (
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,                -- workspace-relative
  overrides_json TEXT NOT NULL,      -- { name: literal }
  parameter_set TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, path)
);

-- 2_Settings
CREATE TABLE IF NOT EXISTS fork_model_preview_3d_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
```

Files: `<stateDir>/fork/model-preview-3d/renders/` (LRU, 300 files or 1 GiB). Rows of deleted
projects are removed by a startup sweep.

## STEP (phase 4, optional)

`occt-import-js` (LGPL-2.1) reads STEP and IGES in WebAssembly and returns triangulated meshes.
Load it only when a STEP file is opened (dynamic `import()` of a separate chunk; the `.wasm`
served as a static asset by Vite). Unmodified, dynamically loaded LGPL code is the usual
compliant pattern, but Kyle must approve the dependency (PRODUCT.md question 2). Until then STEP
files are listed as "STEP preview is not enabled".

## Performance

- Idle cost is zero: no animation loop, no timers; renders happen on interaction and changes.
- The three chunk loads only when the panel opens; the main bundle does not grow.
- Mesh bytes travel over HTTP with caching, never over the WebSocket; the WebSocket carries small
  JSON (lists, revisions, render results).
- Large files: warn above `maxFileMegabytes`; parsing happens on the main thread (three's 3MF
  loader needs `DOMParser`, which workers lack). If STL parsing of big files proves slow, move
  STL only into a worker in a follow-up (STL parsing has no DOM dependency).
- One WebGL context per open 3D tab; hidden tabs release theirs after 60 s.

## Alternatives considered

- **Upstream assets for model bytes.** Refused by upstream's type allowlist; changing it is a
  security-sensitive upstream seam.
- **Base64 over RPC.** Inflates bytes by a third and pushes megabytes through the WebSocket;
  AGENTS.md warns against large WebSocket payloads.
- **`@react-three/fiber`.** Pleasant, but a second large dependency and a render loop by default;
  plain three with manual rendering is smaller and idle-free.
- **openscad-wasm in the browser.** GPL, last released 2022, heavy; the server already has the
  real CLI and the files.
- **Online3DViewer (MIT) as a drop-in viewer.** Bundles many formats and occt-import-js, but pulls
  a large dependency and its own UI; the needed loaders are four three.js addons.
