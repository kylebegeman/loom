# L65 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, PCB-FOLLOW-UPS.md, this folder and
L57's TECHNICAL.md "Signed file route". Kyle must have answered PRODUCT.md "Decisions needed".
If the renderer is not approved, skip the worker in step 9 and build only the fallback. Start
from `main`. Check what has landed: `pcb-fab.ts` (L64), `SIGNED_FILE_TYPES` in `cache.ts` (L57)
and `boardStats.ts` (L55). Commits use `feat(fork-pcb-fab-package): ...`.

## Steps

1. **Contracts.** Add the package schemas to `packages/contracts/src/fork/pcb-fab.ts` (create it
   and its index export if L64 has not landed). Add the four methods to `pcb-preview.ts` and the
   scopes to both permission maps. Add stub handlers in `rpc.ts` that fail with
   `unsupported-view` so the server compiles. Contracts test for decoding defaults.
2. **Signed files and source scan.** If L57 has not landed, do L57 IMPLEMENTATION.md steps 2 and
   3 (table, `signCacheFile`, `http.ts`, `fab` exclusion) with `board.glb` and `package.zip`.
   Otherwise add the `package.zip` row. Extend `http.test.ts`.
3. **Zip writer.** Create `zipWriter.ts` and `zipWriter.test.ts`: round trip through
   `openZipArchive`, stored and deflated entries, UTF-8 names, refused names, limits,
   deterministic output.
4. **Pure output helpers.** Export `property` from `semantics.ts`. Create `fabOutputs.ts` with
   `LCSC_FIELDS`, `ROTATION_FIELDS`, `parseRotationsCsv`, `footprintParts`, `bomFromFootprints`,
   `bomFromCircuitJson`, `parseKicadPositions`, `positionsFromCircuitJson`, `jlcpcbBom`,
   `jlcpcbCpl`, `inspectGerbers`, `evaluateChecklist` and `checklistMarkdown`. Add
   `fixtures/fab-package/` (a small KiCad board with a back-side part, an LCSC field on some
   parts and a rotation field on one; KiCad-shaped positions and BOM CSVs; two X2 Gerbers and two
   Excellon headers; a Circuit JSON sample) and `fabOutputs.test.ts`.
5. **Package runner.** Create `fabPackage.ts` with `packageFolderName`, the step argument
   builders (`gerberArgs`, `drillArgs`, `positionArgs`, `bomArgs`, `assemblyArgs`, each taking
   the KiCad major version), and `runFabPackage(deps, input)` following TECHNICAL.md. Add
   `fabPackages`, `fabPackageZip` and `deleteFabPackage` beside it. Wire the four methods into
   the service interface, implementation and `PcbPreviewService.of`, and replace the stubs.
6. **Service tests.** In `PcbPreviewService.test.ts`, with a fake `run` that writes small
   fixture outputs for each command: folder naming and suffixes; reuse of an identical package;
   `force`; pending folder removed after a failing step and after interruption; no files left
   outside `fab/`; checklist and verdict for clean, DRC errors and missing outline; JLCPCB files;
   tscircuit path with a fixture zip; delete refuses a folder without a manifest.
7. **MCP.** Add the three tools and `mcp.test.ts` cases.
8. **Client runtime and tab.** Add atoms and commands. Create `fabPackage.logic.ts` with tests,
   `FabricationTab.tsx`, the `INSPECTOR_TABS` entry, the menu item and the download and reveal
   actions.
9. **Preview.** If approved, add `pcb-stackup@4.2.8` to `apps/web/package.json` with `vp i`.
   Spike first: a `gerberPreview.worker.ts` that imports it must build with `vp run --filter
@t3tools/web build` without Node built-in errors. If it needs Node polyfills, stop and ask
   Kyle (the `@sctg/pcb-stackup` fork uses `readable-stream` 4, which ships browser builds).
   Then `GerberPreview.tsx`, the Outputs mode in `PcbPreviewPanel.tsx`, and the fallback through
   `render` with `layerNames`.
10. **Real-tool test.** Extend `realTools.test.ts` (opt-in) to package a fixture board on the
    installed KiCad and pin: the Gerber file names and X2 functions, the drill file names, the
    positions CSV header and whether `--side both` writes one file, the BOM quoting. Fix the
    helpers if the real output differs.
11. **Docs.** In `docs/user/`, in the PCB preview section, a "Fabrication packages" paragraph:
    how to create one, where it goes, the gitignore line, that Loom never uploads, and how to
    correct JLCPCB rotations. Nothing in `docs/internals/`.

## Done when

- A KiCad 2-layer board produces a package whose zip JLCPCB's online viewer accepts (manual
  check), with separate PTH and NPTH drill files and every expected layer.
- The JLCPCB BOM and CPL load in JLCPCB's assembly step with columns recognised (manual check).
- A board with DRC errors is "Not ready"; a clean one is "Ready" with the manual items listed.
- The preview shows the packaged Gerbers (or the labelled fallback), and "Back to design"
  returns.
- Packages list, download, reveal and delete work from web and desktop, local and remote.
- Agents create a package and read its checklist through MCP and `t3 pcb`.
- The user's design files are unchanged and its source hash does not change after packaging.
- Focused tests, lint and typechecks in TESTING.md pass; the merge check is clean.
