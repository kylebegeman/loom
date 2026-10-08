# L23 technical design

Integrated on `main` with Loom `0.0.46-nightly.20261007.2787`.
The contracts and current source define the API; this document records constraints that span
components. See [TESTING.md](./TESTING.md) for verification and [SEAMS.md](./SEAMS.md) for
upstream touches. The original packet's v0.0.42 sketches have been replaced by this implementation.

## Environment ownership and transport

The server resolves each thread's workspace through V2 `ProjectionStoreV2` and `ProjectStoreV2`.
Worktree paths take precedence over the project root. Model paths are relative to the canonical workspace root.
Containment checks reject traversal and symlinks outside it. Discovery reuses `WorkspaceEntries`
and returns at most 2,000 model entries. STEP entries are discoverable but never rendered.

Mesh bytes use `/api/loom/model-preview-3d/f/<token>/<path>`, separate from upstream's asset
allowlist. HMAC-signed tokens authorize reads below both a root and a model directory, expire
after one hour, and encode the explicit large-file override. Real paths are checked again on
HTTP access. glTF buffers and textures must be below that directory; authored external and
parent-directory references are refused. The client resolves relative URLs against the selected
environment's HTTP base, preserving local, remote and relay origins. WebSocket messages carry
metadata and bounded workspace entities, not mesh bytes.

`ForkRoutesLayer` and MCP registration bind the retained `ForkRuntime` during layer construction.
Request contexts must reuse that value rather than constructing another service or relying on a
missing runtime reference. Feature capability checks hide or disable entry points against an
upstream T3 server. Web and desktop share the panel; mobile has no 3D UI. No provider adapter or
upstream orchestration event changes are needed.

## OpenSCAD and source provenance

Detection tries the configured executable, PATH and macOS application locations. Version,
`--help` and `--help-export` determine backend, summary and color-export support. Detection is
cached for 60 seconds and invalidated by settings changes or explicit refresh. The verified
build is the official macOS 2026.10.05 snapshot; other platforms must supply their own working
OpenSCAD installation. PNG export on Linux may require a display-capable build or virtual display.

Preview jobs use binary STL, or colored 3MF when enabled. Validated literal overrides and
sidecar sets become argv entries, never shell text. Jobs have a timeout, bounded logs, a global
render semaphore and one current job per canonical file and cancellation identity. A newer
preview cancels the prior preview. Variants and comparisons use separate identities and do not
persist active parameters. Client interruption and cache clearing cancel child work and remove
incomplete artifacts.

The customizer parser reads supported top-level literal assignments, groups, descriptions,
ranges, options and Hidden sections. Parameter definitions and their source identity come from
the same read. Source identity also includes recorded dependency revisions. Refreshing definitions
precedes rendering after a source change; removed or type-incompatible remembered overrides and
deleted set selections are dropped. The JSON sidecar preserves other sets and extra metadata;
saving a set is a serialized atomic write initiated by the naming dialog.

Render cache keys include canonical source identity, source bytes, sorted overrides, set,
sidecar contents, OpenSCAD version, backend, format and dependency metadata. Successful outputs
use the cache key as geometry revision. Cache-access timestamps must never invalidate surface
anchors. Before publishing a new output, the service checks for edits to the source, sidecar or
known dependencies during rendering; a changed-input result is discarded and cannot update
remembered parameters. Temporary outputs are promoted only after successful validation.

Dependency lists survive cache pruning and restart in a separate directory. File watchers cover
the source, sidecar and discovered dependencies, debounce filesystem changes, and refresh their
directory subscriptions when dependencies change. Closing the panel releases its subscriptions.
The render cache is limited to 300 files or 1 GiB. Active outputs have reference-counted protection
acquired under the pruning lock and released with the job scope, including cancellation.

## Viewer and capture lifetime

Three.js 0.186.0 and its loaders are lazy-loaded by the viewer. The only added dependencies are
`three` and `@types/three`. Rendering is on demand: one coalesced animation frame for a change,
without damping, playback or a frame loop. Theme changes and resize request a frame; a hidden
viewer stops drawing and releases its WebGL context after 60 seconds. Comparison viewers live
only with the comparison dialog. Temporary thumbnail viewers are disposed immediately on
completion or cancellation.

STL and OBJ are treated as millimetres. 3MF coordinates, transforms and lattice radii are
normalized from recorded units to mm before loading; mm archives avoid a ZIP rebuild. glTF/GLB
convert metres and Y-up coordinates to mm and Z-up. Draco-compressed glTF is unsupported.
Cancellation aborts fetches and the glTF loading manager. Disposal includes mesh, line and point
geometries, materials, deduplicated textures, decoded ImageBitmaps, helpers and the WebGL context.

The responsive workspace keeps the SCAD controller mounted while its inspector is hidden or
showing another section. Paused Auto preview keeps form edits separate from applied values until
Apply. Successful-render parameters and loaded geometry revisions provide capture provenance;
a failed render retains the previous mesh and its parameters. Loading states describe refresh,
render, download, preparation, capture, save and batch stages. Elapsed-time timers run only
while those operations are mounted; there is no continuously animated loading indicator.

Current-view, standard four-view and named-view captures snapshot pixels synchronously and
restore the working camera, controls and display before asynchronous encoding. They attach
through upstream's composer draft and attachment persistence APIs. Overlapping captures are
excluded. Annotation requests append context and images to an existing draft without sending a
provider turn.

## Persistence and editing workspace

Fork migrations own settings, remembered parameters and model workspace tables in the existing
SQLite database. Parameters and workspace entities use project ID plus canonical root and
relative model path; this prevents different worktrees from sharing edits. Legacy unscoped
parameters are read only for the main checkout, with scoped values taking precedence. A startup
sweep removes state for deleted projects.

Workspace mutations merge individual entity identities under a semaphore. An agent proposal
batch is atomic. Each subscription has its own sliding-one notification queue and reads current
state after notification, so unrelated activity cannot displace its last relevant update.

Named views, measurements, capture presets, candidates and annotations persist on the environment.
Schema limits bound each collection. Undo history is session-local and bounded; a changed source
establishes a new baseline. Measurement and annotation anchors become stale with changed geometry.
Saved views refit on changed geometry; accepted reviews retain the revision that was reviewed.
Variant thumbnails cannot restore deleted candidates or overwrite values edited during rendering.

Review images are content-addressed JPEG files below `review-images`; the database stores image
identities and responses contain signed HTTP URLs. Image URLs last seven days and refresh when
workspace state is read. Clearing render cache preserves references. Startup and removal/replacement
of image references reclaim files only when no persisted workspace still references them.

## Agent tools and optional integrations

The shared `t3-code` MCP server exposes `loom_model_preview_3d_render` and
`loom_model_preview_3d_propose_variants`. Both check the feature's `agentToolEnabled` setting
and derive workspace access from the authenticated invocation thread. The render tool accepts
SCAD, STL, 3MF and OBJ, returns host PNG paths, logs and geometry summaries, and does not render
glTF/GLB. The 3MF wrapper normalizes units for the tested OpenSCAD import behavior. Variant
proposals accept up to 12 named alternatives, use validated OpenSCAD literals and enter the
same workbench without editing source or promoting a candidate.

Fabrication is an optional URL link with no API dependency. Blender stays external: provider
MCP configuration produces files for Loom to preview. STEP import, print-readiness analysis,
slicing and printer control are outside this completed scope.
