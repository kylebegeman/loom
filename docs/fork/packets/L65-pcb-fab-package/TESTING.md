# L65 testing

Focused tests, no repo-wide checks, no sleeps.

Local verification covers deterministic ZIP round trips, output conversion and checklists, package reuse including rotations, forced rebuilds, deletion, corrupt manifest recovery, interruption and failure cleanup, concurrent source changes, tscircuit staging, signed ZIP HTTP, MCP and guarded permissions. Scoped strict lint and contracts, client-runtime, server and web typechecks are used. The real-tool harness now exercises both package paths but was not run because CAD tools and fixtures are absent. Real-client, remote and fab-uploader checks remain pending. Preview uses the documented board-plot fallback; no worker or renderer dependency was added.

## Automated tests

| File                                                                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/pcb-fab.test.ts` (new or update)         | `PcbFabPackageInput` decodes `{ threadId, designId }` to generic, assembly on, no force. A manifest without `fabId` decodes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/server/src/fork/pcb-preview/zipWriter.test.ts` (new)            | Round trip through `openZipArchive`: names, bytes, CRCs. Stores incompressible data, deflates text. Refuses `../x`, `/x`, 1,001 entries, over 128 MiB. Same inputs give identical bytes.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/server/src/fork/pcb-preview/fabOutputs.test.ts` (new)           | LCSC field detection order and case. `parseRotationsCsv` with comments, a bad regex and a bad number. `footprintParts` sides, DNP and exclude flags, properties. BOM grouping and natural sort. `jlcpcbBom` header and quoting of commas and quotes. `parseKicadPositions` header. `jlcpcbCpl`: field offset beats a table rule, table rule by regex, normalising 350 + 30 to 20, bottom layer name, four decimals. `inspectGerbers`: copper count from X2, profile detection, plated and non-plated Excellon. `evaluateChecklist`: each row of the table in TECHNICAL.md, and the verdict rules. Circuit JSON BOM and positions from the sample. |
| `apps/server/src/fork/pcb-preview/fabPackage.test.ts` (new)           | `packageFolderName` with a revision, without one, sanitising. Argument builders for KiCad 9 and 10 (`--check-zones` only on 10; `--units mm`; `--string-delimiter`; empty `--ref-range-delimiter`; bottom drawing mirrored; inner copper layers ordered).                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (update) | As IMPLEMENTATION.md step 6. Also: `fabPackages` ignores `.pending-*` and other designs; `fabPackageZip` refuses `../x`; the source hash is unchanged after a package is written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/server/src/fork/pcb-preview/http.test.ts` (update)              | Signed `package.zip` returns `application/zip`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (update)               | The three tools pass the caller's thread; the package tool omits `zip`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/server/src/fork/pcb-preview/realTools.test.ts` (update, opt-in) | As IMPLEMENTATION.md step 10.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/src/fork/pcb-preview/fabPackage.logic.test.ts` (new)        | `checklistTone`, `groupOutputs`, `isPackageStale`, `checklistText`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Permission maps are covered by the existing `commandPermissions.test.ts` loop. The worker is
covered by the manual preview check; no component markup tests.

## Commands

```sh
vp test run packages/contracts/src/fork/pcb-fab.test.ts \
  apps/server/src/fork/pcb-preview/zipWriter.test.ts \
  apps/server/src/fork/pcb-preview/fabOutputs.test.ts \
  apps/server/src/fork/pcb-preview/fabPackage.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/http.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts \
  apps/web/src/fork/pcb-preview/fabPackage.logic.test.ts
LOOM_TEST_PCB_FIXTURES=1 vp test run apps/server/src/fork/pcb-preview/realTools.test.ts
vp lint packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/server/src/fork/pcb-preview apps/web/src/fork/pcb-preview
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

If `pcb-stackup` is added, also `vp run --filter @t3tools/web build` once to prove the worker
bundles. The opt-in real-tool run needs KiCad (and tscircuit for its case); skip and say so
when absent.

## Manual checks for Kyle

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, KiCad 9 or 10 installed:

1. Open a finished 2-layer KiCad board. **…** > "Create fab package…", JLCPCB, assembly on,
   Create. The Fabrication tab shows the checklist and outputs.
2. Download the zip and drop it into JLCPCB's online Gerber viewer (no order): all layers and
   the outline appear; drill holes line up.
3. Load `jlcpcb/bom.csv` and `jlcpcb/cpl.csv` into JLCPCB's assembly step as far as the
   placement preview, without paying: columns are recognised; check a polarised part's
   rotation. Add a `JLCPCB Rotation Offset` field to a wrong part in KiCad, package again,
   and confirm it moved.
4. "Preview outputs": top, bottom and single layers match the design; "Back to design" and
   Escape return.
5. Introduce a DRC error, package again: "Not ready", DRC item fails, the Checks tab shows the
   same DRC result. A new folder with `-2` appears; the first one is intact.
6. Package again without changes: the same package is returned.
7. "Show in folder" on desktop opens the folder; from a remote browser over Tailscale only
   Download is offered and works.
8. Delete a package: it disappears from the list and from disk.
9. With L64: choose OSH Park 2-layer on a 4-layer board; the fab check item fails.
10. Cancel during a run: nothing is left in `fab/`.
11. Ask an agent to "make a JLCPCB package and tell me what needs checking".
12. A tscircuit board (trusted): a package is made from `tsci export`; DRC and ERC are marked
    skipped.

Upstream server: no PCB panel. Mobile: no PCB panel.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect no conflicts (see the
lockfile note there if the dependency was added). After merge to `main`, Kyle runs
`scripts/fork/loom.sh integrate nightly --dry-run`.
