# L23 references

Sources for this packet. Treat external repositories as references, not code to copy.

## Old Loom

"3D modeling with Blender and OpenSCAD, for 3D printing" is under consideration in
[selections.md](../../selections.md). Old Loom has no 3D code: no three.js, OpenSCAD, Blender,
manifold or OCCT dependencies, no model parser or viewer. Related remains, all dropped:

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

## Upstream T3 Code

| Path                                                                                                                                                    | Why                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/server/src/assets/AssetAccess.ts:58,71-81,341`                                                                                                    | Asset token lifetime and the preview-type allowlist that rules out model files. |
| `packages/contracts/src/assets.ts:14-50`                                                                                                                | `AssetResource` kinds.                                                          |
| `apps/server/src/http.ts:196-215,230-250,371-375`                                                                                                       | File streaming in the asset route, global CORS, route registration.             |
| `apps/server/src/server.ts:411-421,527,590`                                                                                                             | Workspace layers in the runtime, CORS layer.                                    |
| `apps/server/src/workspace/WorkspaceEntries.ts:90-104`                                                                                                  | Workspace listing.                                                              |
| `packages/contracts/src/project.ts:74-84`                                                                                                               | `ProjectListEntriesInput`, result.                                              |
| `apps/server/src/auth/ServerSecretStore.ts:138-150`                                                                                                     | Signing key storage.                                                            |
| `apps/server/src/keybindings.ts:566-582`                                                                                                                | Debounced `FileSystem.watch`.                                                   |
| `apps/server/src/atomicWrite.ts:5`                                                                                                                      | Atomic writes for the sidecar.                                                  |
| `packages/client-runtime/src/state/assets.ts:57`                                                                                                        | `resolveAssetUrl`.                                                              |
| `apps/web/src/components/ChatView.tsx:600-606`                                                                                                          | Lazy-loaded panels.                                                             |
| `apps/web/src/components/desktop/SnapShotCoordinator.tsx:139-184`, `apps/web/src/lib/imageCompression.ts:450`, `apps/web/src/composerDraftStore.ts:614` | Adding a captured image to the composer.                                        |
| `apps/server/src/mcp/McpHttpServer.ts:499-577`                                                                                                          | Upstream's private image tool helper.                                           |
| `packages/shared/src/devProxy.ts:11`                                                                                                                    | `/api` proxied in dev.                                                          |

## External

- three.js (MIT) 0.186.0, `exports["./addons/*"] = "./examples/jsm/*"`; loaders
  `examples/jsm/loaders/STLLoader.js`, `3MFLoader.js` (imports `unzipSync` from its bundled
  `../libs/fflate.module.js`, parses XML with `DOMParser`, reads the model `unit`, default
  millimeter), `OBJLoader.js`, `GLTFLoader.js`; `OrbitControls`. https://github.com/mrdoob/three.js,
  https://threejs.org/docs/ (package metadata checked with `npm view three` and unpkg on
  2026-09-24).
- occt-import-js (LGPL-2.1) 0.0.23, STEP/IGES/BREP import in WebAssembly, about 11.6 MB
  unpacked: https://github.com/kovacsv/occt-import-js
- Online3DViewer (MIT) 0.18.0, a complete viewer that bundles occt-import-js, considered and not
  used: https://github.com/kovacsv/Online3DViewer
- OpenSCAD (GPL-2.0-or-later): https://openscad.org, snapshots at
  https://files.openscad.org/snapshots/, command line reference
  https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment,
  Customizer syntax https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Customizer, Manifold
  backend flag in `src/openscad.cc` (https://github.com/openscad/openscad/blob/master/src/openscad.cc),
  summary statistics in `src/RenderStatistic.cc`. Not installed on Kyle's Mac on 2026-09-24
  (`which openscad` empty, no OpenSCAD app in `/Applications`); flags to be rechecked against the
  installed snapshot.
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
