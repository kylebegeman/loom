# L57 testing

The owned focused run passed **15 tests across four files** on 2026-10-10. Strict lint passed
for the print contracts, helper, signed HTTP route, dialog and their focused tests. The primary
agent runs the shared RPC/MCP, permission and service integration checks and scoped package
typechecks after integration. Shared transport validation also passed 18 tests across MCP,
server authorization, client permission behavior and the print contract (the contract suite
is included in both runs). It verifies caller thread/default save, explicit options and save
false, typed failures, restricted-agent rejection, and destination terminal grants. No
repo-wide suite or browser was launched for this packet.

| Test file                                                    | Verified behavior                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/pcb-print.test.ts`              | Input defaults, presets, all 64 board layers, bounded inputs and invalid paper/side rejection.                                                                                                                                                                                                                                                                            |
| `apps/server/src/fork/pcb-preview/trueScalePrint.test.ts`    | Byte-preserving paper replacement/insertion, metric drawing sheet, paper orientation and fit warning, sanitized filenames, KiCad 9/10 flags, PDF caching and atomic save, source/project preservation, bottom mirroring, presets, staged tscircuit conversion, tool failures, PDF header rejection, cancellation cleanup, missing boards/layers and destination symlinks. |
| `apps/server/src/fork/pcb-preview/http.test.ts`              | PDF and GLB MIME types, no forced download disposition, and plain 404 responses for invalid tokens, traversal and unknown files.                                                                                                                                                                                                                                          |
| `apps/web/src/fork/pcb-preview/trueScalePrint.logic.test.ts` | Side defaults with absent layers, bottom mirror default and stale-source detection.                                                                                                                                                                                                                                                                                       |

```sh
./node_modules/.bin/vp test run packages/contracts/src/fork/pcb-print.test.ts \
  apps/server/src/fork/pcb-preview/trueScalePrint.test.ts \
  apps/server/src/fork/pcb-preview/http.test.ts \
  apps/web/src/fork/pcb-preview/trueScalePrint.logic.test.ts
```

KiCad is absent from PATH and the standard macOS application location. A real CLI PDF export,
PDF page dimensions and physical 50 mm bar calibration were therefore **not run**. No tool
installation was attempted. KiCad 9's serializer, worksheet file version and PDF job creation
were checked against the official source mirror, as recorded in REFERENCES.md. The fake tool
writes a small PDF fixture; this proves host flow and validation, not rendering accuracy.

## Remaining manual checks

With Kyle's authorization in an isolated dev client, on a host with KiCad:

1. Print Top at 100%. Measure the 50 mm bar and board outline; lay a real connector or header
   on its footprint. Check bottom mirroring and matching top/bottom outlines.
2. Check A4, Letter, A3 and Ledger page dimensions, board-page orientation, and clipping warnings.
   Load the generated drawing sheet in KiCad and confirm its contents remain visible.
3. Confirm a fit-to-page print changes the reference bar's physical length.
4. Save into `fab/print/`, verify the source revision stays unchanged, and open/reveal the PDF on
   the local desktop. Remote clients should offer Download, without local host actions.
5. Check Electron's Blob download save flow and remote downloads over LAN, Tailscale and tunnel.
6. On KiCad 9, verify the zone warning and 1:1 output. On KiCad 10, verify in-memory zone refill.
7. Check trusted tscircuit source conversion, missing-tool errors and untrusted disabling.
8. Make a PDF through MCP and `t3 pcb print`, and check the saved workspace path.
9. Cancel or close during PDF creation and confirm no saved output or staging folder remains.

Browser/GPU interaction, physical printing and actual tscircuit-to-KiCad export remain
unverified. Mobile and upstream servers have no PCB panel. Full fork checks and nightly merge
rehearsal were not run for this focused implementation.

## Integrated verification

The integrating agent completed strict scoped lint and typechecks for contracts,
client-runtime, server and web after wiring all five PCB packets. The focused service
suite passes 31 regressions, including signed PDF limits, canonical output exclusions and
optional project-rule read failures. No repo-wide suite or browser was run.
