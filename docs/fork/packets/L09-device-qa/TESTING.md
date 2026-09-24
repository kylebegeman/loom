# L09 testing

Focused tests; no repo-wide checks; no sleeps. Async server tests wait on the run's completion
`Deferred`, on a `runEvents` stream reaching `runFinished`, or on a `watchEvidence` emission.

## Automated tests

Server (`apps/server/src/fork/device-qa/`):

| Test file                                   | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `argent.test.ts`                            | NDJSON parsing of recorded `progress`, `result` and `error` lines; non-JSON lines become text; unknown fields ignored; step mapping keeps artifact paths and drops null artifacts; `flowRunArgs` builds a relative path, `--device`, `--platform`, `--json-stream`, `--output`, optional `--update-baselines`; the spawn environment always contains `DO_NOT_TRACK=1`; telemetry status parsing (enabled, disabled, unknown).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `flows.test.ts`                             | Kind classification (leading `echo` / `script` skipped; `launch` first means e2e; otherwise fragment); prerequisite and first echo extraction; snapshot steps counted inside `when:` blocks; invalid YAML, YAML with anchors, and bad file names are `invalid` with a message; `__baselines__` and dot-directories skipped; walk limit sets `truncated`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `hostDevices.test.ts`                       | `simctl list devices booted -j` and `adb devices -l` parsing; status bar argv; PNG signature and dimensions; recording argv.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `runStore.test.ts`, `evidenceStore.test.ts` | On `SqlitePersistenceMemory`: insert, update, list order and limits, retention, interrupted marking, deletion by thread; totals (count and bytes, installs count 0 bytes); expiry query selects only `ready` and `failed` rows older than the cutoff.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DeviceQaService.test.ts`                   | With a fake spawner: `deleteAllEvidence` removes every item and file of the thread except an active recording and reports `skippedActive: 1`; `runFlows` on a target that is not a local simulator or emulator fails with `device-unavailable`; a run of two flows emits `flowStarted`, `step`, `flowFinished` per flow and one `runFinished`; a validation `error` record marks that flow `error` and continues with the next; cancel marks remaining flows `cancelled`; a second run on the same device fails `busy`; a second run on another device waits for the argent semaphore (asserted with a `Deferred`, no timers); a finished run adds one `flow-report` evidence row; `readFlow` refuses a path outside `.argent/flows`; `installApp` refuses a non-`.app`/`.apk` path and a workspace path that escapes the root; screenshot on an SSH host calls `DeviceService.screenshot` (test layer) and on a local simulator calls `simctl` (fake spawner). |
| `reactor.test.ts`                           | A `thread.deleted` event removes rows and files (in a temp directory); the startup sweep removes evidence of threads missing from a fake projection; with `evidenceExpireDays: 7` and `TestClock` advanced past 6 hours, items older than 7 days are deleted and newer ones and an active recording stay; with `null`, nothing is swept; a `flow-report` item's run directory survives its deletion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `mcp.test.ts`                               | Tool names prefixed `loom_` and unique; both tools fail with upstream's capability error when the invocation lacks `device`; default device resolution order; the flow tool result lists at most 50 steps per flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Contracts: `packages/contracts/src/fork/device-qa.test.ts`: tags start with `loom.device-qa.`.

Web (`apps/web/src/fork/device-qa/`):

| Test file              | Covers                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attach.test.ts`       | The attach helper chooses `addImage` for PNG, `addFiles` for MP4 under the limit, and inserts a path note above it (store calls mocked; this tests the decision logic, not markup). |
| `recordPrompt.test.ts` | The record prompt includes the flow name, folder, device and platform, and rejects names argent cannot run.                                                                         |

Registry invariant tests from the extension points must pass with the new entries.

## Commands

```sh
vp test run apps/server/src/fork/device-qa packages/contracts/src/fork/device-qa.test.ts apps/web/src/fork/device-qa
vp test run apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts apps/web/src/fork/panels/registry.test.ts apps/web/src/fork/settings/registry.test.ts packages/contracts/src/fork/keybindings.test.ts
vp lint apps/server/src/fork/device-qa apps/web/src/fork/device-qa apps/web/src/components/device/DevicePanel.tsx packages/contracts/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

## Manual check

With Kyle's permission for the dev server, browser and (separately) installing argent:

1. Seed the worktree `.t3` (AGENTS.md, "Test data"), start `vp run dev` in the background.
2. In a thread on a small iOS app project, open the Device panel and boot a simulator. The
   toolbar shows the two new buttons. Capture a screenshot: a toast appears; the Device QA
   Evidence tab lists it with a thumbnail. Attach it; the composer shows the image; send it.
3. Capture with "Clean status bar": the image shows 9:41 and full bars; the simulator's status
   bar is back to normal afterwards. The Evidence header shows the item count and size;
   "Delete all for this thread" asks for confirmation and empties the list.
4. Record 10 seconds, stop: the MP4 plays in the Evidence tab.
5. Without argent: the Flows tab shows the install card; "Type in terminal" leaves the command
   typed but not run in a new terminal.
6. With argent installed: telemetry notice appears if it is on; "Turn off telemetry" clears it.
   Ask the agent (with argent MCP configured) to record a flow via "Record with the agent". The
   flow appears after refresh. Run it: steps stream live and pass. Change a label in the app,
   run again: the snapshot step fails with baseline, current and diff images. Update baselines
   after the confirmation; the next run passes.
7. Install tab: install the app's `.app` from DerivedData with Launch on.
8. Agent: with Agent device access on, "capture a Device QA screenshot" makes the agent call
   `loom_device_qa_capture`; the item is marked Agent. Turn access off and retry: the tool
   fails with the capability error.
9. Delete the thread: its evidence folder under `.t3/userdata/fork/device-qa/evidence/` is gone.
10. Remote: over `vp run dev --share` from a second browser, thumbnails and videos load.
11. Upstream server: the Device panel toolbar shows no extra buttons; the launcher entry is
    disabled with its hint.

## Merge safety

Record the merge preview result (SEAMS.md) and, after merge, the result of
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`. The only
packet-seam file that may conflict is `apps/web/src/components/device/DevicePanel.tsx`.
