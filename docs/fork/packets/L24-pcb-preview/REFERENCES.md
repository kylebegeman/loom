# L24 references

Treat external repositories as references, not code to copy.

## Old Loom

"KiCad circuit board design and management": PCB preview (L24), split out in
[selections.md](../../selections.md) (Outcomes); the workbench is the Electronics app. Old
Loom (`bagelvault/loom` 0.13.10) had no KiCad integration; it had a tscircuit "Hardware
Studio" area:

- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/studio/StudioHardwareSurface.tsx
  (666 lines: board source editor, snapshot, BOM). Drop: a full authoring surface belongs to
  the Electronics app.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/studio/StudioHardwarePreview.tsx
  (lazy `RunFrame` from `@tscircuit/runframe/runner`). Drop: in-browser evaluation of
  project code and heavy dependencies.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/studio/StudioHardwareSurface.logic.ts
  (`evaluateCircuitJson` via `@tscircuit/eval`; render URLs pointing at
  `svg.tscircuit.com`). Drop: sends designs to an external service.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/hardwareStudio/Layers/HardwareStudio.ts
  (1,159 lines). Drop: its "export" wrote a marker file and a JSON manifest, never real
  outputs.
- https://github.com/bagelvault/loom/blob/a79ec506/pnpm-workspace.yaml (lines 130-185:
  `packageExtensions` needed just to install the tscircuit web packages). The main lesson:
  keep tscircuit out of the web bundle and call its CLI on the server.

## Standalone Electronics app (optional, never a dependency)

`~/Developer/docs/apps/electronics/` (Kyle's workspace docs, not in this repo):

- `README.md`, `SPEC.md`: the app owns authoring, checks for signoff, parts, costing and
  order packages; it names "Loom's PCB preview panel" as a consumer.
- `ARCHITECTURE.md`, "Loom preview contract": `GET /api/previews?path=&view=`, `/files/<sha>`,
  `/events?topic=preview:<hash>`, `/embed/pcb/<ref>`. This packet does not use that
  contract; it only links to the app when a URL is configured. A future packet could render
  through the app when it is reachable.
- `SPEC.md` section 5, "Open by path", and `ARCHITECTURE.md`, "Loom preview contract":
  `/designs/by-path?path=<abs>`, added on 2026-09-24 for this packet's "Open in
  Electronics" link (redirects to a linked library design, otherwise shows the path source
  read-only).
- `REFERENCES.md`: verified tool facts (KiCad 10.0.6 current, `kicad-cli` path on macOS,
  `tsci build`/`export` formats, licenses), reused here.

## Current Loom boundaries

Integration baseline: `23b9bdc48dc8ca3356df5b686c11e02a7519cb76`.

- `apps/server/src/processRunner.ts`: argv-based processes, timeouts, output limits and
  explicit environment inheritance.
- `apps/server/src/orchestration-v2/ProjectionStore.ts` and `ProjectStore.ts`: thread,
  project and worktree lookup. The earlier ProjectionSnapshotQuery design is obsolete.
- `apps/server/src/workspace/WorkspacePaths.ts` and `WorkspaceEntries.ts`: validated
  workspace-relative paths and bounded design discovery.
- `apps/server/src/atomicWrite.ts`: publishing complete manifests and reports.
- `packages/client-runtime/src/state/runtime.ts`: guarded commands, queries and scoped
  subscriptions for local and remote environments.
- `apps/web/src/composerDraftStore.ts`, `hooks/useCopyToClipboard.ts` and
  `rightPanelStore.ts`: summary preparation, remote copying and panel lifetime.

## External

- KiCad CLI reference (KiCad 10): https://docs.kicad.org/10.0/en/cli/cli.html. Flags used:
  `sch export svg --output --exclude-drawing-sheet`, `pcb export svg --layers --mode-single
--fit-page-to-board --exclude-drawing-sheet --drill-shape-opt`, `sch erc` / `pcb drc`
  with `--format json --severity-all --units --exit-code-violations` (exit 5 on
  violations), `pcb drc --schematic-parity`. KiCad is GPL-3.0-or-later; this packet only
  runs the installed executable.
- KiCad report schemas: https://schemas.kicad.org/erc.v1.json and
  https://schemas.kicad.org/drc.v1.json (redirect to
  `gitlab.com/kicad/code/kicad/-/raw/master/resources/schemas/`). DRC: `violations`,
  `unconnected_items`, `schematic_parity`, `coordinate_units`, `kicad_version`; ERC:
  `sheets[].{path, uuid_path, violations}`. Violation: `type`, `description`, `severity`
  (`error` | `warning`), `excluded`, `items[].{uuid, description, pos.{x,y}}`.
- KiCad 10.0.6 help and actual invocations were verified. KiCad 9 execution remains
  unverified; confirm its export/check flags on an installed KiCad 9 CLI. The attempt to
  read the official KiCad 9 CLI page returned HTTP 403 on 2026-10-07.
- tscircuit CLI: https://docs.tscircuit.com/command-line/tsci-export (`tsci export <file>
-f schematic-svg|pcb-svg -o <path>`), https://docs.tscircuit.com/command-line/tsci-build
  (entrypoint discovery, `*.circuit.tsx`, exit 1 on evaluation errors). tscircuit is MIT;
  this packet only runs the installed CLI. `tsci --version` and both export formats were verified with 0.0.2764 and Bun.
- Reference repositories in selections.md: none are relevant to PCB rendering.

## Expanded tool references

- KiCad 10 CLI GLB export: https://docs.kicad.org/10.0/en/cli/cli.html#pcb_export_glb.
  Actual flags include tracks, pads, silkscreen and soldermask. Its GLB uses standard metres.
- tscircuit export formats: https://docs.tscircuit.com/command-line/tsci-export. Actual installed
  0.0.2764 exports Circuit JSON, GLB and SPICE as well as the two SVG views. Its
  `circuit-json-to-gltf` dependency documents a Y-up millimetre world frame. Installed source
  and real GLB bounds were checked; Loom normalizes that output to standard metres.
- glTF 2.0 coordinate/unit convention: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html.
  Linear distances are metres; L23 converts metres to its millimetre modelling space.
- ngspice manual: https://ngspice.sourceforge.io/docs/ngspice-manual.pdf. Actual ngspice 47
  batch runs verified operating point, transient, AC, raw vectors and parameter sweeps.
- tscircuit design engine: https://github.com/tscircuit/tscircuit. Loom uses its installed CLI
  rather than evaluating project code in the browser.

The starter hardware catalog's provenance is each entry's manufacturer page: Raspberry Pi
Pico documentation, Arduino Uno Rev3 documentation, Espressif ESP32-DevKitC guide and Adafruit
Feather overview. The shipped catalog links these sources; it does not redistribute their
CAD files or infer that Kyle owns them. Exact board revisions and asset licenses remain entry
metadata. KiCad demo provenance is official complex_hierarchy and One-Air-Max; the small
resistor/capacitor and divider-netlist fixtures are synthetic verification data.
