# L64 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/pcb-fab.test.ts` (new)                   | `PcbFabCapabilities` decodes `{}` to version 0, no entries, null default. An entry without the two optional fields decodes them as null. Rejects a length of 0 or 10 mm, a bad id, 25 entries, a bad `checkedOn`. `PcbFabCheckInput` without `fabId` decodes.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/server/src/fork/pcb-preview/fabData.test.ts` (new)              | Every built-in decodes; ids unique; `sourceUrl` is https; `checkedOn` is 2026-10-10; `minViaMm > minDrillMm`. `decodeFabCapabilitiesLenient` keeps good entries and reports a bad one in `skipped`; malformed JSON fails. `toCatalog` falls back to `jlcpcb-standard` for a missing default. Each JLCPCB cost rule at its boundary: drill 0.15 any pad; drill 0.2 pad 0.4 (applies) and 0.45 (does not); drill 0.3 pad 0.4 (does not); 100.0 mm (no) and 100.1 mm (yes). PCBWay drill 0.19 and 6.1. OSH Park estimate for 2 and 4 layers.                                                                                                                                              |
| `apps/server/src/fork/pcb-preview/fabCheck.test.ts` (new)             | `fabRules` output text for one capability, null values skipped into `notChecked`. `rulesFile` keeps user rules first and adds `(version 1)` only when absent. `clearBoardMinimums` zeroes the listed keys, leaves others, returns null for bad JSON. `classifyViolations` maps each fab type to its rule, counts others into `alsoInDrc`, drops library types, parses `actual` when present. `boardFacts` from the fixture board: layers, thickness, ENIG finish, grouped via sizes, castellated count, one via-in-pad, smallest pad drill; with a `PcbBoardStats` it uses the stats' layers and size. `boardFindings` for layers, thickness and finish, including HAL and HASL alike. |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (update) | Capabilities: conflict on stale version, built-in id collision, bad URL, unknown default refused, round trip. Check with a fake `run`: arguments per KiCad version, temporary rules and project contents, user files unchanged, unknown fab, tscircuit refused, `failed` and `timed-out` outcomes, persistence and `latestFabCheck`, older result not overwriting newer, temporary directory removed. `updateLibrary` still refuses credentialed URLs after the `isPlainHttpUrl` extraction.                                                                                                                                                                                           |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (update)               | The four tools call the service with the caller's thread; the save tool requires environment write access.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/fork/pcb-preview/realTools.test.ts` (update, opt-in) | With `LOOM_TEST_PCB_FIXTURES` and KiCad: the fixture board against JLCPCB standard reports the via and drill types expected by `FAB_RULE_TYPES`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/src/fork/pcb-preview/fabCapabilities.logic.test.ts` (new)   | `duplicateCapability` ids, `parseLengthList` with spaces and bad values, `capabilityErrors`, `removeCapability` clearing the default, `fabSummaryText`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Permission maps are covered by the existing `commandPermissions.test.ts` loop. No component
markup tests.

## Commands

```sh
vp test run packages/contracts/src/fork/pcb-fab.test.ts \
  apps/server/src/fork/pcb-preview/fabData.test.ts \
  apps/server/src/fork/pcb-preview/fabCheck.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts \
  apps/web/src/fork/pcb-preview/fabCapabilities.logic.test.ts
LOOM_TEST_PCB_FIXTURES=1 vp test run apps/server/src/fork/pcb-preview/realTools.test.ts
vp lint packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/server/src/fork/pcb-preview apps/web/src/fork/pcb-preview
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

The opt-in real-tool run needs KiCad; skip it and say so when absent.

## Manual checks for Kyle

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, KiCad 9 or 10 installed:

1. Open a small 2-layer KiCad board. Checks, **Fab**, JLCPCB standard, Run. Compare a reported
   via with the board in KiCad. Locate moves the view to it.
2. Switch to JLCPCB advanced and run: the small-via finding disappears and the cost driver
   remains.
3. OSH Park 4-layer on the 2-layer board: a layer count error and an area estimate.
4. `git status` in the project after each run: nothing changed.
5. Fab capabilities…: duplicate JLCPCB standard, rename it, set track to 0.15, set as default,
   save. Run: track findings appear for tracks under 0.15 mm. Open the panel in a second
   browser: the entry and default are there. Delete it: the default returns to JLCPCB standard.
6. Edit an entry in two browsers and save both: the second shows the conflict message and keeps
   its edits.
7. Edit the board in KiCad and save: the result shows "out of date". Edit the fab entry: "Limits
   changed since this check".
8. From a connection without terminal permission: Run is disabled with the permission notice.
9. Ask an agent: "check this board against PCBWay and summarise the cost drivers".
10. A tscircuit design: the Fab card says it needs a KiCad board.

Upstream server: no PCB panel. Mobile: no PCB panel.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
