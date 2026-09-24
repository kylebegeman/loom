# L24 references

Treat external repositories as references, not code to copy.

## Old Loom

[selections.md](../../selections.md) lists "KiCad circuit board design and management" under
"Under consideration". Old Loom (`bagelvault/loom` 0.13.10) had no KiCad integration; it had
a tscircuit "Hardware Studio" area:

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

## Upstream T3 Code

- `apps/server/src/processRunner.ts:20-36,140-145`: `ProcessRunInput` and `ProcessRunner`.
- `apps/web/src/composerDraftStore.ts:571` (`setPrompt` in the store interface) and `:4073`
  (`useComposerDraftStore`): how "Send summary to chat" fills the composer; the same path
  L06 uses.
- `apps/server/src/workspace/WorkspacePaths.ts:92-118`: `resolveRelativePathWithinRoot`.
- `apps/server/src/workspace/WorkspaceEntries.ts:90-107`: `search`.
- `packages/contracts/src/project.ts:9,17-25`: `ProjectSearchEntriesInput`, limit 200.
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:50-56,201-203,279`:
  thread checkpoint context (workspace root and worktree path).
- `apps/server/src/checkpointing/Utils.ts:12-24`: `resolveThreadWorkspaceCwd` (worktree first).
- `apps/server/src/keybindings.ts:568-569`: debounced `fs.watch` pattern.
- `apps/server/src/atomicWrite.ts:5`: `writeFileStringAtomically`.
- `apps/web/src/rightPanelStore.ts:160`: `closeSurface`.
- `packages/contracts/src/auth.ts:81-88`: scope constants.

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
- KiCad 9 flag parity with 10 for `pcb export svg --mode-single` and `--fit-page-to-board`
  is UNVERIFIED; confirm with `kicad-cli pcb export svg --help` on a KiCad 9 install.
- tscircuit CLI: https://docs.tscircuit.com/command-line/tsci-export (`tsci export <file>
-f schematic-svg|pcb-svg -o <path>`), https://docs.tscircuit.com/command-line/tsci-build
  (entrypoint discovery, `*.circuit.tsx`, exit 1 on evaluation errors). tscircuit is MIT;
  this packet only runs the installed CLI. Whether `tsci --version` prints a bare version
  is UNVERIFIED; parse leniently.
- Reference repositories in selections.md: none are relevant to PCB rendering.
