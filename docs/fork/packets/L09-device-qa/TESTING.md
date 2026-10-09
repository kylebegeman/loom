# L09 testing

Focused tests; no repo-wide checks; no sleeps. Async server tests wait on the run's completion
`Deferred`, on a `runEvents` stream reaching `runFinished`, or on a `watchEvidence` emission.

## Completion evidence

Record the actual argent version and device/toolchain used. Verify passing flows, failed
snapshot comparisons, confirmed baseline updates, cancellation and busy-device behavior.
Exercise screenshot capture, recording finalization, artifact installation, attachment to
chat and evidence deletion on the supported local iOS/Android targets. Check SSH screenshots
through DeviceService when that connection mode is available. Report unavailable targets
explicitly; synthetic fixtures and fake processes are not evidence of a working device flow.

Verify the refreshed DevicePanel actions in normal and floating layouts. Keep the existing
screenshot-download action working, and show no empty action row against an upstream server.
Verify agent access denial and thread deletion against the actual released lifecycle. Test
optional L10 hooks when both packets are present; L09 must work without L10.

## Automated tests

Server (`apps/server/src/fork/device-qa/`):

| Test file                                   | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `argent.test.ts`                            | NDJSON parsing of recorded `progress`, `result` and `error` lines; non-JSON lines become text; unknown fields ignored; step mapping keeps artifact paths and drops null artifacts; `flowRunArgs` builds a relative path, `--device`, `--platform`, `--json-stream`, `--output`, optional `--update-baselines`; the spawn environment always contains `DO_NOT_TRACK=1`; telemetry status parsing (enabled, disabled, unknown).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `flows.test.ts`                             | Kind classification (leading `echo` / `script` skipped; `launch` first means e2e; otherwise fragment); prerequisite and first echo extraction; snapshot steps counted inside `when:` blocks; invalid YAML, YAML with anchors, and bad file names are `invalid` with a message; `__baselines__` and dot-directories skipped; walk limit sets `truncated`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `hostDevices.test.ts`                       | `simctl list devices booted -j` and `adb devices -l` parsing; an emulator's release and AVD id, either missing; an AVD's display name from `config.ini`; status bar argv; PNG signature and dimensions; recording argv.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `runStore.test.ts`, `evidenceStore.test.ts` | On `SqlitePersistenceMemory`: insert, update, list order and limits, retention, interrupted marking, deletion by thread; totals (count and bytes, installs count 0 bytes); expiry query selects only `ready` and `failed` rows older than the cutoff.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DeviceQaService.test.ts`                   | With a fake spawner: `deleteAllEvidence` removes every item and file of the thread except an active recording and reports `skippedActive: 1`; `runFlows` on a target that is not a local simulator or emulator fails with `device-unavailable`; a run of two flows emits `flowStarted`, `step`, `flowFinished` per flow and one `runFinished`; a validation `error` record marks that flow `error` and continues with the next; cancel marks remaining flows `cancelled`; a second run on the same device fails `busy`; a second run on another device waits for the argent semaphore (asserted with a `Deferred`, no timers); a finished run adds one `flow-report` evidence row; `readFlow` refuses a path outside `.argent/flows`; `installApp` refuses a non-`.app`/`.apk` path and a workspace path that escapes the root; screenshot on an SSH host calls `DeviceService.screenshot` (test layer) and on a local simulator calls `simctl` (fake spawner). |
| `reactor.test.ts`                           | A `thread.deleted` event removes rows and files (in a temp directory); the startup sweep removes evidence of threads missing from a fake projection; with `evidenceExpireDays: 7` and `TestClock` advanced past 6 hours, items older than 7 days are deleted and newer ones and an active recording stay; with `null`, nothing is swept; a `flow-report` item's run directory survives its deletion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `mcp.test.ts`                               | Tool names prefixed `loom_` and unique; both tools fail with upstream's capability error when the invocation lacks `device`; default device resolution order; the flow tool result lists at most 50 steps per flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Contracts: `packages/contracts/src/fork/device-qa.test.ts`: tags start with `loom.device-qa.`.

Web (`apps/web/src/fork/device-qa/`):

| Test file              | Covers                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devices.test.ts`      | Device options list host simulators and emulators first, then booted Device panel devices without duplicates; the picker keeps a chosen device, then the watched one. |
| `recordPrompt.test.ts` | The record prompt includes the flow name, folder, device and platform, and rejects names argent cannot run.                                                           |

Client runtime: `packages/client-runtime/src/fork/device-qa.test.ts`: the run view reducer
applies live events and fills in flows a run never reached from `runFinished`.

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
12. Physical device (only if an iPhone is connected): open Device QA from the Device panel
    toolbar on it; the Flows tab shows "Flows run on simulators and emulators in this version."
    and offers the booted simulators.

## Results

Recorded 2026-10-08 on `feat/loom-device-qa`, Xcode 27.0, an iPhone 17 simulator on iOS
27.0, an Android 16 emulator (`sdk gphone64 arm64`), adb 1.0.41 and argent 0.25.2 (installed
with the runner-only command, telemetry disabled).

Automated, all passing: both test command lines above plus the client runtime reducer test
(18 files, 75 tests), lint over the listed paths and `apps/web/src/fork`, and `tsc --noEmit`
in server, web, contracts and client runtime.

Real devices, through `DeviceQaService` with in-memory stores, real `xcrun` and `adb`, and
no client:

- Status lists the booted simulator and emulator with names and OS versions, and reports
  argent as missing before the install and as 0.25.2 with telemetry disabled after it.
- iOS: a screenshot with clean status bar saves a 1206x2622 PNG showing 9:41 with full
  signal and battery; `simctl status_bar list` is empty before and after. A 4 second
  recording stops to a playable MP4; a 2 second limit stops on its own and finalizes.
  Installing a scratch `.app` with launch installs and launches it and records an install
  item with its bundle identifier. Deleting one item
  removes its file; deleting all reports the count and bytes freed.
- Android: screenshot, a stopped recording and a limited recording all finalize as above.
- Flows, with real argent on a scratch UIKit app: the flow list shows two e2e flows and a
  fragment with step and snapshot counts. A run streams `flowStarted`, seven `step` events,
  `flowFinished` and `runFinished` and passes, snapshot included. A second run on the busy
  device is refused with `busy`; cancelling a two-flow run ends both flows `cancelled`.
  After a visual change the snapshot step fails (92.91% of pixels differ) with baseline,
  current and diff images in the run's folder. A baseline update passes and the next run
  passes at 0.00%. Each run adds a flow-report evidence item.

argent 0.25.2 notes from these runs:

- Its iOS runner reads the UIView hierarchy, so a pure SwiftUI screen is one hosting view:
  `id` and `text` selectors find nothing there, though `describe` lists the text. Flows
  for SwiftUI need UIKit-backed views or coordinate steps.
- Live `progress` records carry artifact handles; the final `result` record carries paths,
  which Loom uses.
- A small change can pass: red label text differed by 0.47%, under the default 0.5%.

This check found and fixed a cancelled run's report reading like a failure. It is now
labelled with its cancelled count and not marked failed.

Web client on 2026-10-09, in the Browser panel against a worktree dev server with a copy
of real data, the iPhone 17 simulator and the scratch app:

- Device QA opens from the right-panel launcher (Q), shows the draft-thread message, and
  picks the booted simulator. The flow list shows folders, step and snapshot counts and the
  fragment badge.
- A run streams its steps with durations. A failing snapshot shows baseline, current and
  diff images; **Update baselines** asks first, then passes, and **Run failed again**
  switches to the new run with Cancel. History lists the runs. A run started elsewhere,
  such as from the palette, replaces the shown run.
- Install with a relative path installs and launches the app. Screenshots with a clean
  status bar show 9:41 and a thumbnail. A recording counts up, stops, and plays back
  (7.7 s at 1206x2622 through a signed URL). Copy path, Delete and **Delete all for this
  thread** work; Delete all confirms with the count and size and reports what it freed.
  Attach puts a screenshot in the composer as an image and a flow report as its host path.
- The Device panel row shows **Capture evidence** and **Device QA** in the inline panel and
  in the narrow-window sheet, next to the upstream controls rail with its own screenshot
  button. Capture shows a toast whose **Attach** adds the image. The floating mini-player
  is upstream's own presentation and has no row, as SEAMS.md intends.
- The palette lists Open, Capture screenshot and Run last flow, and Stop recording while one
  runs; each works. Settings, Loom, Device QA saves the old-evidence switch across a
  reload and shows its day count only when on. **Record with the agent** rejects an unsafe
  name and puts a prompt with the flow path, device and argent tools in the composer.

This pass found and fixed:

- "1 steps" and "1 snapshots" in the flow list.
- A passing snapshot step's diff reason shown in error color.
- The panel staying on an old run after Update baselines, Run failed again or the palette
  started a new one.
- A failed run's flow report showing its run id as an error and offering no Attach.
- The evidence size counting flow reports, whose files belong to their runs and are kept
  on delete, so the confirm overstated what Delete all frees.

A second web pass the same day, with a Medium Phone emulator (Android 16) booted beside the
simulator and another session's emulator:

- An Android flow (launch Settings, await text, idle, assert) passes 5 of 5 and becomes the
  latest result; History names each run's device. An iOS-only flow on the emulator fails
  in its launch step with argent's reason (no app id for `android`), so Run stays enabled
  and argent decides what a flow supports.
- With a missing argent path in Settings, the Flows tab shows the install card, and **Type
  in terminal** opens a project terminal with the command typed but not run. zsh echoes
  the text once above its first prompt, since it arrives before the prompt is drawn.
- An agent's `loom_device_qa_capture` is refused with the Agent device access message while
  that setting is off. With it on for the project, a new session's call asks for
  `device_id` when several devices run, then captures; the item is marked **Agent**.
- Deleting a thread deletes its evidence folder and rows and leaves other threads' alone.
- argent's tool-server, which `flow run` starts detached, exits after 30 idle minutes (its
  own autospawn default), so Loom does not stop it.

This pass found and fixed:

- Two emulators of one hardware profile shared a model name in the device picker. Emulators
  are now named by their AVD's display name, then its id, with the Android release.
- The telemetry copy claimed Loom's runs never send telemetry, which a tool-server started
  by an agent's argent session does not honour (TECHNICAL.md, argent telemetry).

A third pass the same day covered the other clients, servers and hosts:

- Against an upstream server (0.0.46-nightly.20261008.2833) the Device panel has no Device
  QA row and no empty row, the palette has no Device QA commands, the launcher entry is
  disabled, and settings search finds only the client keybinding entries. Upstream servers
  older than protocol 2 (stable 0.0.45, nightly 2282) are refused by the client before any
  of this renders.
- Over a remote connection (the web client on one origin, a second server on another),
  thumbnails load from the remote server's signed `/api/assets` URLs and Attach puts the
  screenshot in the composer.
- The desktop app in dev shows the launcher with its Q hint and the Flows, Evidence and
  Install tabs; a capture shows its thumbnail under the `t3code-dev://` origin, and Attach
  and Delete work.
- The Android mobile client (Android 16 emulator) shows the thread with the capture tool
  row and its file chip, and the evidence opens in the file viewer. Mobile has no Device QA
  panel, as planned.
- SSH screenshots ran against a stand-in: a loopback sshd on port 2222 with its own home
  and keys, which Loom treats as a remote Mac. Setup installs the hub over SSH, the picker
  lists the host's simulator for screenshots only with Record screen disabled, and a
  capture lands in Evidence with its thumbnail. The host lists its Android AVDs but shows
  them stopped: `adb emu avd name` returns nothing inside the stand-in's sshd session, so
  the hub cannot match a running emulator to its AVD.

This pass found and fixed the keybinding label, which read "Loom: Device Qa".

The iOS mobile client was not run: mobile renders Device QA only through shared tool rows
and file chips, which the Android pass covers.

Still unverified: a real remote Mac over SSH, including Android emulators on it.

Deliberate differences from the plan:

- Only screenshots attach as images. Recordings, installs and flow reports go into the
  message as their host path, which agents can open; uploading video was not worth the
  draft-attachment complexity, so there is no `attach.test.ts`.
- The Device panel hands its device to Device QA through a small client store instead of
  the panel surface's resource id, so opening from a second device does not add a tab.
- The capture toast has one action, **Attach**; opening Device QA is the toolbar's second
  button. Toasts support a single action.
- argent telemetry status is read the way argent decides it (its opt-out variables, then
  the global and project config files) rather than by running `argent telemetry status`,
  so showing the panel never starts argent.
- Flow reports open their run in the Flows tab, since media-file URLs serve images and
  video only.
- The palette's capture and run-last-flow entries use the device and run the panel or the
  Device panel last saw in this client; with neither, those entries are hidden.

## Merge safety

Record the merge preview result (SEAMS.md) and, after merge, the result of
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`. The only
packet-seam file that may conflict is `apps/web/src/components/device/DevicePanel.tsx`.

Preview on 2026-10-08 against `v0.0.46-nightly.20261008.2849`, with this packet's
uncommitted work in a temporary tree: DevicePanel merges cleanly. The only conflicts,
`apps/desktop/src/app/DesktopAppIdentity.test.ts` and `apps/server/src/provider/CodexProvider.ts`,
also appear for `main` alone and are not this packet's. The post-merge
`loom.sh integrate nightly --dry-run` is still to run, outside Loom.
