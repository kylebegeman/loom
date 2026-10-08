# L24 verification

## Local evidence, 2026-10-08

The expanded implementation is checked locally on `feat/loom-pcb-preview`, based on
`23b9bdc48dc8ca3356df5b686c11e02a7519cb76`. It has not been merged or released.

- 93 distinct focused backend tests across 17 files cover discovery, physical SVG frames,
  semantic inspection, parameters, simulation parsing, report validation, persistence,
  bounded caches, signed HTTP files, job leases, cancellation, permissions, editor receipts,
  cross-thread reference authorization, hardware reuse, MCP registration and CLI transport.
  The final service regression suite contains 26 of these tests; reruns are not added
  to the total.
- 38 distinct web tests across 12 files cover preview eligibility/lifetime, drawing navigation,
  focus after image decode, summary preparation, loading timers, URL/listener cleanup,
  clipboard fallback, registry entry points, customizer state, model picking/save failure,
  operation exclusion, named-view capture restoration, paused hidden 2D work, 3D refresh/readiness,
  stale sheet-read metadata and failed workspace save retries.
- 14 contract/runtime tests verify fork keybindings and command permissions.
- One opt-in real-tool integration test passed with official KiCad 10.0.6, tscircuit
  0.0.2764/Bun and ngspice 47. It executes three schematic sheets, Front/Back/All copper,
  custom inner-layer labels, ERC (40 findings), DRC (68 findings), linked semantic inspection,
  both tscircuit drawings, actual GLB exports, a board above the 16 MiB inline limit, SPICE
  operating point/transient/AC/sweeps, Git/checkpoint comparison and intentional build failure.
  It verifies millimetre-to-metre GLB normalization and removal of scoped output directories.

Total: 146 distinct passing tests after the active bug/integration audit. Fake process tests establish behavior, while the opt-in
integration establishes compatibility with these installed tool versions. Audit regressions
cover same-folder design cache isolation, nested Git roots, historical schematic connectivity,
shared circuit builds and failures/timeouts, destination symlinks, missing hardware links,
mounting holes and simulation startup isolation/cleanup. Confirmed regressions were reproduced
before their fixes; the final focused and real-tool runs pass.

Contracts, client-runtime, server and web typechecks passed. Effect informational suggestions
are not errors. Targeted fork lint passed; linting the complete upstream ChatView file reports
existing React/compiler warnings outside the three-line presentation seam. The seam manifest,
local Markdown links and whitespace were checked separately, without repo-wide checks.

Mobile was attempted using temporary dependency links to avoid another installation. That
mixed installation is incompatible with this checkout's React Native/Uniwind versions and its
typecheck failed. Those temporary links were removed. No native mobile implementation changed;
shared contracts/runtime passed. This is not a mobile verification claim.

## Integrated Browser evidence

The native T3 Browser exercised a meaningful isolated workspace, with official KiCad demos
and an explicitly synthetic resistor/capacitor tscircuit circuit. Local web and desktop share
the tested web bundle; no Electron-specific CAD behavior was introduced.

Verified interactions include launcher/panel layouts, sheet and layer selection, fit/zoom,
linked component/pin/net focus, saved views, measurements and notes with removal, visible/full
captures appended to an existing draft, trust and circuit rendering, live source reload,
parameter review/apply and variant save/remove, transient simulation with waveform results and
setup save/remove, hardware ownership/context and local asset import. Loading and elapsed
states appeared during exports, inspection and checks. ERC/DRC counts matched actual CLI output.
A failed rebuild retains the previous drawing. Light/dark canvas backgrounds were inspected.

The board reference export produced a GLB and revision metadata. Opening it in the existing
3D model editor reports 24.00 × 20.00 mm, matching the source and metadata. Live editor RPCs
created a 5 mm measurement, picked/saved an annotation, captured a marked PNG and four views,
selected the Views inspector and prepared a marked request in the draft. Captures were inspected.
Host export operations and client editor acknowledgements crossed the actual RPC boundary.
This is not a claim of invoking the new tools from a live provider session; MCP authorization,
registration and the authenticated CLI protocol have separate focused coverage.

Drawing tests verify no continuing frame loop after settled navigation and cleanup of frame
requests on unmount. The 3D viewer renders on load/input/resize. Browser observations are not a
measurement of physical GPU utilization. Native Browser metadata sometimes reports hidden while
`document.visibilityState` reports visible; redundant test tabs were closed and one review tab
is retained. The audit pass confirmed loaded 2D/3D drawings, forced 3D refresh with elapsed
loading state and disabled capture controls, isometric navigation, named-view save/removal,
disabled 2D view saving while in 3D, decoded KiCad layers and visible-area capture. The layer
loading status was hidden after decode. The host again disconnected during the resize attempt,
so that responsive check remains unverified. Snapshot capture became unavailable while
native evaluation and interactions still worked, then all automation disconnected. No
alternative browser automation was used.

## Compatibility limits

- KiCad 9 flags were not executed. The UI detects version requirements, and KiCad 10 is needed
  for GLB export. Installed models determine component geometry; simulation needs valid SPICE
  models/ground or a supplied self-contained netlist.
- Local RPC and signed HTTP transport were exercised. A remote plain-HTTP host, relay/tunnel,
  Windows host and every version-skew combination were not driven end-to-end.
- The complete matrix of palette/assigned shortcuts, empty/missing/old-tool states, reconnects,
  trust revocation, cancellation and failures was not driven in a native client. Focused tests
  cover relevant eligibility, failure, cancellation, permission and lifetime behavior.
- No mobile PCB surface exists. No KiCad GUI signoff, fabrication validation or print readiness
  is claimed. Provider adapters and deployment infrastructure are unaffected.

## Focused rerun

Use Node 24 and the frozen-lockfile installation. Run from each package, not the repository
root, and do not use `loom.sh check` as a substitute for these scoped checks.

From `apps/server`:

```sh
pnpm exec vp test run src/fork/pcb-preview src/fork/cli/callTool.test.ts \
  src/fork/editorBridge.test.ts src/fork/sharedJobs.test.ts \
  src/fork/mcp/registration.test.ts src/fork/rpcAuthorization.test.ts \
  src/fork/features.test.ts src/fork/model-preview-3d/mcp.test.ts \
  src/fork/model-preview-3d/http.test.ts src/processRunner.test.ts
```

From `apps/web`:

```sh
pnpm exec vp test run src/fork/pcb-preview src/fork/panels/registry.test.ts \
  src/fork/commandPalette/registry.test.ts src/fork/settings/registry.test.ts \
  src/fork/model-preview-3d/ScadCustomizer.test.tsx \
  src/fork/model-preview-3d/useModelEditing.test.tsx \
  src/fork/model-preview-3d/viewer/captureSheet.test.ts
```

Run `packages/contracts/src/fork/keybindings.test.ts` and
`packages/client-runtime/src/state/commandPermissions.test.ts` from their respective packages.
Typecheck the four affected packages and lint changed source paths.

`realTools.test.ts` skips unless `LOOM_TEST_PCB_FIXTURES` points at a task-owned fixture root
containing complex_hierarchy, four-layer/One-Air-Max.kicad_pcb and a circuit entry. Supply
real `kicad-cli`, `tsci`, Bun and ngspice on PATH. Never point it at a user's project: the test
copies fixtures into scoped state and intentionally changes source in that copy.

## Resource ownership

Completed tests remove scoped files. Redundant fixture copies, temporary mobile dependency
links, generated workspace caches and obsolete scratch are removed after verification. Keep
only the active review preview's dependencies, isolated state, small demo and installed test
tools/mount until review ends. End of turn is not preview teardown. Do not purge live Loom
userdata, another task's installation, or other projects' resources.
