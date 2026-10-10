# L58 product

## Problem

Today ERC and DRC run only when someone presses "Run ERC" or "Run DRC" or an agent calls
`loom_pcb_check`. After every save the report turns "out of date" and stays that way until
someone remembers to run it again. In the agent loop that means an extra round trip per fix, and
it is easy to miss that a fix introduced a new error elsewhere. Even when a run happens, you
compare counts by memory: was it 7 warnings before, or 9?

## What the user can do

- Turn on "Check after each save" for ERC, DRC or both, for the whole project.
- Save in KiCad (or let the agent save) and see the status bar change to "DRC: checking", then
  "DRC: 2 new, 5 resolved".
- Open Checks and see "2 new, 5 resolved since the last run" with the new findings marked
  "New".
- Keep working while a run is pending: another save restarts the wait, and a run that is
  already out of date stops.
- Run a check by hand at any time; it replaces any automatic run for that check.
- See when automatic checks have paused because the last run was too slow or failed, and why.
- Let an agent read checks that are current for the saved files, with the same new and resolved
  lists.

## Entry points

| Way in                                                          | Way out                                                                   | Way to see the state                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| "Check after each save" with "ERC" and "DRC" switches in Checks | Turn the switches off                                                     | The switches; the status bar chip shows "checking" or a delta after saves |
| Agent `loom_pcb_check_settings` with `autoChecks`               | Same tool with `false`, or the switches                                   | `loom_pcb_check_settings` with no arguments; the switches in Checks       |
| A save while the design is open                                 | Close the panel or switch design; pending runs stop                       | Status bar chip "DRC: checking"                                           |
| Agent `loom_pcb_latest_checks` (fresh by default)               | Pass `ensureFresh: false`                                                 | The returned results' `sourceHash` and `delta`                            |
| Automatic pause after a slow or failed run                      | Run the check by hand (a fast run resumes), or save again after a failure | Status bar chip "DRC: paused" and a notice in Checks                      |

The delta stays on the chip until the next run of that check.

## States

- Off (default): nothing changes from today.
- Waiting: a save happened, the 2 s debounce is running. No visible change; a "checking" label
  that flickers for two seconds would be noise.
- Running: the chip reads "ERC: checking" or "DRC: checking" (static text, no spinner) and
  Checks shows its existing running status with the detail "Started after a save.".
- Done: the chip reads "DRC: 2 new, 5 resolved", "DRC: 2 new", "DRC: 5 resolved", or the
  existing "DRC 7" / "DRC clean" when nothing changed. Its tooltip gives the total and when it
  ran.
- Paused, slow: "Automatic DRC is paused because the last run took 2 min 10 s. Run it from
  Checks to resume." The chip reads "DRC: paused".
- Paused, failed: "Automatic ERC stopped after a failed run. It resumes after the next save."
  The previous good report stays.
- Stale: unchanged from L24. A report from older files is "out of date" until the automatic
  run finishes.
- Disabled: tscircuit designs (no ERC or DRC); a connection without permission to run terminal
  commands sees the switches but cannot change them ("This connection needs permission to run
  terminal commands.", the existing wording at `ChecksView.tsx:191`).
- Loading: the switches render disabled until the project setting loads.
- Error: a failed settings save shows "The setting could not be saved." under the switches and
  leaves them as they were.

## Surfaces and connection modes

Web and desktop. Mobile has no PCB panel. The scheduler runs on the environment host, so a
remote client gets the same behavior as a local one; two clients on the same design share one
run. On an upstream T3 server there is no PCB panel.

## Decisions

- Per project, default off. The same board rules apply to every design in a project, and
  automatic tool runs cost CPU on the host, so they are opt-in.
- Separate ERC and DRC switches. ERC is cheap; DRC on a large board is not.
- Runs only while a client watches the design or an agent asks. Watching every project in the
  background would spend CPU on designs nobody is looking at.
- Agents get fresh results by default from `loom_pcb_latest_checks` when the project has the
  setting on. Agents read checks right after saving; making them pass a flag would be a trap.
- The delta compares with the previous persisted run of the same check, manual or automatic,
  and ignores excluded findings.
- Failed and timed-out automatic runs are not persisted. They would replace a useful stale
  report with an empty one.
- A manual run interrupts an automatic run of the same design and suppresses automatic runs
  until it finishes.

## Decisions needed from Kyle

None. Two recommendations are already applied and worth a glance:

- Scope: per project, as the brief recommended. Per design would need a setting per file;
  environment-wide would surprise someone opening a large board in another project.
- Slow-run cap: 60 s per check. A board that takes longer than a minute should be checked by
  hand. Raise it later if real boards hit it often.
