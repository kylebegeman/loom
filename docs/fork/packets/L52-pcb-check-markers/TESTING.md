# L52 verification

Implemented locally on `feat/pcb-units-presets-stats-print-capture`, based on `7973b7fdef`.
Verification uses isolated temporary files and jsdom. No live state, CAD installation,
production dependencies, browser automation or dev servers were used.

## Passed

79 focused tests across 10 files, run in bounded groups:

| File                                 | Tests | Evidence                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kicadReports.test.ts`               |     6 | Sheet mapping, UUID/identity preservation, repeated ids, byte/count bounds, old raw versus already-corrected ERC and unknown units.                                                                                                                                                   |
| `realReports.test.ts`                |     4 | Real KiCad 10.0.6 fixture counts remain 40 ERC and 68 DRC; scale and unit conversion remain correct.                                                                                                                                                                                  |
| `PcbPreviewService.test.ts`          |    32 | Fresh provenance/ids, legacy normalization against saved schematic evidence, no persisted-file rewrite and existing service regressions.                                                                                                                                              |
| `mcp.test.ts`                        |    11 | Registered caller-scoped finding/markers actions, unknown-action refusal and retained tool/permission regressions.                                                                                                                                                                    |
| `findings.test.ts`                   |     4 | One pin per violation, exclusions, other item points, severity/sheet/position order, wrapping, hit tolerance and pixel-sized markers.                                                                                                                                                 |
| `checkMarkers.interactions.test.tsx` |     4 | Actual panel/viewport with mocked service data: keys cross sheets and wrap, markers reappear after hiding, Escape order, shared exclusions, stale pins/detail, precise zoom sizing, pointer selection/clearing, cross-surface agent navigation, snapshots, and SVG capture with pins. |
| `workspace.interactions.test.tsx`    |     8 | Existing viewport, capture and Checks interactions; excluded visibility now comes from a controlled fixture.                                                                                                                                                                          |
| `length.interactions.test.tsx`       |     2 | Canonical report coordinates still format and Locate correctly in display units; hardware input regression.                                                                                                                                                                           |
| `preferences.test.ts`                |     3 | Old selections/trust survive the new default; marker visibility round-trips.                                                                                                                                                                                                          |
| `pcb-workspace.test.ts`              |     5 | Existing workspace decoding, old editor snapshots and the 50-finding/nonnegative-count snapshot boundary.                                                                                                                                                                             |

Contracts, client runtime, server and web package typechecks pass. Existing Effect suggestions
are unrelated to this packet. Strict lint passes on changed TypeScript files. Formatting and
`git diff --check` pass. Existing ext-core, ext-panels and ext-mcp existence checks pass;
no upstream seam, transport, grant or dependency was added.

Logs are temporary work artifacts under `/tmp/loom-l52-*.log`, outside the repository.
Repository-wide checks were not run, following Kyle's minimum-check instructions.

## Legacy coordinate provenance

The base includes `6ddf84c1aa`, which corrected ERC but did not store a normalization flag.
Affected unflagged reports can therefore contain either raw or already-corrected values.
Saved symbol positions verify the scale before conversion. When the saved drawing no longer
provides that evidence, the list remains, uncertain positions are omitted, and the log asks
for an ERC rerun. Report files are never rewritten on read. New runs carry `pointsInMm` and
need no calibration.

## Pending real-client checks

With Kyle's permission and KiCad available, verify a real hierarchical design in web/desktop
and over a remote connection:

1. Run ERC and DRC; pins sit on the corresponding symbols/pads and schematic sheets.
2. Step with `.`/`,` across sheets; check wrap announcements, active row scrolling and Escape.
3. Click pins and empty space; inspect multi-item rings/lines at fitted and maximum zoom.
4. Hide markers, reload, restore with stepping and toggle excluded findings.
5. Save a design change and rerun checks; stale pins/detail clear on the new report.
6. Check light/dark themes, actual PNG/SVG downloads, and agent snapshots in a real client.

No real KiCad command, browser/GPU interaction, remote connection or download was exercised.
Mobile has no PCB panel; upstream T3 servers remain capability-gated.
