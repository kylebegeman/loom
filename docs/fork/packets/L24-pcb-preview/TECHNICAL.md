# L24 technical design

PCB preview renders on the connected environment host and sends SVG text over typed
WebSocket RPC. Web and desktop use the same lazy panel. An SVG is displayed as an image
from a revocable Blob URL, never inserted as executable DOM. Mobile has no PCB surface.
No production dependency, database migration, hosted rendering service or Electronics
app is required.

## Workspace and permissions

The service resolves the thread through `ProjectionStoreV2`, reads its project through
`ProjectStoreV2`, and prefers the thread's worktree over the project root. Design paths
are workspace-relative identifiers. Canonical paths and symlinks must remain inside
that workspace. The absolute entry path exists only for the optional Electronics link.

Discovery and reads require `orchestration:read`; rendering and checks require
`terminal:operate`. Client mutations use `createEnvironmentRpcCommand`, including
permission atoms and cancellable result atoms. Server authorization remains authoritative.
A capability gate hides unsupported palette actions and disables the launcher for upstream
servers. Provider adapters stay unchanged. PCB and expanded L23 tools register on the shared MCP
server with retained ForkRuntime and invocation dependencies. CLI commands call that same
authenticated boundary. Canvas commands use an acknowledged client bridge; host CAD and
persistence operations remain service methods.

## Tool boundary

Loom searches PATH, the standard macOS KiCad application, and the circuit's nearest
package root for `node_modules/.bin/tsci`. Detection is cached for one minute. KiCad 8
and earlier are rejected. KiCad 10.0.6 was exercised; executing KiCad 9 remains unverified.
tscircuit 0.0.2764 was exercised and requires Bun. Discovery never executes a project's
local tsci before the client trust decision. Trust is remembered per environment and
project on this device.

KiCad exports every schematic sheet and an aligned SVG per selected canonical board layer.
Custom layer labels are mapped back to their canonical names. Front and Back include
that side's copper, paste, silkscreen and mask with Edge.Cuts. All copper includes F.Cu,
B.Cu and the board's declared inner copper layers. DRC requests schematic parity only
when the design has a schematic. Checks use saved zones and do not refill or modify boards.

The exact CLI argument arrays live in the service and are verified by service and real-tool
tests. Processes receive no shell command strings. There is one permit per tool; timeouts
are 60 seconds for KiCad previews, 120 for tscircuit and 180 for checks. Output is bounded
and logs retain the last 40 lines with an 8 KiB cap.

Project code runs with a filtered environment and `ProcessRunner.extendEnv: false`.
Filtering alone would still inherit omitted server secrets. This is an explicit process
boundary, not a sandbox for trusted project code.

tscircuit writes routing artifacts to its working directory. Each run therefore uses a
temporary package mirror that preserves source directory structure and links validated source
files/dependencies, retaining relative import and configuration resolution without copying the
project. Generated/private folders are excluded.
Runtime caches are directed into that task's temporary directory. Successful, failed and
cancelled runs remove their temporary outputs and runtime directories.

## Revisions, storage and lifetime

A bounded source scan fingerprints relevant files by workspace path, size, mtime and inode.
It follows explicit local source, schematic and library references within the workspace.
Nested directories and circuit assets participate. Generated folders and installed packages
are excluded. Limits are 2,000 relevant files, 512 directories and 20,000 visited files;
exceeding coverage fails explicitly instead of silently presenting a partial live revision.
External libraries and dependencies installed under node_modules are outside live coverage.

Directory subscriptions remain active during reconciliation. A single dirty signal coalesces
bursts; saved changes debounce for 350 ms. Newly created directories gain subscriptions;
all subscriptions close when the visible panel unmounts. Watch failures preserve manual
refresh. Rendering remains possible when only the watch backend fails.

An explicit Refresh bypasses completed cache entries so tool/library changes and damaged
cache files can recover. Schematic cache keys ignore PCB layer selection.

Cache keys include workspace and design identity, source revision, tool version, view and layer preset.
Consumers sharing a render key lease one service-owned job. A consumer cancellation leaves
the job alive for other readers; the last departure interrupts it and removes temporary work.
Clients release obsolete request leases when their revision changes. A render whose
sources changed during its build is rejected. Only regular SVG outputs are accepted and
the manifest is written last. Cache reads validate workspace ownership and serialize with
pruning. Completed render storage is limited to 100 entries and 200 MiB. Startup removes
abandoned pending directories. Sheets over 4 MiB are reported without sending their text.

The latest ERC and DRC reports persist independently per workspace/design. History is
bounded to 100 files and 20 MiB, with 500 findings and 1 MiB of finding content per report.
Full error, warning and excluded counts survive truncation. Newer completed reports cannot
be overwritten by an older concurrent completion. Check commands refresh the shared query;
reopening revalidates it. Checks never run automatically.

Circuit JSON is cached once per design revision and shared by inspection and both SVG views;
asset jobs use the same cancellation leases. GLB URL and inline reads reuse bounded completed
geometry. Explicit force bypasses these caches as well as SVG storage.

The visible design owns render/check subscriptions and one last-good drawing. Hiding or
closing it cancels jobs and releases reads/watchers. The 3D view suspends hidden 2D rendering
and reads while retaining source watching and saved checks. Refresh targets the active view. A manual retry also re-requests SVG
bytes, even if the server returns the same cache key. Changing sheets fits the new drawing;
live updates preserve navigation. Displayed revision metadata advances only after its sheet
read completes, and capture waits for the base image and all visible layers to decode.
Rendering schedules frames only for input, image load or resize. Elapsed timers run only while an operation is pending.

Composer summaries append to the current scoped draft and never send a message. Copy uses
upstream's clipboard helper, including its plain-HTTP fallback. Device preferences use
schema-validated storage with bounded project selections and trust records. Electronics
URLs accept HTTP/HTTPS without credentials and preserve a configured path prefix.

## Editor state and authoring

Saved views, layer sets, revision-aware measurements/annotations, simulation setups and
parameter variants live in bounded workspace-specific JSON under the feature state directory.
Updates use optimistic versions and serialized writes; client workspace subscriptions share
completed versions. Workspace save controls require loaded data and write permission; failed
saves retain names for retry. Layer identities reconcile against the current source while
preserving existing visibility and opacity. Hardware catalog updates have their own version. Imports validate every
linked file and publish immutable content directories, preserving originals and refusing
conflicting content. Destination parents are validated before descendants are created, so
escaping symlinks cannot create folders outside the target workspace. Existing missing links
do not block catalog metadata edits; newly linked files and every import are validated. Starter catalog entries contain manufacturer references, not downloaded
CAD files. Shared references include GLB geometry and mechanical metadata tied to one source
revision; destination thread access is checked before writes.

Parameters require a bounded schema sidecar and one explicit literal marker per key. Source
hash checks prevent writing over concurrent edits. Numeric ranges, types and choices are
validated; source values are read from those same literals. Revision comparisons use isolated
Git snapshots with local dependencies and aligned physical SVG frames. Git object reads use
workspace-relative paths even when the thread root is a repository subdirectory. KiCad
schematic connectivity is exported independently from each staged revision, including
hierarchical sources; schematic-only comparisons also include root-sheet drawings. No Git
mutation is performed in the user's working tree.

ngspice runs as a bounded process in scoped temporary state with startup scripts disabled (`-n`). Supplied/exported netlists reject
host file includes and arbitrary control commands; requested analysis and sweeps replace
exporter analysis directives. Results include source/netlist revisions, bounded probes/samples
and complex AC data. This is a process boundary, not a security sandbox for project code.

## 3D and agent transport

GLB defaults to an expiring signed HTTP URL, scoped to an exact regular cached board file.
It is capped at 128 MiB and participates in the 200 MiB/100-entry render cache. Explicit inline
transport remains capped at 16 MiB. The client streams the file through the environment's URL
resolver, avoiding duplicated base64 and Blob memory. PCB HTTP routes reuse L23 signing without
changing its file roots. tscircuit's exporter uses millimetres in GLB, unlike standard glTF
and KiCad's metre exports. The circuit adapter wraps each scene with a 0.001 scale before
publishing either transport; binary meshes remain unchanged. A distinct cache version excludes
older exports with the wrong scale. Circuit inspection also exposes non-plated mounting holes
and slot dimensions in mechanical metadata. The feature-owned `.loom/pcb-references` outputs are
excluded from source revision scans to prevent exports from invalidating themselves. Export-reference copies this geometry atomically to the
destination and refreshes its workspace index so the model editor can discover it.

The visible PCB and 3D editors expose actions and snapshots through a shared bridge. Requests
are ordered, bounded and delivered to the latest matching connected client. Acknowledgements
must match the thread/file/request; capture claims occur before writing bytes, so expired or
duplicate acknowledgements cannot create files. Open/close/maximize use the thread panel host.
Actions needing a loaded canvas fail explicitly. Service work remains available without an
open client. MCP cancellation releases the same job leases as client cancellation.

CLI commands use `LOOM_MCP_ENDPOINT`/`LOOM_MCP_AUTHORIZATION`, falling back to the existing ACP
MCP environment variables. They validate object arguments, preserve JSON results and fail the
command when MCP reports a tool failure. Credentials are never persisted by the feature.

Tool version probes for tscircuit run in scoped temporary directories. Its CLI initializes
cwd-local caches even for detection; never probe in the user's workspace. Circuit startup is
allowed 15 seconds because loading the installed CLI can exceed five seconds on a busy host.
