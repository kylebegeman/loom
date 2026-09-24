# L09 product

## Problem

Upstream's Device panel lets Kyle watch and tap a simulator while an agent works, but nothing
remembers what was checked. A regression check is "ask the agent again", screenshots live only
in the agent's context, and there is no repeatable path through the app. Old Loom had build,
evidence and scenario panels backed by a large server; its scenario format was hand-built. Kyle
chose software-mansion/argent's recorded flows as the scenario format instead: the agent
records a flow once, and anyone replays it without an LLM.

## What the user can do

- Open **Device QA** from the right panel launcher, the "+" menu, the command palette, a
  keybinding, or the new button in the Device panel toolbar.
- See whether argent is installed, its version, and whether its telemetry is on. Install it
  with one click that types argent's own installer into a thread terminal for Kyle to review
  and run (`npx @swmansion/argent@<pinned> init --no-telemetry`, or a plain `npm install -g`
  variant). Turn telemetry off with one click.
- **Flows tab:** browse the project's flows (grouped by folder), see each flow's kind,
  prerequisite and step count, open the YAML, and run a flow or a folder on a chosen device.
  Watch steps pass or fail live, see the failing step's reason, and compare baseline, current
  and diff images for failed snapshot steps. Update baselines after confirming. Re-run the last
  failed flow. Browse the last 20 runs of the project.
- **Record with the agent:** name a flow and describe the path; Loom puts a ready prompt in the
  composer ("Record a flow named checkout: ...").
- **Evidence tab:** capture a screenshot of the device (with an optional clean 9:41 status bar
  on iOS simulators), record the screen for up to three minutes, and see every screenshot,
  recording, install and flow report captured in this thread by Kyle or by an agent. Attach any
  item to the composer, copy its path, or delete it. The tab header shows how much disk the
  thread's evidence uses ("Evidence: 14 items, 212 MB") and has "Delete all for this thread"
  (with a confirmation naming the count and size).
- Evidence is kept until its thread is deleted. An optional setting, "Delete evidence older
  than N days" (off by default), removes older items automatically.
- **Install tab:** install a built `.app` (iOS simulator) or `.apk` (Android emulator) from the
  workspace, optionally launching it after install.
- Let agents run flows and capture screenshots through MCP tools when **Agent device access** is
  on (upstream setting in Settings, Integrations, Devices).

## Entry points

| Entry                                                                                                 | What it does                                                                                                                                      | Way out / state                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Right panel launcher and "+" menu: "Device QA" (letter `Q`)                                           | Opens the panel for the active thread.                                                                                                            | Close the tab; a running flow or recording continues and is shown when reopened.         |
| Device panel toolbar (packet seam): camera button "Capture screenshot"                                | Captures evidence from the device being watched, shows a toast with "Attach" and "Open in Device QA".                                             | Delete from the Evidence tab.                                                            |
| Device panel toolbar: "Device QA" button                                                              | Opens the Device QA panel preselecting that device.                                                                                               | Close the tab.                                                                           |
| Command palette: "Device QA: Open", "Device QA: Capture screenshot", "Device QA: Run last flow"       | As named; hidden when the feature is absent or no device is booted.                                                                               | "Device QA: Stop recording" while recording, "Device QA: Cancel flow run" while running. |
| Keybinding commands `loom.device-qa.toggle`, `loom.device-qa.capture`, `loom.device-qa.run-last-flow` | Unbound by default.                                                                                                                               | Same as the palette.                                                                     |
| Composer                                                                                              | "Attach" on an evidence item adds the image (or the recording, if under the upload limit) to the draft; "Record with the agent" fills the prompt. | Remove the attachment or text from the draft.                                            |
| Settings, Loom page, "Device QA" section                                                              | argent path override, run history size, "Delete evidence older than N days" (off by default), default clean status bar.                           | Toggle back.                                                                             |
| Agent tools                                                                                           | `loom_device_qa_flow`, `loom_device_qa_capture`. Items they create appear in the panel marked "Agent".                                            | Turn off Agent device access upstream.                                                   |

## States

- **Loading**: flow list and evidence list skeletons.
- **argent missing**: the Flows tab shows install guidance and the argent license note
  (Apache-2.0 source plus proprietary per-platform binaries); Evidence and Install still work.
- **argent telemetry on**: a notice with "Turn off telemetry" (runs `argent telemetry disable`).
- **No flows**: "No flows in .argent/flows yet." with "Record with the agent".
- **No device**: "Boot a simulator or emulator in the Device panel, or start one here." with a
  Start button when the device hub lists stopped devices.
- **Running**: step list filling in live, elapsed time, Cancel.
- **Finished**: pass or fail banner; failed step highlighted and expanded; snapshot images.
- **Recording**: red dot and elapsed seconds in the Evidence tab and in the Device panel
  toolbar button; Stop.
- **Errors**: argent rejected the flow (validation error from argent, shown verbatim), the
  device went away, the recording failed to finalize. Each keeps the partial evidence.
- **Physical device selected** (for example from the Device panel toolbar on a connected
  iPhone): the Flows tab says "Flows run on simulators and emulators in this version." and
  offers the booted simulators instead.
- **Disabled**: server lacks `device-qa` in `loomFeatures`: launcher disabled, palette entries
  and toolbar buttons hidden.

## Surfaces and connection modes

Web and desktop are identical. All work happens on the environment host; images and videos are
fetched through upstream's signed asset URLs, which work over every connection mode. Devices on
SSH device hosts support screenshots only (through the device hub); flows, recordings and
installs are local-host only in v1, and the panel says so for such a device. Mobile shows
nothing. An upstream server hides everything.

## Decisions

- Flows are argent YAML in the project (`.argent/flows/`), committed with the code. Loom adds no
  second format. Reason: argent records flows through agents and replays them without an LLM.
- argent is installed by the user, never bundled, and its telemetry is disabled for every run
  Loom starts (`DO_NOT_TRACK=1`, which argent documents as always winning). Reason: argent's
  platform binaries are proprietary and telemetry is on by default.
- The install command pins argent 0.25.2 (the current npm release), held in the single
  `ARGENT_PINNED_VERSION` constant. Reason (Kyle): a known version for the command Loom types;
  other installed versions still run.
- Evidence belongs to the thread and lives under Loom's state directory, not in the workspace,
  so it never shows up in git.
- Evidence is kept until the thread is deleted. "Delete evidence older than N days" is an
  optional setting, off by default; the Evidence tab shows the thread's total evidence size and
  has "Delete all for this thread". Reason (Kyle): nothing disappears unexpectedly, and disk use
  stays visible and easy to reclaim.
- Flow runs are limited to simulators and emulators in v1. Reason (Kyle): physical iPhones need
  a cable to the environment host and a subset of argent's tools. Follow-up recorded in the
  README.
- Agent access reuses upstream's "Agent device access" capability; there is no second switch.
- The Device panel gets one packet seam for two toolbar buttons, because capture belongs next to
  the device the user is looking at and no extension point reaches that toolbar.
