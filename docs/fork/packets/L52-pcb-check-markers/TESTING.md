# L52 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/pcb-preview/kicadReports.test.ts` (new)                                      | `unitScale`: mm 1, in 25.4, mils 0.0254, unknown `null` drops positions but keeps the finding. `ercScaleFactor`: 100 for `9.0.4` and `10.0.6`, 1 for `10.0.7`, `10.99.0-123-g...` and DRC of any version. The real fixture `fixtures/erc.json`: P101 lands at `41.91, 35.56` and every position fits inside A4 (297 by 210 mm); `fixtures/drc.json` positions are unchanged. `ercSheetId`: `/` gives `root.svg`, `/ampli_ht_vertical/` gives `root-ampli_ht_vertical.svg`, a name with `:` is sanitized like `PcbPreviewService.ts:1476`. `findingId`: stable across item order, different for the same uuids on another sheet path, description fallback rounds to 0.1 mm, duplicates get `-2`. `uuid` survives parsing. `normalizeCheckResult` is idempotent and upgrades a pre-L52 ERC result (no `pointsInMm`, `kicadVersion` `10.0.6`). |
| `apps/server/src/fork/pcb-preview/realReports.test.ts` (existing)                                  | Counts stay 40 and 68; must keep passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (update the check test at `:280-298`) | A fresh run returns `pointsInMm: true` and ids; a check file written in the old shape comes back from `latestChecks` with corrected positions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (update)                                            | `loom_pcb_editor` accepts `{ action: "finding", name: "next" }` and `{ action: "markers", enabled: false }`; an unknown action still fails to decode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/fork/pcb-preview/findings.test.ts` (new)                                             | `checkFindings` makes one finding per violation at its first located item, skips unlocated ones, hides excluded unless asked, falls back to index ids for old results. `orderFindings` sorts errors, warnings, info, then sheet order, then rows. `stepFinding` wraps both ways and starts at the first or last with no active id. `hitFinding` picks the nearest within 8 px and nothing beyond. `markerSize` keeps a constant pixel size across scales.                                                                                                                                                                                                                                                                                                                                                                                    |

No markup tests for `CheckMarkers`; it is a thin map over the tested helpers.

## Commands

```sh
vp test run apps/server/src/fork/pcb-preview/kicadReports.test.ts \
  apps/server/src/fork/pcb-preview/realReports.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts \
  apps/web/src/fork/pcb-preview/findings.test.ts
vp lint packages/contracts/src/fork apps/server/src/fork/pcb-preview \
  apps/web/src/fork/pcb-preview
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, on a host with KiCad 10.0.6 (or 9.x) and a hierarchical project:

1. Run ERC. Pins sit on the symbols named in each finding, on the root sheet and on a sub-sheet.
2. Press `.` repeatedly: errors come first, sheets switch, the last wraps to the first with
   "Back to the first finding". `,` goes back. Checks opens with the row highlighted.
3. Click a pin in Select mode; it becomes active. Click empty space or press `Escape`.
4. Run DRC on a board with a clearance error: one pin, a ring on the second item when active.
5. Press `C`; pins hide; reload the page; they stay hidden. Press `.`; they come back.
6. Turn on "Show excluded": excluded findings appear in the list and as hollow pins.
7. Save a change in KiCad: pins dim, the active finding shows "Stale". Run again: they brighten.
8. Zoom from fit to maximum: pins stay the same size on screen. Capture the drawing: pins
   appear in the PNG.
9. Ask the agent to step to the next finding and take a snapshot; the panel moves and the
   snapshot lists the ids.
10. Repeat 1 and 2 over Tailscale or T3 Connect, in light and dark themes.

Upstream server: no PCB panel. tscircuit design: no Checks tab, no pins.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge preview in SEAMS.md; expect a clean merge since
no upstream file changes. After merge to `main`, Kyle runs
`scripts/fork/loom.sh integrate nightly --dry-run`.
