# L70 technical design

## Build isolation and reuse

Candidate rendering stays inside `PcbPreviewService`, reusing `runRender` with an optional
applied source. `commitRender` was extracted first without changing ordinary rendering.
There is no separate `makeVariantBuilds` factory or second export pipeline.

The service reads the current declared parameters, checks their source-text hash, and uses
`applyCircuitParameters` for the candidate values. The candidate cache key combines the normal
workspace, design, dependency fingerprint and tool-version fields with a hash of the applied
source. Identical candidates reuse the same complete cache entry.

`temporaryCircuitCwd` stages the package using L24's isolation rules. Before writing the
candidate source, rendering removes the staged source symlink and creates a regular file.
The user's source is never the candidate write target. The existing process runner exports
Circuit JSON and PCB SVG, and normalizes the SVG in the board's millimetre frame. L55's pure
`boardStats` reads that candidate JSON and inspection, without rereading the saved board.
A `variant-stats.json` sidecar is committed alongside the normal manifest and sheets. The
existing workspace-scoped `readSheet` serves the candidate drawing.

The service checks both the source-text hash and dependency fingerprint again after rendering.
An edit during export produces a conflict, so the client cannot label an old candidate with a
new revision. Work runs in service-owned scoped fibers. `cancelVariant` interrupts the matching
thread/design/variant job; the process runner and scoped staging/cache cleanup follow that
interruption. Ordinary builds and candidates share the existing `tsci` permit.

## Persistence and limits

The shared contract constants keep sweeps at 8 candidates and saved workspaces at 24 variants.
The optional timing experiment was unavailable because `tsci` is not installed; no build-time
claim or change to the approved limits is based on simulated exports.

Defaulted variant fields preserve old workspace decoding: user origin, null thumbnail, render
reference, rendered revision, stats and error. Thumbnails are limited to 24,000 characters;
24 thumbnails total about 0.58 MB within the existing 4 MiB workspace limit. Candidate artifacts
share the normal bounded render cache and may be evicted. Comparison rebuilds an evicted
candidate when execution and write permissions allow it.

`sourceHash` on a saved variant records the parameter source-text hash when its values were
saved. `renderedRevision` records the design/dependency fingerprint returned by rendering.
Those hashes have different purposes and are not interchangeable.

## Client lifecycle

`VariantWorkbench` owns the grid/table, typed sweep dialog, selection and batch progress.
One or two axes produce inclusive numeric ranges snapped to step and clamped to bounds,
choice subsets, both boolean values, or comma-separated strings. Duplicate values collapse
before the Cartesian product is bounded. Creating a sweep saves the candidates and starts
rendering if authorized. Saving or duplicating a named variant leaves it queued.

`runVariantBatch` performs render, sheet read, thumbnail and serialized workspace save for one
candidate at a time. Every awaited stage checks ownership. Individual failures save a bounded
log and continue; source conflicts stop the batch. Saves patch an existing candidate only if
its values still match, so another client's edit or deletion cannot be overwritten or resurrected.
The normal batch drops full SVGs after rasterizing; only comparison temporarily retains them.

Cancel, panel/tab exit, source revision changes and permission revocation invalidate ownership
and stop the host job. Parameters receives stable write authorization rather than the transient
workspace-save pending flag, so saving one result does not cancel the next candidate.
An agent request ID is consumed once, including across workspace updates.

`variantImages` aligns both SVG roots to their union physical view box. `VariantCompare` uses
side-by-side images or L60's existing `ComparisonImages` for overlay, A, B and difference,
with optional labels. Closing while A loads prevents B from starting. Blob URLs and raster
canvases are released. Browser rasterization and visual alignment still require a real-client
pass.

Promotion passes the chosen values directly into the existing preview operation, avoiding a
React state-update race. Review retains the original source hash for Apply even if the parameter
query refreshes meanwhile. The server's existing hash check remains the authority for writing.

## Agent access and permissions

`loom_pcb_propose_variants` validates through the same parameter helper as rendering and appends
up to 8 proposals under the workspace storage permit. It enforces 24 saved entries, assigns
`origin: "agent"`, and publishes through the existing workspace stream. CLI access is
`t3 pcb propose_variants` through the existing generic tool route.

The `render-variants` editor action opens Parameters, checks design type, current-version state,
trust, terminal/write grants and requested IDs, then queues work and acknowledges immediately.
It does not hold the editor bridge open for the batch. The palette opens the sweep dialog;
a KiCad panel reports that sweeps require tscircuit. No new keybinding is added.

Both new RPC commands use the fork's protected terminal scope tables on client and server.
Saving still uses the protected workspace mutation. Trust remains a per-device panel preference:
the service has no trust store, and the panel refuses to invoke builds until circuit code is
allowed. Existing host render tools retain their prior behavior.

Web and desktop share the panel. Mobile has the additive contracts but no PCB UI. All host work
uses environment RPCs, so local, remote, relay and tunnel share the same paths. The existing
`pcb-preview` capability gates the panel against upstream servers. There are no upstream seams
or new dependencies.
