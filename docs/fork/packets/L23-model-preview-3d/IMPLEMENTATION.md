# L23 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder. Work in a worktree.
- `three` and `@types/three` are approved (PRODUCT.md, Decisions). No other dependency is
  added; STEP is out of scope (no `occt-import-js`).
- Recheck OpenSCAD availability on the environment host; the 2026-09-24 note that it was
  absent is historical. Verify an available build with `--version`, `--help` and, when
  supported, `--help-export`. Record the tested version and relevant capabilities in
  REFERENCES.md. Use actual capability evidence, not a guessed snapshot date. If a tool
  installation is needed, prepare the exact setup step and follow current session
  authorization. A missing-tool screen or fake spawner test does not complete OpenSCAD
  verification.
- Fixtures: a tiny binary STL (a cube, 12 triangles), a 3MF produced by any slicer or exporter,
  an OBJ cube, a glTF with an external `.bin`, several `.scad` files covering customizer syntax,
  a sample summary JSON (hand-written from OpenSCAD's `RenderStatistic.cc` field names; mark it
  synthetic until a real one replaces it). Keep them under
  `apps/server/src/fork/model-preview-3d/__fixtures__/` and
  `apps/web/src/fork/model-preview-3d/__fixtures__/`, all a few KB.

## Phase 0: extension points

Recheck `ext-core`, `ext-panels`, `ext-settings`, `ext-palette`, `ext-web-root`,
`ext-keybindings` and `ext-mcp`. At the 2026-09-27 review, only settings and MCP are missing.
Reuse the existing implementations. Create the missing extension points for this feature,
using current source and the documented registration shapes; do not add unrelated future
extension work. Keep commit boundaries as documented when commits are authorized.

## Phase 1: server core

1. Contracts `packages/contracts/src/fork/model-preview-3d.ts` (including `BuildPlatePresetId`,
   `BUILD_PLATE_PRESETS` and `BuildPlateSetting`, default preset `bambu-h2d`); registration;
   keybinding commands.
2. Pure modules with tests:
   - `signedFiles.ts`: `mintToken({ root, base, exp, large }, key)`, `verifyToken(token, key,
now)`, `resolveTokenPath(claims, requestPath)` (containment after normalization; `..`
     refused).
   - `customizer.ts`: `parseCustomizer(source)` and `validateLiteral(kind, literal)`.
   - `openscad.ts`: `parseVersion`, `capabilities(version)`, `renderArgs(...)`,
     `pngArgs(view, ...)`, `parseLog(stderr)`, `parseSummary(json)`.
   - `renderCache.ts`: `cacheKey(...)`, `pruneList(entries, limits)`.
3. `migrations.ts`, `store.ts` (params, settings) with `SqlitePersistenceMemory` tests.
4. `ModelPreviewService.ts`: `status` (cached 60 s, "Refresh detection" clears), `listModels`,
   `fileUrl`, `watch`, `parameters`, `renderScad` (per-file interruption with a
   `SynchronizedRef<Map<path, Fiber>>`, global semaphore, cache), `saveParameterSet`, settings,
   `clearCache`, startup sweep.
5. `http.ts`: the signed route. Sketch:

   ```ts
   export const ModelPreviewHttpRoutes = HttpRouter.add(
     "GET",
     "/api/loom/model-preview-3d/f/*",
     withForkRuntime(
       Effect.gen(function* () {
         const request = yield* HttpServerRequest.HttpServerRequest;
         const service = yield* ModelPreviewService;
         const file = yield* service.resolveSignedRequest(HttpServerRequest.toURL(request));
         return yield* HttpServerResponse.file(file.path, { headers: file.headers });
       }).pipe(
         Effect.catch(() => Effect.succeed(HttpServerResponse.text("Not found", { status: 404 }))),
       ),
     ),
   );
   ```

   Every failure is a plain 404 (no detail leaks). Check `HttpServerResponse.file` and the
   router's wildcard syntax against upstream's `assetRouteLayer`
   (`apps/server/src/http.ts:371-375`) and the installed effect version.

6. Register service, route, feature slug, handlers, scopes.

## Phase 2: agent tool

7. `mcp.ts`: `loom_model_preview_3d_render` (PNG views via `openscad -o ... .png`, the mesh
   wrapper for STL/3MF/OBJ, summary). Register in `ForkMcpToolkitsLive`.

## Phase 3: web viewer

8. Add `three` and `@types/three` to `apps/web` (approved). Commit the dependency with only the
   intended lockfile change.
9. `apps/web/src/fork/model-preview-3d/viewer/`: `createViewer`, `loadModel`, view presets,
   capture, dispose, theme colors, grid sized from the build plate setting. No
   `requestAnimationFrame` loop; one coalesced frame per request. `buildPlate.ts`:
   `resolveBuildVolume(setting)` and `fitsBuildVolume(sizeMm, volumeMm)`, pure.
10. `ModelPanel.tsx`, picker, toolbar, parameters sheet, log, status bar (with the "Larger than
    the build volume" note), states from PRODUCT.md including the STEP pointer to the
    Fabrication app; `panel.tsx` definition (letter `O`), lazy body.
11. Capture to composer (`addImage` path from TECHNICAL.md).
12. Palette source, shortcuts component, settings section (build plate select: H2D, H2C,
    Kobra S1, Custom with three mm fields; the preset's note shown underneath; the "Let agents
    render models" switch for `agentToolEnabled`).

## Phase 4: documentation and finish

13. `docs/fork/user/model-preview-3d.md`: supported formats, how reload works, OpenSCAD
    (install a snapshot; why not 2021.01), parameters and sets, captures, the agent tool,
    Blender MCP setup guidance (TECHNICAL.md, "Blender MCP"); keep any
    historical machine-specific configuration repair in operational notes rather than user docs, the build plate presets, that STEP files belong to the Fabrication app, and
    the optional Fabrication link.
14. Packet index Status and README Status.
15. Merge check and definition of done.

## Pitfalls

- Never start a render loop (`renderer.setAnimationLoop` or a perpetual `requestAnimationFrame`);
  AGENTS.md forbids continuous repaint, and it is the main risk in a 3D panel.
- Dispose WebGL resources; browsers cap live contexts (about 16), and each open 3D tab holds one.
- `ThreeMFLoader` uses `DOMParser`, so it cannot run in a worker.
- OpenSCAD's default STL output is ASCII; always pass `--export-format binstl`.
- `-D` values are OpenSCAD expressions: strings need quotes; validate every literal.
- Relative URLs inside `.gltf` files must resolve below the token's `base`; test a glTF with
  `../` references (refused) and with a subfolder (allowed).
- A render cache hit must still re-check the dependency mtimes recorded in the previous `.deps`
  file, or edits to included files are missed.
- The `watch` subscription must stop when the tab closes; check with the panel closed that no
  `FileSystem.watch` remains (count active watchers in a test).

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- With the panel open on a `.scad` file, an agent's edit re-renders it without interaction, and
  the GPU is idle when nothing changes (Activity Monitor or the browser performance panel shows
  no frames while idle).
- A capture of four views lands in the composer as one image and is sent with the message.
- A token cannot read outside its base directory (tested) and expires.
