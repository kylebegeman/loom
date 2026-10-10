# L48 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling and its tests passing. Steps 1
to 6 are server and contracts and can be finished and tested before any UI exists; agents can
use assemblies after step 6.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, MODEL-3D-FOLLOW-UPS.md and this
folder. Get Kyle's answers to PRODUCT.md "Decisions needed from Kyle". Check which related
packets have landed:

- `apps/server/src/fork/model-preview-3d/check/` exists with `workerHost.ts`, `grid.ts` and the
  readers: L46 landed. If not, do L46's IMPLEMENTATION.md steps 2, 3, 4 and 6 (mesh core,
  readers, grid, worker and its seam) first, exactly as written there, in their own commits with
  L46's commit scope, with the worker entry handling only L48's request kinds. The shared jobs,
  one-permit slot and cancellation map that L46 creates in `printChecker.ts` then live in
  `assembly.ts` until L46 moves them to a module both use.
- `"conflict"` in `ModelPreviewError.reason`: L51 landed; reuse it.
- `packages/contracts/src/fork/model-beds.ts` exists: L32 landed; the Fit tab shows bed fit with
  `fitOnBed`. If not, the Fit tab shows the overall size only.
- `apps/web/src/fork/model-preview-3d/units.ts` exists: L40 landed; format lengths with
  `formatLength`. Otherwise keep one local `formatMm` call site to swap later.
- `activeCamera()` exists in `createViewer.ts`: L31 landed; `objectAt` uses it.

Test data: build meshes in code (cubes, a box with a lid, a plate inside a box). One tiny GLB
fixture from L46 covers the glTF path. Real enclosure checks use a PCB reference exported in a
dev worktree. No seeded database is needed.

## Steps

1. **Contracts.** Create `packages/contracts/src/fork/model-assembly.ts` (TECHNICAL.md,
   "Contracts"), including `validateAssembly` and the pure helpers, and export it from
   `index.ts`. In `model-preview-3d.ts` add the three method names and RPCs, `AssemblyEntry` and
   `assemblies` on `listModels` with its decoding default, and `conflict` (and `unavailable` if
   L46 has not landed). In `model-editor.ts` add the three actions, `explode` and the
   `assembly` state. Add the permission rows and `"model-assemblies"` to `features.ts`. Add
   stub service methods that fail with `command-failed` so the RPC group compiles.
2. **Read and write.** `assembly.ts` with `assembly` and `updateAssembly`, and `assemblyOps.ts`
   with `applyOperations` for every operation except `align` (which fails "Not available yet"
   until step 4). Per-path write semaphore, `expectedRevision`, atomic temp-file rename, stable
   formatting. Spread `makeAssemblies` into the service. Wire the three handlers in `rpc.ts`.
3. **Listing.** `listModels` returns `assemblies` and merges `.loom/pcb-references/*.glb`.
4. **Bounds.** Extend L46's `protocol.ts` and worker entry with `{ kind: "bounds" }`; add
   `boundsOf` with its LRU in `assembly.ts`, including the SCAD path with `asmCheckVariant` and
   `protectStem`; implement `align` with `alignPosition`.
5. **Fit check.** `check/interfere.ts` and `check/distance.ts`, then `{ kind: "assembly" }` in
   the worker, then `checkAssembly` in `assembly.ts` with the key, LRU, shared jobs, permit and
   L46's cancellation map. Confirm `cancelPrintCheck` cancels an assembly check.
6. **Agent tools.** The two MCP tools with the agent gate. Add a bench script beside L46's
   (`check/bench.ts`, run with `node`) that builds two 1,500,000 triangle meshes in code and
   times the cases in TECHNICAL.md "Performance"; put the measured numbers in the PR body.
7. **Client runtime.** The three commands in `packages/client-runtime/src/fork/
model-preview-3d.ts`.
8. **Viewer pieces.** `viewer/assembly.ts` with `createAssemblyScene` and `explodeOffset`;
   `refreshModel` and `objectAt` on `createViewer.ts`; the `source` prop on `ViewerCanvas.tsx`
   with `ModelFile` passing `{ kind: "file", url, format }`, so single models behave exactly as
   before.
9. **Inspector kinds.** Change `ModelInspector.tsx` from the `scad` flag to `kinds` and update
   every caller. No assembly UI yet; behaviour unchanged. Own commit.
10. **Open an assembly.** `useAssembly.ts`: read, per-part loading queue with the display
    budget, per-part and assembly watches, diffing, `update` with conflict handling. In
    `ModelFile`, the kind routing, `source: { kind: "object" }`, the composite
    `geometryRevision`, and the parameter actions' message. A Parts tab listing parts with
    state, eye, swatch, isolate and selection (row and viewport click through `objectAt` and
    `partAt`), with the empty, error and over-budget states from PRODUCT.md.
11. **Placement.** Position and rotation fields on `scrub.ts` steps, quarter turns, "Drop to
    bed", "Align to part...", per-part SCAD parameters through `Parameters.tsx`, "Add part",
    "Rename", "Open part", "Remove from assembly", and one "Undo" in the toast.
12. **Explode.** Slider in the Parts tab and `E` in the key handler and `HELP`; markup and fit
    pins hidden while exploded; Measure and Annotate disabled with the tip; editor actions
    `explode`, `isolate`, `select-part` and `state.assembly` in every result; Escape order.
13. **Fit tab.** `AssemblyFitSection.tsx`: size and bed fit, clearance rows, "Check fit" with
    request ids and "Cancel", results with stale marking, `setPins` (generalizing L46's
    `setFindings` in `viewer/printCheck.ts`, with its caller mapped), framing on click, badge
    on the Fit tab when a fresh report has intersections or tight clearances.
14. **Picker and palette.** "Assemblies" filter and "New assembly" in `ModelPicker.tsx`, shown
    when the server lists `model-assemblies`; assembly paths in `commandPalette/registry.ts`.
15. **Docs.** In `docs/fork/user/model-preview-3d.md`, add an "Assemblies" section after
    "Explore and review a design" (`:76`): what an assembly file is, how to create one and add a
    board from the PCB view, placing parts, the exploded view and `E`, the fit check, and that
    agents can build and check assemblies. Update this packet's Status and the index row in the
    packets README.

Commit messages: `feat(fork-model-assemblies): ...`, for example
`feat(fork-model-assemblies): check how parts fit together`. Step 9 is
`refactor(fork-model-assemblies): inspector tabs by model kind`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A case SCAD, a lid STL and a board GLB from `loom_pcb_export_reference` open together from one
  `.loom-assembly.json`; each part sits at the position and rotation in the file, in
  millimetres, with the board at its real size.
- Editing the lid STL reloads only the lid (the network panel shows one download); changing the
  case's `wall` parameter in the Parts tab re-renders only the case and does not change the case
  file's own last-used parameters.
- Typing a position, a quarter turn, "Drop to bed" and "Align to part" ("on top of" with a 0.5 mm
  offset) produce the expected numbers in the file, and the file diff is limited to the changed
  part's lines.
- `E` toggles the exploded view; the file does not change; markup hides while exploded.
- A lid placed 0.2 mm into the case rim reports "Intersects" with a pin on the rim; resting
  exactly on it reports "Touching"; a board 0.25 mm from a wall with a 0.3 mm requirement reports
  "0.25 mm, needs 0.3 mm" with both closest points pinned; a board inside a closed box with no
  contact reports "Inside".
- An agent builds the same assembly with `loom_model_preview_3d_assembly_update`, checks it with
  `loom_model_preview_3d_assembly_check`, and captures it exploded through the editor tool; with
  "Let agents render models and propose variants" off, both tools refuse.
- Two clients editing the same assembly: the second save shows the conflict message and nothing
  is lost.
- Single models open, reload and capture exactly as before.
