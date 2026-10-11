# L58 testing

Focused tests, no repo-wide checks, no sleeps. Time-based behavior is driven with `TestClock`
and milestones with `Deferred`, like the existing watch test in `PcbPreviewService.test.ts`.

## Automated tests

| File                                                                                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/fork/pcb-preview/kicadReports.test.ts` (new or extended)                          | `checkDelta`: added and resolved by id; excluded findings ignored on both sides; a newly excluded finding counts as resolved; ids computed for findings written without one; caps at 200 and 50 with exact counts; descriptions trimmed; `approximate` when either side is truncated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/server/src/fork/pcb-preview/projectSettings.test.ts` (new)                                   | Unknown project returns both checks off; an empty or partial file decodes with defaults; an unreadable file returns defaults; `update` merges only given fields, persists across a new store, and publishes once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/server/src/fork/pcb-preview/autoChecks.test.ts` (new)                                        | With fake `runCheck` that awaits a `Deferred`: no run without a watcher; a notify runs after `TestClock.adjust("2 seconds")`, not before; three notifies inside the window run once with the last hash; a notify during a run interrupts it (the fake sees interruption) and the next run uses the new hash; ERC and DRC run in order and never together; two designs never run at once; a manual run interrupts the auto run of that design and blocks new ones until it ends; a stored result matching the hash skips; a fake duration over 60 s pauses slow until a fast manual run; a failed run pauses until the hash changes; dropping the last watcher interrupts pending work; a settings change re-notifies watched designs; `ensureFresh` joins a pending run for the same hash and starts one without debounce otherwise, and does nothing when the setting is off. |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (extend the check test at `:280-298`) | A second run with the fake runner returns a delta against the first; `trigger` and `durationMs` are set; an automatic failure is not persisted while a manual failure still is; a check file written before L58 decodes. Extend the watch test near `:496`: a source change with DRC enabled leads to a persisted auto result and a `checkEvents` snapshot with the new `ranAt`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (update)                                            | `loom_pcb_check_settings` with no arguments reads, with `autoChecks` updates; `loom_pcb_latest_checks` passes `ensureFresh: true` when omitted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/src/fork/pcb-preview/usePcbPreview.test.tsx` (extend)                                    | A `checkEvents` snapshot with a newer `ranAt` refreshes `latestChecks`; an older or equal one does not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

No markup tests for the chip or the settings row.

## Commands

```sh
vp test run apps/server/src/fork/pcb-preview/kicadReports.test.ts \
  apps/server/src/fork/pcb-preview/projectSettings.test.ts \
  apps/server/src/fork/pcb-preview/autoChecks.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/realReports.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts \
  apps/web/src/fork/pcb-preview/usePcbPreview.test.tsx
vp lint packages/contracts/src/fork apps/server/src/fork packages/client-runtime/src/fork \
  apps/web/src/fork/pcb-preview
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, on a host with KiCad 10 and a project with a board:

1. Open the board. Checks shows "Check after each save" with both boxes off. Save a change: no
   run.
2. Turn on DRC. Move a track into a clearance violation and save. About two seconds later the
   chip reads "DRC: checking", then "DRC: 1 new". Checks marks it "New".
3. Fix it and save. The chip reads "DRC: 1 resolved"; the resolved list shows it.
4. Save three times quickly: one run. Save during a run: it restarts.
5. Press "Run DRC" during an automatic run: one manual result lands, no automatic run follows
   for the same files.
6. Close the panel during a run; confirm with Activity Monitor or `ps -p <pid>` on the
   `kicad-cli` PID you saw start that it exits.
7. Open a second client on the same design: both update from one run.
8. Ask the agent to fix a finding and read checks. It gets the fresh result with the finding in
   `resolved`, and the panel updates without a click.
9. On a connection without terminal permission, the boxes are disabled with the notice.
10. Repeat 2 and 3 over Tailscale or T3 Connect.

Upstream server: no PCB panel. tscircuit design: no ERC or DRC, no settings row.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect a clean merge since no
upstream file changes. After merge to `main`, Kyle runs
`scripts/fork/loom.sh integrate nightly --dry-run`.

## Local implementation results

Implemented on `feat/pcb-units-presets-stats-print-capture`. Focused scheduler, settings, report, service, MCP, hook and command-permission checks passed. The scheduler tests use TestClock and Deferred milestones, including cancellation of in-flight work. Contracts, client-runtime, server and web typechecks and scoped lint passed. Real KiCad/client, multi-client remote and pause timing checks remain unverified; no browser or live state was used.
