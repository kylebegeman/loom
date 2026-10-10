# L46 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. The geometry core (steps 2 to 5) is pure and testable before any wiring exists; build and test it first.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, MODEL-3D-FOLLOW-UPS.md and this
folder. Get Kyle's answers to PRODUCT.md "Decisions needed from Kyle". Check which related
packets have landed:

- `packages/contracts/src/fork/model-beds.ts` exists: L32, L33 or L34 landed; use `activeBed`
  and `fitOnBed`. If not, do L32's step 1 to 3 bed move and fit helper first, exactly as
  `docs/fork/packets/L32-model-bed-fit/IMPLEMENTATION.md` writes them, in their own commits.
- `overhangAngleDegrees` exists in `ModelPreviewSettings`: L36 landed; reuse it and its settings
  row.
- `orientation` exists in `ModelWorkspace`: L35 landed; read it.
- `makePrinterLibrary` exists in `ModelPreviewService.ts`: L51 landed; take the nozzle from it.

Test meshes: write small fixtures in code (cube, two cubes, a cube with a hole, a thin plate)
rather than committing binaries, except one tiny binary STL, one ASCII STL, one 3MF with a
component and `p:path`, and one GLB, each under 20 KB, in
`apps/server/src/fork/model-preview-3d/__fixtures__/check/`. No seeded database is needed.

## Steps

1. **Contracts.** Create `packages/contracts/src/fork/model-print-check.ts` (TECHNICAL.md,
   "Contracts") and export it from `index.ts`. In `model-preview-3d.ts` add the two method names,
   the two RPCs, the `unavailable` reason and the three settings fields with decoding defaults,
   plus their values in `DEFAULT_MODEL_PREVIEW_SETTINGS`. Add `findings` to `ModelEditorAction`.
   Add the two scope rows in `clientRpcPermissions.ts` and `rpcAuthorization.ts`. Add the two
   service methods and RPC handlers returning `unavailable` until step 7, so the server compiles
   and the exhaustive scope maps are satisfied. Add the contracts test.
2. **Mesh core.** `check/mesh.ts` (soup, weld, rotate, normals, areas) and `check/topology.ts`
   (edge table, edge classes, shells, volumes). Tests with in-code cubes.
3. **Readers.** `check/readStl.ts`, `check/readObj.ts`, `check/read3mf.ts`,
   `check/readGltf.ts`, each `(files, limits) => TriangleSoup` or a typed failure. Tests against
   the fixtures and in-code byte arrays, including the frame of glTF (a unit triangle at
   `y = 1 m` lands at `z = 1000 mm`).
4. **Grid and rays.** `check/grid.ts`. Tests: a ray through a cube hits the far face at the
   right distance from every axis; a triangle spanning many cells is tested once (mailbox); the
   retry doubles the cell size when references overflow (use a tiny cap in the test).
5. **Checks.** `check/printChecks.ts` with `runPrintChecks(mesh, params, seed, budget)` and
   `check/report.ts` with `finalizeReport`. Tests per check (TESTING.md). Run the timing
   script from step 9 locally on a large mesh before moving on, to catch an accidental
   quadratic step early.
6. **Worker.** `check/protocol.ts`, `check/model-check-worker.ts` and `check/workerHost.ts`
   (TECHNICAL.md, "Worker"). Add the pack entry seam in `apps/server/vite.config.ts` with its
   marker, the FORK.md paragraph and the `docs/fork/seams.tsv` row in the same commit. Add the
   import rule test. Build once with `vp run --filter t3 build` and confirm
   `apps/server/dist/fork/model-preview-3d/check/model-check-worker.mjs` exists and contains no
   `import` other than `node:worker_threads`; if tsdown names it differently, fix the constant in
   `workerHost.ts`. Do not commit `dist/`.
7. **Service.** `check/printChecker.ts` with `makePrintChecker(deps)`: reading (mesh files,
   3MF parts through `yauzl`, glTF buffers, SCAD through `renderScad` with
   `variantId: "loom-print-check"` and `protectStem`), orientation, nozzle, key, LRU, shared jobs,
   slot, bed fit, cancellation map. Create it in `make` in `ModelPreviewService.ts` and spread its
   two methods into the service object (near `getSettings`, `:971-982`). Wire `rpc.ts`. Service
   tests with the existing fake runner for SCAD and real fixtures for meshes.
8. **Agent tool.** Add `loom_model_preview_3d_check` to `ModelPreview3dToolkit` and its handler in
   `modelPreview3dHandlers` (`mcp.ts:230+`), gated on `agentToolEnabled`. Extend `mcp.test.ts`.
9. **Timing script.** Add `apps/server/src/fork/model-preview-3d/check/bench.ts`, a script (not
   a test) that builds a subdivided sphere and a grid of thin plates at 100k, 1M and 3M triangles
   and prints stage timings from the worker's `stages` field. Run it with
   `node apps/server/src/fork/model-preview-3d/check/bench.ts` and replace the estimate table in
   this packet's TECHNICAL.md with the measured numbers and the machine.
10. **Runtime and hook.** Add `checkPrint` and `cancelPrintCheck` to
    `packages/client-runtime/src/fork/model-preview-3d.ts`. Add `usePrintCheck.ts` with a pure
    `printCheckRequestKey(...)` and `isReportStale(...)` that the test covers.
11. **Part and Markup.** `PrintCheckSection.tsx` in `PartSection`; the watertight fact reads the
    report; the "Print check" group in `MarkupSection.tsx`. Check light and dark themes and the
    narrow inspector sheet.
12. **Viewer.** `viewer/printCheck.ts`, `setFindings` and `frame` on `createViewer.ts`, the one
    line at the end of `drawOverlay`, pin styles in `workspace.module.css`. `ViewerCanvas.tsx`
    passes `findings`, `selectedFindingId` and a `frameRequest` through like `measurements`.
13. **Panel.** In `ModelPanel.tsx`: the hook (active while `inspectorTab === "part"`), the
    `findings` display flag, the "Print check pins" menu item in `DisplayTools`, the editor
    `display` field, the Part badge and the Escape branch.
14. **Settings.** Three rows in `SettingsSection.tsx` and their ranges in `validateSettings`.
    Skip the overhang row if L36's already exists.
15. **Docs.** In `docs/fork/user/model-preview-3d.md`, replace "Print-readiness analysis remains
    a separate future exploration." (`:114-115`) with a short "Print check" section: what it
    checks, where the settings are, that pins frame the camera, that agents can run it, and that
    the single-file executable does not include it. Update this packet's Status and the index row
    in the packets README.

Commit messages: `feat(fork-model-print-check): check a part for printing before slicing`, with
the seam commit (step 6) as `feat(fork-model-print-check): bundle the print check worker`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Opening Part on an STL, OBJ, 3MF, GLB, glTF or SCAD part shows a verdict and eight rows within
  a second for a 100,000 triangle part; the same request from an agent returns the identical
  report (`cached: true` the second time).
- A 10 mm cube is "Ready to print". A cube with one deleted face reports open edges at the hole.
  A 0.3 mm fin fails "Thinner than the 0.4 mm nozzle" with a pin on the fin. A T shape with a
  bar overhang reports one overhang region under the bar. A ball hanging under a bridge reports
  an island at its bottom. A 60 mm pin on a 5 mm base warns "Tall and narrow". A part 360 mm
  wide fails bed fit on the H2D.
- Clicking a finding frames it; pins hide and show from the display menu and Markup; captures
  include them when shown.
- Editing the file reruns the check after the reload; the old report is marked stale while it
  runs; "Cancel" stops it, and the worker exits (no lingering thread in a heap snapshot or
  `process.getActiveResourcesInfo()`).
- A 4,000,000 triangle STL fails with the cap message; a Draco GLB fails with the viewer's
  message; STEP and the single-file build show their messages.
- With L35, laying the part on a face changes the first-layer and overhang results and the pins
  stay on the part. Without L35 nothing references orientation at runtime.
- `loom_model_preview_3d_check` is refused when agent tools are off.
- The check never blocks the server: other RPCs answer normally during a 3,000,000 triangle
  check.
