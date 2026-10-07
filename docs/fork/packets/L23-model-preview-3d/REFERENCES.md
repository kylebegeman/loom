# L23 references

Sources for this packet. Treat external repositories as references, not code to copy.

## Old Loom

"3D modeling with Blender and OpenSCAD, for 3D printing": 3D preview (L23), split out in
[selections.md](../../selections.md) (Outcomes); printing and slicing remain with the Fabrication app. L23 now includes the selected parameter/editing workspace. Old
Loom has no 3D code: no three.js, OpenSCAD, Blender, manifold or OCCT dependencies, no model
parser or viewer. Related remains, all dropped:

| File                                                                                                                                                                                                                                                                                              | Note                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [packages/contracts/src/printing.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/printing.ts) (386)                                                                                                                                                                   | Printer fleet domain model; a design note for the Fabrication app, not for this panel. |
| [apps/server/src/printing/Layers/PrintScheduler.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/printing/Layers/PrintScheduler.ts) (713)                                                                                                                                     | Every printer action went to a manual adapter that always "accepted".                  |
| [apps/web/src/components/studio/StudioPrintingSurface.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/studio/StudioPrintingSurface.tsx) (289)                                                                                                                       | Enqueue form taking a raw artifact id.                                                 |
| [docs/archive/2026-07-pre-v1/lumen-cockpit-implementation/roadmap/phases/61-3d-printing-studio-and-printer-fleet-ops.md](https://github.com/bagelvault/loom/blob/a79ec506/docs/archive/2026-07-pre-v1/lumen-cockpit-implementation/roadmap/phases/61-3d-printing-studio-and-printer-fleet-ops.md) | The never-started plan (STL/3MF/OBJ/STEP/SCAD library, slicer sidecars).               |

## Kyle's Fabrication packet

`~/Developer/docs/apps/fabrication/` (README, SPEC, ARCHITECTURE, MCP, REFERENCES, ROADMAP,
QUESTIONS, SAFETY; status "Not started"). Optional for this panel, never required:

- ARCHITECTURE.md, "Loom preview contract": `GET /api/previews?path=&params=`, `POST
/api/previews` for remote projects, `GET /files/<sha256>`, `GET /events?topic=preview:<hash>`,
  `/embed/model/<ref>`; "The panel renders the GLB with three.js on demand, with no idle
  animation loop". This packet only links to the app in v1.
- REFERENCES.md facts reused here (verified there on 2026-09-24): OpenSCAD releases and
  snapshots, Manifold backend flags and defaults, export formats and `binstl`, 3MF color options,
  `-D` / `-p` / `-P` parameters and the customizer JSON format, PNG rendering flags, summary JSON
  fields, `-d` dependency files, exit code caveat, headless PNG notes; three.js 0.186.0 loaders;
  Blender MCP servers and the broken Codex entry.

## Current integration references

Checked against the implementation based on Loom `841d91c11d`; source paths are authoritative
rather than the original packet's v0.0.42 line numbers.

- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts` and
  `apps/server/src/checkpointing/Utils.ts`: thread/workspace resolution.
- `apps/server/src/workspace/WorkspaceEntries.ts`: file discovery.
- `apps/server/src/assets/AssetAccess.ts`: the upstream allowlist that model files do not widen.
- `apps/server/src/auth/ServerSecretStore.ts`: the signed-route key.
- `apps/server/src/atomicWrite.ts`: preserving sidecar contents through atomic writes.
- `apps/server/src/mcp/McpHttpServer.ts` and `apps/server/src/fork/ForkRuntime.ts`: shared toolkit
  registration and retained service context.
- `packages/shared/src/devProxy.ts`: same-origin development HTTP transport.
- `apps/web/src/composerDraftStore.ts`, `apps/web/src/lib/imageCompression.ts` and
  `apps/web/src/components/desktop/SnapShotCoordinator.tsx`: composer capture persistence.
- `docs/fork/packets/EXTENSION-POINTS.md`: registries and marked upstream integration points.

## External

- three.js (MIT) 0.186.0, `exports["./addons/*"] = "./examples/jsm/*"`; loaders
  `examples/jsm/loaders/STLLoader.js`, `3MFLoader.js` (imports `unzipSync` from its bundled
  `../libs/fflate.module.js`, parses XML with `DOMParser`, reads the model `unit`, default
  millimeter but does not apply scaling; Loom normalizes model coordinates and transforms to mm), `OBJLoader.js`, `GLTFLoader.js`; `OrbitControls`. https://github.com/mrdoob/three.js,
  https://threejs.org/docs/ (package metadata checked with `npm view three` and unpkg on
  2026-09-24).
- occt-import-js (LGPL-2.1) 0.0.23, STEP/IGES/BREP import in WebAssembly, about 11.6 MB
  unpacked, declined by Kyle (STEP stays with the Fabrication app):
  https://github.com/kovacsv/occt-import-js
- Online3DViewer (MIT) 0.18.0, a complete viewer that bundles occt-import-js, considered and not
  used: https://github.com/kovacsv/Online3DViewer
- OpenSCAD (GPL-2.0-or-later): https://openscad.org, snapshots at
  https://files.openscad.org/snapshots/, command line reference
  https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment,
  Customizer syntax https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Customizer, Manifold
  backend flag in `src/openscad.cc` (https://github.com/openscad/openscad/blob/master/src/openscad.cc),
  summary statistics in `src/RenderStatistic.cc`. Not installed on Kyle's Mac on 2026-09-24
  (`which openscad` empty, no OpenSCAD app in `/Applications`). Verification used the official
  temporary snapshot recorded below, rather than a permanent application installation.
- manifold (Apache-2.0), the geometry kernel behind OpenSCAD's Manifold backend:
  https://github.com/elalish/manifold
- Blender MCP servers:
  - ahujasid/mcp-for-blender (MIT; renamed from blender-mcp; `uvx blender-mcp` still works;
    add-on socket on localhost:9876; `DISABLE_TELEMETRY=true` turns off its telemetry):
    https://github.com/ahujasid/mcp-for-blender
  - Blender Lab MCP server (official; add-on GPL-3.0-or-later; Blender 5.1+; v1.0.3 on
    2026-09-11): https://projects.blender.org/lab/blender_mcp, docs
    https://www.blender.org/lab/mcp-server/
  - Kyle's Codex entry: `~/.codex/config.toml` lines 104-113 (`[mcp_servers.blender]`, command
    `/Users/kyle/.local/bin/blender-mcp`, env host 127.0.0.1, port 9876, telemetry off, approval
    required for `execute_blender_code`). The command path is missing on 2026-09-24.
    `uv`/`uvx` are at `/opt/homebrew/bin`; Blender at `/opt/homebrew/bin/blender`
    and `/Applications/Blender.app`.

## Printer build volumes (build plate presets)

Checked on 2026-09-24.

- Bambu Lab H2C: 330 x 320 x 325 mm total for both nozzles; left nozzle 325 x 320 x 320 mm;
  both nozzles 300 x 320 x 325 mm. Kyle's source https://bambulab.com/en/h2c/specs (the page
  refused automated fetches with HTTP 403); the same figures appear in Bambu Lab's H2C
  announcement, https://blog.bambulab.com/bambu-lab-h2c-where-multi-material-vortek-system-meets-engineering-precision/
  (seen in search results, not opened).
- Bambu Lab H2D: 350 x 320 x 325 mm total for both nozzles; one nozzle 325 x 320 x 325 mm;
  both nozzles 300 x 320 x 325 mm. https://bambulab.com/en/h2d/tech-specs returned HTTP 403 to
  automated fetches, so these figures are confirmed only by third-party pages, for example
  https://3dprintingindustry.com/news/bambu-labs-new-h2d-3d-printer-technical-specifications-and-pricing-237763/.
  Unverified against bambulab.com; recheck in a browser.
- Anycubic Kobra S1: 250 x 250 x 250 mm,
  https://store.anycubic.com/products/kobra-s1-ace-2-pro-combo-3d-printer (fetched).

## Implementation verification, 2026-10-07

Installed `three` and `@types/three` 0.186.0 were inspected directly. `ThreeMFLoader`
records model units without scaling geometry; the viewer normalizes vertices, translations
and beam radii to mm before parsing the archive. glTF is converted from metres/Y-up to mm/Z-up.

With Kyle's authorization, the official macOS universal snapshot
[2026.10.05](https://files.openscad.org/snapshots/OpenSCAD-2026.10.05.dmg) was downloaded
and run from a temporary directory, without installing into `/Applications`.
`--version`, `--help` and `--help-export` confirm Manifold, summary JSON, binary STL,
colored 3MF and OBJ import. Real CLI/service tests rendered STL, colored 3MF and PNGs,
checked parameter sets, overrides, cache reuse, parser errors and signed HTTP bytes.
The shared MCP handler rendered SCAD, STL, OBJ and 3MF with valid PNG dimensions and
geometry summaries. Imported meshes can omit `simple`; manifold then remains unknown.

This build imports inch-unit 3MF as raw coordinates. The agent-tool wrapper reads the
archive's model unit and scales imported coordinates to mm; an authored inch cube is
25.4 mm in both the client and the real CLI tool tests. Capability detection uses help
output rather than snapshot dates.
