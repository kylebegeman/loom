# L67 implementation

Commits use `feat(fork-pcb-enclosure-fit): ...`. Each step leaves the tree compiling and its
tests passing. Phase A (steps 1 to 9) needs nothing from the other follow-ups. Phase B (steps 10
to 15) needs L48 merged. If L48 has not landed, ship phase A and keep phase B open in the
tracking issue.

## Phase A: references and the case starter

1. **Contracts.** Add `packages/contracts/src/fork/pcb-enclosure.ts` exactly as TECHNICAL.md
   shows and export it from `index.ts`. In `pcb-workspace.ts`, add `plated` and `footprint`
   (with decoding defaults) to `PcbInspection.mountingHoles` items (`:49-52`), `relativePath` to
   `PcbReferenceResult` (`:293-298`), `EnclosureStarterParamsInput`, `PcbEnclosureInput` and
   `PcbEnclosureResult`. In `pcb-preview.ts`, add the `enclosure` tag (`:15-43`) and RPC after
   `exportReference` (`:249-253`). In `clientRpcPermissions.ts`, add `[P.enclosure]` with
   `AuthOrchestrationOperateScope`. Add `"pcb-enclosure-fit"` to `features.ts`. The server
   compiles with a stub `enclosure` that fails `invalid-parameters`, "Not available yet."
2. **Plated mounting holes.** In `semantics.ts` `inspectBoard`, extend the hole filter (`:147`)
   to `thru_hole` pads in footprints matching `/MountingHole/i`, one hole per footprint (largest
   drill), and set `plated` and `footprint`. tscircuit holes (`:426-440`) set the defaults
   explicitly. Update any fixture expectation in `workbench.test.ts` that counts holes.
3. **Outline loops.** Add `apps/server/src/fork/pcb-preview/outline.ts` with `kicadOutline` and
   `circuitOutline` (TECHNICAL.md, "Outline"). If L55 already added it, reuse it and skip this
   step. Do not change `inspection.bounds`.
4. **GLB JSON.** In `glb.ts`, add `readGlbJson` and `readGlbBounds` with `nodes` and
   `materials` (or add those two fields to L55's function).
5. **Reference version 2.** Add `enclosure/reference.ts` with `referenceData(input)`: the cached
   GLB (via `asset` with `transport: "url"`, as `exportReference` does at `:2396`), the
   inspection, and the metadata object with `format`, `version: 2`, `kind`, `outline` (from
   step 3; the design's board source for KiCad, the circuit JSON for tscircuit) and hole fields.
   Change `exportReference` (`:2392-2463`) to call it and write its metadata; return
   `relativePath`. Behaviour and file names are otherwise unchanged.
6. **Features.** Add `enclosure/features.ts` with `boardFeatures` (TECHNICAL.md rules 1 to 9),
   including the version 1 fallbacks (kind from the GLB, bounds rectangle as outline).
7. **Plan and writers.** Add `enclosure/plan.ts` (`planEnclosure`), `enclosure/scad.ts`
   (`writeScad`) and `enclosure/build123d.ts` (`writeBuild123d`), all pure, plus the
   `loom-generated` hash helpers (`generatedHash`, `isUnedited`) in `scad.ts`.
8. **Service and tool.** Add `enclosure/service.ts` with `makeEnclosure(deps)` implementing
   steps 1 to 5 and 7 of "The `enclosure` method" (no assembly yet). Wire it into `make` and the
   service object beside `exportReference` (`:2575`), the RPC handler in `rpc.ts`, the
   `loom_pcb_enclosure` tool and handler in `mcp.ts`, and the client-runtime command. Skip
   `.loom-assembly.json` names in the tscircuit scan (`PcbPreviewService.ts:557-561`) now, so a
   later assembly never changes a board revision.
9. **PCB tab.** Append `"Enclosure"` in `Inspector.tsx` and add `EnclosureTab.tsx` with "Board
   reference", "Generate case" (preview-driven defaults, build123d checkbox gated on
   `model-python-cad`, overwrite confirm) and "Open in 3D" opening `case.scad`. Without
   `model-assemblies` this is the finished phase A product; show "Fit checks arrive with 3D
   assemblies."

## Phase B: assemblies and fit checks (after L48)

10. **Assembly contracts.** In `model-assembly.ts`: `AssemblyEnclosure`, the `enclosure` field,
    `ASSEMBLY_FILE_VERSION = 2`, `ASSEMBLY_CHECK_VERSION = 2`, the four operations,
    `validateAssembly` rules and `AssemblyCheckReport.enclosure`. The writer emits version 1
    when `enclosure` is null. Extend L48's assembly decode tests for both versions.
11. **Operations.** In `assemblyOps.ts`, implement `set-enclosure`, `clear-enclosure`,
    `place-board` and `swap-board`, and the `remove-part` cleanup. Add `ctx.boardFeatures` in
    `assembly.ts` (reads the GLB head and sibling JSON, cached by geometry revision). Update the
    `assembly_update` tool description.
12. **Worker.** Add `check/enclosure.ts` with `checkEnclosure(request, caseGrid, boardMatrix)`,
    `nearestHit` in `grid.ts` if missing, `AssemblyRequest.enclosure` in `protocol.ts`, and the
    call in `model-check-worker.ts` after the pair checks. Findings, `suggestedMove` and status
    as TECHNICAL.md describes.
13. **Check wiring.** In `assembly.ts` `checkAssembly`: build features, add them and the
    requirements to the key and the request, and attach `report.enclosure`.
14. **Generated assembly.** In `enclosure/service.ts`, write `<stem>.loom-assembly.json` when
    missing (TECHNICAL.md table) and report `assembly`. The tab now opens the assembly instead
    of `case.scad`.
15. **Panels.** PCB tab: "Use an existing case", "Update board", "Check fit", results and "Show
    in 3D". Model panel: `EnclosureFitSection.tsx` in L48's Fit tab with requirements, findings,
    pins, "Apply suggested move" with undo, "Check as an enclosure…" and "Stop checking as an
    enclosure".

## Docs

- `docs/fork/user/pcb-preview.md`, "Hardware and cases": a short "Check a case" paragraph:
  where the Enclosure tab is, what Generate case writes, and that heights are box heights.
- `docs/fork/user/model-preview-3d.md` (or L48's assembly section): one paragraph on enclosure
  checks in the Fit tab.
- No internal doc: the frame rule is a code comment in `features.ts`.

## Done when

- Generating a case for a real KiCad 10 board with `MountingHole_3.2mm_M3_Pad` footprints and a
  USB-C connector on an edge writes `case.scad` that renders in the model panel with four
  standoffs under the holes and a cut-out in front of the connector.
- The same for a tscircuit board with `pcb_hole`s and an outline.
- Regenerating with no change writes identical bytes; after a hand edit it asks before
  replacing; with `overwrite` it replaces.
- `build123d: true` writes `case.b3d.py` on a server with L50 and fails with the documented
  message without it.
- Phase B: the generated assembly checks as "Fits" with defaults. Raising `standoff_height` by
  5 mm in the customizer reports a lid finding; moving the board 1 mm in X reports off-centre
  holes and "Apply suggested move" restores "Fits". Thickening a wall over the connector reports
  the connector as blocked.
- An existing case STL added with "Use an existing case" checks without errors and gives a
  suggested move onto its standoffs.
- "Update board" after a design change swaps the board and keeps it on its standoffs.
- A version 1 reference (exported before this packet) still checks, with the bounds rectangle
  as the outline.
- `t3 pcb enclosure` and `t3 model assembly_check` give the same results as the panel.
- Nothing in Loom offers to order, print, slice or upload the case.
